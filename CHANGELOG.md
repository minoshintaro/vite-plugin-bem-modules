# Changelog

このファイルには、利用者に影響する公開版の変更を記録します。公開前の内部試作の履歴は含めません。

## 0.1.0 - Unreleased

- Vite 8のCSS Modules向けに、`@block`宣言を持つModuleからBEM classと型を生成する。
- `bemModules()`をVite pluginとして、`createBemPostcssPlugin()`を`css.postcss.plugins`へ明示登録する。
- TypeScriptの公開型はruntime class mapと一致するclass keyに限定し、ID、keyframes、`@value`、任意のICSS export keyは含めない。
- BEM class、ID、keyframesをglobal CSS名として扱う。Module間のBEM名衝突は許容し、重複keyframesは警告する。
- `bem-modules check` / `bem-modules sync`はViteの解決済み設定とCSS pipelineを使って明示実行する。
- Node.js `^22.13.0`または`>=24.0.0`をサポートする。
