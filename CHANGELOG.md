# Changelog

このファイルには、利用者に影響する変更を記録します。

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
- escapeが必要なglobal class名と、CLIが扱うファイル名中の`?`を保持する。
- `css.modules: false`ではBEM query検査と型同期も無効化する。
- 括弧付きICSS `@value` importを許可し、implicit BEM nestingの補間形式とsource内のSass `@extend`を`BEM005`で拒否する。
- framework固有のvirtual CSS Moduleとbuild watch hookはv0.1の保証対象に含めない。
- npm registryへの誤公開を防ぎ、GitHub Releaseに添付するpackage tarballを配布経路とする。
