# アーキテクチャ（開発者向け）

この文書は、実装を変更するときに「どの責任を、どの境界で確認するか」を示します。受け入れ契約は[`SPEC.md`](../SPEC.md)、利用方法は[`README.md`](../README.md)、作業の状態は[`PLANS.md`](../PLANS.md)が所有します。

## v0.2の責任分担

v0.2では、BEMのAST変換を明示的に登録したPostCSS pluginへ委譲し、Vite pluginは型同期・設定検証・削除時の掃除を担うcompanionです。ViteがSass、PostCSS、CSS Modules、HMRを一度ずつ実行する経路を正本にします。

```text
source
  │
  ├─ Vite runtime ── Sass → user PostCSS → BEM PostCSS → CSS Modules → CSS / JS export
  │                                      │
  │                                      └─ class-only .d.ts / keyframes registry
  │
  └─ Project / CLI SCSS sync
       Vite preprocessCSS (resolved config)
         → source-level BEM preflight
         → compiler schema analysis
         → class map / .d.ts
```

Project / CLIのSCSS同期でも、独自のSass compilerやloaderは持ちません。Vite 8の公開`preprocessCSS`へ解決済みVite configを渡し、`css.preprocessorOptions.scss`の`additionalData`、alias、importerなどをViteと同じ設定で適用します。実行時のPostCSS pluginとCSS Modulesは同期用の前処理から除外し、BEM loweringが二重に行われないようにします。

## Compilerとschema

[`src/compiler.ts`](../src/compiler.ts)はfilesystem、Vite config、module graph、HMR、`.d.ts`書き込みを参照しない純粋な入口です。`@block`のないCSS Moduleは`null`、対象Moduleは`{ schema, loweredSource }`を返します。`loweredSource`はCompilerの純粋なテスト可能な投影として残りますが、runtimeのVite transformへ渡すCSSの所有者ではありません。

[`src/schema.ts`](../src/schema.ts)は、`@block`の解析、BEM分類、selector lowering、class map / export map、keyframes参照の構築を担います。class名、ID、keyframesの変換はPostCSS AST上でも同じ解析規則を使います。class mapは型生成、export mapはruntime CSS Modulesとの契約に使うため、互いを再利用しません。

Compilerが拒否する動的なselector生成や`@at-root`、BEM名を作るSass nesting、`@extend`などは`BEM005`でfail closedします。Sass展開後のclass mapを必要とする同期では、まず元ソースをCompilerで検査し、成功した場合だけViteの`preprocessCSS`結果をCompilerへ渡します。

## PostCSS plugin

[`src/postcss.ts`](../src/postcss.ts)の`createBemPostcssPlugin`が、実際のVite CSS変換の中でASTをloweringします。pluginは次を所有します。

- `@block`のある実体CSS Moduleのselector / ID / keyframes lowering
- class-onlyの`:export` projectionと隣接`.d.ts`の生成・削除
- keyframesのfile/name双方向registryと重複警告
- Viteが解決したSass後のmixin由来classを含む最終ASTの処理

pluginは明示的に`css.postcss.plugins`へ登録される必要があります。Vite pluginが同じ処理を`transform`で再実行したり、`getJSON`を監視したり、runtime CSS Modules exportを書き換えたりしません。これにより外部PostCSS設定とplugin順序はViteの通常契約の中に残ります。

## ProjectとCLI

[`src/project.ts`](../src/project.ts)は、rootと明示された`project.include` / `project.exclude`からfilesystem上の対象集合を作ります。`include`省略はroot全体、`include: []`は空集合です。Projectは対象集合を走査してCompilerを呼び、Module内のBEM診断とclass mapを検査します。v0.2では、別Module間のBlock名・生成class名の一意性は要求しません。グローバルなBEM名の衝突はCSSのcascadeとkeyframes警告の責務です。

`check`は検査、`sync`は検査済みschemaと所有marker付きの隣接`.d.ts`の同期です。scope外のsourceや生成物はProjectが検査・削除しません。Vite serveでは実際にPostCSSを通ったModuleの型をpluginが書き、Projectの全体同期はCLIまたはbuildの責務です。

[`src/cli.ts`](../src/cli.ts)はshared `bem-modules.config`を読み、同じProject scopeとcompiler optionsを使います。さらにrootのVite configを`resolveConfig`で解決し、CLIのSCSS同期にもViteと同じpreprocessor設定を渡します。Viteの公開preprocess APIにSass compilerのclose hookがないため、CLIは出力完了後に終了して埋め込みSassのworkerを残しません。

## Vite companion

[`src/runtime.ts`](../src/runtime.ts)と[`src/index.ts`](../src/index.ts)のVite companionの責務は次のとおりです。

- `css.transformer: "lightningcss"`を`BEM011`で拒否する
- BEM PostCSS pluginの明示登録を`BEM010`で検証する
- resolved Vite configをSCSS同期用のpreprocess bridgeへ渡す
- serve / buildのd.ts modeを設定し、build開始時のProject `check` / `sync`を起動する
- source unlink時にProject、d.ts、keyframes registryを掃除する
- 通常のSass、PostCSS、CSS Modules、HMRはViteと登録済みPostCSS pluginへ委譲する

`transform`はno-opです。通常のmodule変更でProjectがimporterを読んだり、importerをinvalidateしたり、独自のHMR payloadを返したりしません。削除だけは所有するschemaと生成物を撤回するため、companionが処理します。virtual module、`node_modules`、`@block`のないCSS Moduleは標準Viteへ委譲します。BEM対象の`?raw` / `?inline` / `?url`は`BEM008`で拒否します。

`src/vite-preprocessor.ts`はViteを静的runtime依存としてCompilerへ持ち込まず、必要なときだけ動的にViteの`preprocessCSS` / `resolveConfig`を読み込みます。通常のCSS consumerにSass packageを直接importさせる経路はありません。Sass packageの選択・worker lifecycle・alias解決はViteのpreprocessorに任せます。

## `.d.ts`の所有

[`src/dts.ts`](../src/dts.ts)はschemaから宣言文字列を作る純粋なprojectionです。filesystemのread / writeと所有確認はProjectまたはPostCSS pluginが担当します。手書きの隣接`.d.ts`を上書きせず、所有markerがなければ`BEM006`で停止します。

Viteではserve、または`types: true`で生成mode、`types: false`でremove mode、buildで`types`省略時はignore modeです。CLIでは`check`がignore、`sync`がgenerateです。source削除、`@block`消失、明示scope内の孤立生成物、remove modeが削除の根拠になります。import到達性だけの変化はProjectの全体集合や`.d.ts`の所有を変更しません。

## 変更時の検証入口

| 変更の種類 | 最初に確認する場所 | 境界を通した検証 |
| --- | --- | --- |
| 命名、分類、診断、class map | `src/schema.ts` / `src/options.ts` | `test/schema.test.ts`、`test/compiler.test.ts` |
| pure compile result | `src/compiler.ts` | `test/compiler.test.ts` |
| scope、scan、d.ts | `src/project.ts` / `src/files.ts` | `test/project.test.ts`、`test/files.test.ts` |
| Sass同期とVite設定 | `src/vite-preprocessor.ts` / `src/project.ts` | `test/plugin.test.ts`、`test/cli.test.ts` |
| Vite transform、PostCSS、HMR | `src/runtime.ts` / `src/postcss.ts` | `test/plugin.test.ts`、`test/dev.test.ts` |
| CLIとshared config | `src/cli.ts` / `package.json` | `test/cli.test.ts`、`test/package.test.ts` |
| package root、tarball | `src/index.ts` / `package.json` | `test/package.test.ts`、`pnpm pack --dry-run` |

schemaの意味を変更するときはCompiler、PostCSS、Projectのunit testから始め、CSS・JavaScript・型の実Vite buildまで通します。境界の変更では、呼び出し回数ではなくschema、生成物、最終CSS、runtime exportの契約を検証します。ブラウザHMR runnerは補助的な観測であり、通常の製品検証では未観測のままです。

## 再検討条件

Viteの内部graphやprivate Sass APIへ依存する追加実装は、公開APIで満たせない正当性または性能上の必要性が観測された場合だけ検討します。ProjectとVite runtimeの両方でSassを独自compileする設計には戻しません。Compiler / Project低レベルAPIのpackage root公開は、実consumerが現れて公開契約が必要になった場合に検討します。
