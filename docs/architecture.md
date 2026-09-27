# アーキテクチャ（開発者向け）

この文書は、実装を変更するときに「どの責任を、どの境界で確認するか」を示します。公開版の設計契約は[`SPEC.md`](../SPEC.md)、利用方法は[`README.md`](../README.md)と[`README.ja.md`](../README.ja.md)、作業の状態は[`PLANS.md`](../PLANS.md)が所有します。

## v0.1の責任分担

v0.1では、BEMのAST変換を明示的に登録したPostCSS pluginへ委譲し、Vite pluginは設定・query・SCSS source構文の検査と、型同期・削除時の掃除を担うcompanionです。Sass、PostCSS、CSS Modules、HMRはViteの通常経路を使います。

```text
source
  │
  ├─ Vite runtime ── Sass → registered PostCSS plugins → CSS Modules → CSS / JS export
  │                                      │
  │                                      └─ class-only .d.ts / keyframes registry
  │
  └─ CLI explicit sync
       collect scope → virtual entry → same Vite pipeline → deferred schema capture → .d.ts preflight / sync
```

SCSSのruntime変換と型生成は、実際のVite Sass → PostCSS → CSS Modules pipelineを通ったASTから行います。CLIはscopeを収集しますが、各fileを直接compileせず、全対象をside-effect importするvirtual entryで一回のprogrammatic Vite buildへ渡します。schemaをmemoryへcaptureし、build成功後に型出力を作ってpreflightとfile単位のatomic writeを行います。Viteの公開`preprocessCSS`を呼び出し側から起動する別経路や、Sass workerを独自管理する経路は製品実装に採用しません。

## Compilerとschema

[`src/compiler.ts`](../src/compiler.ts)はfilesystem、Vite config、module graph、HMR、`.d.ts`書き込みを参照しない純粋な入口です。`@block`のないCSS Moduleは`null`、対象Moduleは`{ schema, loweredSource }`を返します。`loweredSource`はCompilerの純粋なテスト可能な投影として残りますが、runtimeのVite transformへ渡すCSSの所有者ではありません。

[`src/schema.ts`](../src/schema.ts)は、`@block`の解析、BEM分類、selector lowering、class map / export map、keyframes参照の構築を担います。class名、ID、keyframesの変換はPostCSS AST上でも同じ解析規則を使います。class mapは型生成に使い、export mapはModifierの値に基本クラスを含める場合にclass mapを参照して、runtime CSS Modulesへ渡す`:export`の値を作ります。

Compilerが拒否する動的なselector生成や`@at-root`、BEM名を作るSass nesting、`@extend`などは`BEM005`でfail closedします。Sassのclass mapは、Viteが実際にPostCSSへ渡すASTから取得し、Project / CLIで独自にSass展開後の結果を推測しません。

## PostCSS plugin

[`src/postcss.ts`](../src/postcss.ts)の`createBemPostcssPlugin`が、実際のVite CSS変換の中でASTをloweringします。pluginは次を所有します。

- `@block`のある実体CSS Moduleのselector / ID / keyframes lowering
- class-onlyの`:export` projectionと隣接`.d.ts`の生成・削除
- keyframesのfile/name双方向registryと重複警告
- Viteが解決したSass後のmixin由来classを含むPostCSS ASTの処理

pluginは明示的に`css.postcss.plugins`へ登録される必要があります。Vite pluginが同じ処理を`transform`で再実行したり、`getJSON`を監視したり、runtime CSS Modules exportを書き換えたりしません。PostCSSの実行順はvisitorの種類にも依存するため、配列順だけで変換の前後関係を保証しません。BEM pluginが`Once`で解析した後に、別pluginがclassを追加・改名する構成は対象外です。

## ProjectとCLI

[`src/project.ts`](../src/project.ts)は、rootと明示された`project.include` / `project.exclude`からfilesystem上の対象集合を作ります。`include`省略はroot全体、`include: []`は空集合です。内部の`check` / `sync`は対象集合を走査してCompilerを呼び、Module内のBEM診断とclass mapを検査します。この低レベル経路でSCSSを直接同期すると`BEM004`で停止します。公開CLIのSCSS処理は後述のVite build経路を使います。v0.1では、別Module間のBlock名・生成class名の一意性は要求しません。グローバルなBEM class名が衝突した場合は通常のCSS cascadeに従います。

内部ProjectIndexの`check`は対象scopeを検査し、`sync`は所有marker付きの隣接`.d.ts`を同期します。scope外のsourceと生成物はこれらの一括操作や削除の対象外です。ただし低レベル`compile`をscope外のsourceへ直接呼ぶと解析と診断は行います。ProjectIndexはruntimeのunlink処理と内部利用のために残りますが、公開CLIの主経路では使用しません。CLIはViteが処理した管理対象schemaだけをcaptureし、`check`では型へ触れず、`sync`ではbuild成功後に全expected pathをpreflightしてから生成・孤立生成物削除を確定します。capture中のPostCSS pluginは、companionの設定hookとの実行順や`types`の値にかかわらず、型宣言を生成・更新・削除しません。CLIで型I/Oを行う場所は、成功した`sync`のreconcile処理だけです。

[`src/cli.ts`](../src/cli.ts)はshared `bem-modules.config`からscopeを読み、Vite configはVite自身の標準探索または`--vite-config`で読み込みます。CLIは互換protocol markerを持つ`bemModules(...)` companionと、`css.postcss.plugins`に直接登録されたBEM PostCSS pluginをそのまま内部captureへ切り替えます。Vite configのbundle境界を越えられないobject identityには依存せず、plugin名が同じだけのobjectや、非互換protocol、companionまたは直接登録がない場合（Vite configなし、外部PostCSS設定だけ、間接登録を含む）は`BEM010`で停止します。CLIはどちらのpluginも注入せず、PostCSS配列を再構成せず、外部PostCSS設定を探索・コピーせず、同じBEM pluginを二重実行しません。Vite config内の他plugin hookはCLI buildでも実行されるため、副作用が安全に回避できない場合はCLI側で隠しません。

## Vite companion

[`src/runtime.ts`](../src/runtime.ts)と[`src/index.ts`](../src/index.ts)のVite companionの責務は次のとおりです。

- `css.transformer: "lightningcss"`を`BEM011`で拒否する
- BEM PostCSS pluginの明示登録を`BEM010`で検証する
- serve / buildのd.ts modeを設定し、実Vite pipelineを通ったModuleの型同期をPostCSS pluginへ委譲する
- `types: false`のbuild開始時は、Sass / PostCSSを再実行せず、scope内のplugin所有`.d.ts`だけを掃除する
- source unlink時にProject、d.ts、keyframes registryを掃除する
- 通常のSass、PostCSS、CSS Modules、HMRはViteと登録済みPostCSS pluginへ委譲する

`transform`は変換済みCSSを返しませんが、SCSSではViteのSass処理前にsource構文を検査します。対象Moduleの`?raw` / `?inline` / `?url`は`resolveId`または`transform`で`BEM008`として拒否します。通常のmodule変更でProjectがimporterを読んだり、importerをinvalidateしたり、独自のHMR payloadを返したりしません。削除だけは所有するschemaと生成物を撤回するため、companionが処理します。`project.startup`の`scan` / `defer`は設定互換のため受理しますが、どちらも起動時のProject全体走査を開始しません。virtual module、`node_modules`、`@block`のないCSS Moduleは標準Viteへ委譲します。

ViteのSass package選択・worker lifecycle・alias解決はViteの通常pipelineだけに任せます。公開APIで呼び出し側のlifecycleを安全に完了できない処理は、plugin側で補助workerやprivate close APIを作らず未対応境界として扱います。

`bemModules()`と`createBemPostcssPlugin()`を同じVite設定へ登録した標準構成では、companionがCSS Modules有効時のBEM PostCSS登録を検証し、PostCSS factory単体の`enabled`既定値`true`は維持します。`css.modules: false`ではcompanionとPostCSS factoryをともに無効化し、CLIもschema captureと型同期を行いません。

### 手動ブラウザHMR runner

製品srcを使った手動確認には`pnpm browser:hmr`を使います。これは先に`dist`をbuildし、tracked fixtureを変更しない一時rootでVite dev serverを起動してURLを表示します。表示されたページのclass、Sass partial、keyframesのボタンが一時fixtureを書き換え、CSS Module export、DOMのclass、隣接`.d.ts`を観測できます。runnerはブラウザを起動せず、自動assertも行わないため、URLを開いて確認した結果を受け入れ検証済みとは扱いません。ブラウザ自動化、Viteのversion matrix、watcher環境の確認は別途必要です。

## `.d.ts`の所有

[`src/dts.ts`](../src/dts.ts)はschemaから宣言文字列を作り、所有markerの検査とfile単位の書き込みを行います。ProjectとPostCSS pluginは同期する対象と時点を決めます。手書きの隣接`.d.ts`を上書きせず、所有markerがなければ`BEM006`で停止します。

Viteではserve、または`types: true`で生成mode、`types: false`でremove mode、buildで`types`省略時はignore modeです。Vite build / serveの生成対象は実際にPostCSSを通ったModuleです。`types: false`のbuild開始時は解析なしでscope内のplugin所有宣言を掃除し、runtime pipelineが処理したModuleも同じmodeで削除します。CLIでは`check`がignore、`sync`がdeferred generateです。source削除、`@block`消失、明示scope内の孤立生成物、remove modeが削除の根拠になります。CLIの複数file同期はOS I/Oまで含むtransactionを保証せず、事前所有検査とfile単位atomic renameの範囲を保証します。

## 変更時の検証入口

| 変更の種類 | 最初に確認する場所 | 境界を通した検証 |
| --- | --- | --- |
| 命名、分類、診断、class map | `src/schema.ts` / `src/options.ts` | `test/schema.test.ts`、`test/compiler.test.ts` |
| pure compile result | `src/compiler.ts` | `test/compiler.test.ts` |
| scope、scan、d.ts | `src/project.ts` / `src/files.ts` | `test/project.test.ts`、`test/files.test.ts` |
| Vite Sass、PostCSS、型同期 | `src/runtime.ts` / `src/postcss.ts` | `test/plugin.test.ts`、`test/dev.test.ts` |
| Vite transform、PostCSS、HMR | `src/runtime.ts` / `src/postcss.ts` | `test/plugin.test.ts`、`test/dev.test.ts` |
| CLIとshared config | `src/cli.ts` / `package.json` | `test/cli.test.ts`、`test/package.test.ts` |
| package root、tarball | `src/index.ts` / `package.json` | `test/package.test.ts`、`npm run verify:package` |

schemaの意味を変更するときはCompiler、PostCSS、Projectのunit testから始め、CSS・JavaScript・型の実Vite buildまで通します。利用者PostCSS pluginが一度だけ実行されること、未import ModuleをbuildStartで解析しないこと、worker lifecycleをforce-exitで隠さないことも検証します。ブラウザHMR runnerは補助的な観測であり、通常の製品検証では未観測のままです。

## 再検討条件

Viteの内部graphやprivate Sass APIへ依存する追加実装は、公開APIで満たせない正当性または性能上の必要性が観測された場合だけ検討します。ProjectとVite runtimeの両方でSassを独自compileする設計には戻しません。Compiler / Project低レベルAPIのpackage root公開は、実consumerが現れて公開契約が必要になった場合に検討します。
