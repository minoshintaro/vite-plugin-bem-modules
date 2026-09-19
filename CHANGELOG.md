# Changelog

このファイルには、利用者に影響する変更を記録します。

## 0.2.0 - Unreleased

- `css.postcss.plugins`へ`createBemPostcssPlugin()`を明示登録するAST変換経路へ変更する。
- runtime class mapと一致するclass-only隣接型を生成する。
- IDとkeyframesをglobal CSS名として扱い、同名keyframesを警告する。
- Module間のglobal BEM名衝突を許容し、v0.1の非class export利用者には移行確認を求める。

## 0.1.1 - Unreleased

- npm registryからインストールできる公開packageへ移行する。
- escapeが必要なglobal class名と、`@value`・`@keyframes`の公開keyがCSS Modulesのexportから欠落・破損する問題を修正する。
- `project.include`でVite root外を対象にした場合も、watcherへ登録して変更を検知する。
- 英語を主とするREADMEと、日本語README・詳細な利用guideを整備する。
- `bem-modules --help`と`bem-modules --version`を追加する。

## 0.1.0 - 2026-09-01

- CSS Module の local class から型付きの flat BEM API を生成する初回リリース。
- Node.js `^22.13.0`または`>=24.0.0`をサポートする。
- Compiler、Project、Vite Adapterを分離し、filesystemやmodule graphに依存しないCompiler結果からCSSとschemaを生成する。
- `project.include` / `project.exclude`と既定の無視directoryからProject scopeを決め、scope内のBlock名と生成class名をimport状態に関係なく一意性検査する。
- `project.startup: "defer"`により、Vite起動時のProject全体走査だけを別工程へ委ね、到達Moduleの変換・HMR・増分検査を維持できる。
- `bem-modules check` / `bem-modules sync` CLIから、Viteを起動せずにProject検査と隣接`.d.ts`同期を実行できる。
- serve開始時と`types: true`のbuildでProject scope全体の`.d.ts`を同期し、module graphの到達性変化だけでは削除しない。
- ViteのCSS Modules出力と生成`.d.ts`の所有を診断する。生成先のsymlinkは`BEM006`で拒否し、掃除でも参照先へ触れない。
- 並行compile・HMRでも一意性を維持し、失敗した更新の後始末が後続の正常なschemaや生成型を消さない。
- CLIが扱うファイル名中の`?`を保持する。
- `css.modules: false`ではBEM query検査と型同期も無効化する。
- 括弧付きICSS `@value` importを許可し、implicit BEM nestingの補間形式とsource内のSass `@extend`を`BEM005`で拒否する。
- framework固有のvirtual CSS Moduleとbuild watch hookはv0.1の保証対象に含めない。
- npm registryへの誤公開を防ぎ、GitHub Releaseに添付するpackage tarballを配布経路とする。
