# アーキテクチャ（開発者向け）

この文書は、実装を変更するときに「どの責任を、どの境界で確認するか」を示します。受け入れ契約は[`SPEC.md`](../SPEC.md)、利用方法は[`README.md`](../README.md)、作業の状態は[`PLANS.md`](../PLANS.md)が所有します。

## 三つの境界

packageは一つですが、内部ではCompiler・Project・Vite Adapterを分けます。`BemModuleSchema`をCompilerから下流へ渡す不変の受け渡し点にします。

```text
CSS Module source
       │
       ▼
  Compiler
  parse / validate / lower
       │
       ▼
  BemModuleSchema ───────┬─ loweredSource → Vite Adapter → Vite
                         ├─ exportMap     → getJSON observer
                         ├─ class keys    → d.ts projection
                         └─ schemas       → ProjectIndex
                                         ├─ check
                                         └─ sync
```

### Compiler

[`src/compiler.ts`](../src/compiler.ts)は、file path・source・`ResolvedBemCompilerOptions`を受け取り、BEM対象なら`{ schema, loweredSource }`を返します。`@block`がなければ`null`です。filesystem、Vite config、module graph、HMR、`.d.ts`書き込みを参照しません。

[`src/schema.ts`](../src/schema.ts)が担うのは、`@block`の解析、BEM分類、selector lowering、`classMap` / `exportMap`の構築です。`classMap`はselector用、`exportMap`はCSS Modules公開値用です。`modifierOutput: "withBase"`では二つのmapが異なるため、どちらかを再利用しません。

### Project

[`src/project.ts`](../src/project.ts)は、rootと明示された`project.include` / `project.exclude`からfilesystem上の対象集合を作ります。pathはglobではなくroot相対または絶対pathです。`include`省略はroot全体、`include: []`は空集合です。root外を扱う場合は絶対pathを明示します。

Projectは対象集合を全走査してCompilerを呼び、Block名と生成class名の一意性を検査します。importされているか、Viteのgraphから到達しているかはProjectの入力になりません。`check`は検査、`sync`は検査済みschemaと隣接`.d.ts`の同期です。scope外のsourceや生成物はProjectが検査・削除しません。

Projectが持つのはschema mapとplugin-owned生成物の記録だけです。Vite adapterから呼ばれるcompileも、Project scope内のときだけmapとd.tsを更新します。scope外のmoduleはadapterの一時的なschema cacheへ置くことはありますが、Projectへ登録しません。

### Vite Adapter

[`src/runtime.ts`](../src/runtime.ts)と[`src/index.ts`](../src/index.ts)は、Compiler / ProjectをVite hookへ接続します。責務は次のとおりです。

- 実体のある`.module.css` / `.module.scss`、node_modules、virtual module、queryの所有判定
- Compiler呼び出しと`loweredSource`の返却
- 最終CSS Modules exportをschemaと照合する`getJSON` observer
- serve / buildに応じたProject `check` / `sync`の起動
- CSS Module自身の変更時の再compileと、必要なscript importerのinvalidate

Vite AdapterはProjectの対象集合をmodule graphで増減させません。importerの変更だけではProject stateや`.d.ts`を変更しません。HMRは正当性を優先し、標準Viteで満たせる処理を残しながら、schema projectionが変わる場合だけ影響を返します。

## `.d.ts`の所有

[`src/dts.ts`](../src/dts.ts)はschemaから宣言文字列を作る純粋なprojectionです。filesystemへのread / writeと所有確認はProjectが担当します。手書きの隣接`.d.ts`を上書きせず、`BEM006`で停止します。

Viteではserve、または`types: true`で生成mode、`types: false`でremove mode、buildで`types`省略時はignore modeです。CLIでは`check`がignore、`sync`がgenerateです。source削除、`@block`消失、明示scope内の孤立生成物、remove modeが削除の根拠になります。Vite graphの到達性変化だけでは削除しません。

## 所有判定とVite委譲

`@block`のないCSS Module、virtual module、`node_modules`配下、通常CSS Moduleへの`?raw` / `?inline` / `?url`は標準Viteへ委譲します。BEM対象へ同じqueryが付いた場合は`BEM008`で拒否します。`css.transformer: "lightningcss"`は`BEM004`で拒否します。

CSSの実コンパイル、Sass・PostCSS・CSS Modulesのruntime object生成、asset bundling、JavaScript / TypeScript source transformはViteの責務です。Sassの動的selectorや`@at-root`など、Compilerが安全に意味を確定できない構文は`BEM005`でfail closedします。

## 変更時の検証入口

| 変更の種類 | 最初に確認する場所 | 境界を通した検証 |
| --- | --- | --- |
| 命名、分類、診断、class map | `src/schema.ts` / `src/options.ts` | `test/schema.test.ts`、`test/compiler.test.ts` |
| pure compile result | `src/compiler.ts` | `test/compiler.test.ts` |
| scope、scan、unique、d.ts | `src/project.ts` / `src/files.ts` | `test/project.test.ts`、`test/files.test.ts` |
| Vite transform、export、HMR | `src/runtime.ts` / `src/index.ts` | `test/plugin.test.ts`、`test/dev.test.ts` |
| CLIとshared config | `src/cli.ts` / `package.json` | `test/cli.test.ts`、`test/package.test.ts` |
| package root、tarball | `src/index.ts` / `package.json` | `test/package.test.ts`、`pnpm pack --dry-run` |
| framework固有のvirtual CSS Module | Vite Adapterの所有外境界 | virtual moduleのintegration test |

schemaの意味を変更するときはCompilerとProjectのunit testから始め、CSS・JavaScript・型の実Vite buildまで通します。境界の変更では、呼び出し回数ではなくschema、生成物、最終exportの契約を検証します。

## 再検討条件

CompilerとProjectの境界は、filesystemやViteの変更から独立してschemaの正しさを保つために維持します。Viteの内部graphへの依存を増やすHMR最適化は、正当性を示す実Viteテストと性能上の必要性が揃った場合だけ追加します。低レベルCompiler / Project APIをpackage rootへ昇格するのは、実consumerが現れて公開契約が必要になった場合です。
