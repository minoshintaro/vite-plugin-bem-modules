# vite-plugin-bem-modules

[English](./README.md) | 日本語

CSS Modulesのクラスを、`p-card`や`p-card__title`のようなBEM名で出力するViteプラグインです。コンポーネントからは通常どおり`styles.root`や`styles.title`で参照でき、TypeScriptの補完にも対応します。

CSS本文に`@block`コメントを書いたファイルだけを変換するので、既存のCSS Modulesと併用できます。

## インストール

```sh
npm install -D vite-plugin-bem-modules
# または
pnpm add -D vite-plugin-bem-modules
```

Vite 8とNode.js `^22.13.0`または`>=24.0.0`が必要です。`.module.css`と`.module.scss`に対応し、SCSSを使う場合は`sass`や`sass-embedded`も必要です。

## 使い方

### 1. Viteへ登録する

`vite.config.ts`または`vite.config.js`でプラグインを登録します。

```ts
import { defineConfig } from "vite";
import bemModules from "vite-plugin-bem-modules";

export default defineConfig({
  plugins: [bemModules()],
});
```

### 2. CSSにブロック名を書く

`Card.module.css`の先頭に、次のように`@block`コメントを書きます。プラグインはこのコメントを読み取り、`p-card`をブロック名として使います。ファイル名からは推測しません。

```css
/* @block p-card */

.root {
  display: flex;
}

.root--compact {
  gap: 4px;
}

.title {
  font-weight: 600;
}
```

`root`はブロックそのもの、`title`はブロック内の要素です。`root--compact`は`root`の見た目を変えるモディファイアで、元になる`.root`も定義する必要があります。

| CSSのクラス | 出力されるBEMクラス | 参照方法 |
| --- | --- | --- |
| `.root` | `p-card` | `styles.root` |
| `.root--compact` | `p-card--compact` | `styles.rootCompact` |
| `.title` | `p-card__title` | `styles.title` |

`@block`コメントがないファイルは、通常のCSS Moduleとして処理されます。

### 3. コンポーネントから使う

既定では、モディファイアの値に元のクラスは含まれません。両方のスタイルを適用するには、一緒に`className`へ指定します。

```tsx
import styles from "./Card.module.css";

export function CompactCard() {
  return (
    <div className={styles.root + " " + styles.rootCompact}>
      <h2 className={styles.title}>Card</h2>
    </div>
  );
}
```

## 必要に応じて設定する

### モディファイアに元のクラスも含める

Viteへ登録する際に`modifierOutput: "withBase"`を指定すると、`styles.rootCompact`だけで元のクラスも適用できます。

```ts
bemModules({ modifierOutput: "withBase" });
```

この場合、`styles.rootCompact`は`"p-card p-card--compact"`になります。`styles.root`を追加する必要はありません。

### 区切り記号と名前の書き方を変える

区切り記号とCSSに書く名前の形式は、`bemModules`の`naming`オプションで指定します。

| 設定 | 既定値 | 変更する箇所 |
| --- | --- | --- |
| `naming.elementSeparator` | `"__"` | 出力名のブロックと要素の間（`p-card__title`） |
| `naming.modifierSeparator` | `"--"` | CSS入力と出力名のモディファイアの前（`.root--compact`、`p-card--compact`） |
| `naming.wordCase` | `"camel"` | CSSに書く名前の形式。`"kebab"`なら`.profile-image`と書ける |

JavaScript側のキーは、kebab-case入力でも`styles.profileImage`のようなcamelCaseになります。区切り記号の組み合わせや設定例は[利用ガイド](https://github.com/minoshintaro/vite-plugin-bem-modules/blob/main/docs/guide.ja.md)を参照してください。

`is-*`などのクラスを変換から除外するには`globalScope`、検査・型生成の対象を絞るには`project.include`と`project.exclude`を使います。対象パスはViteの`root`相対または絶対パスで指定し、globは使いません。

## 型生成とCLI

既定では、開発サーバーの起動時に対象CSS Moduleの隣へ`Card.module.css.d.ts`などの型宣言を生成します。クラス名に加えて、`@value`と`@keyframes`の公開キーも補完・検査できます。クローン直後から型を使えるよう、生成ファイルのコミットを推奨します。

ビルドでも同期するには`types: true`を指定します。ビルド時に省略すると既存の型宣言は変更しません。`types: false`では、プラグインが生成した型宣言を削除します。

Viteを起動せずに検査・同期する場合は、同梱CLIを`package.json`の`scripts`から実行できます。

```json
{
  "scripts": {
    "bem:check": "bem-modules check",
    "bem:sync": "bem-modules sync"
  }
}
```

`npm run bem:check`は検査のみ、`npm run bem:sync`は検査と型宣言の同期を行います。プラグインの設定を変更した場合は、`bem-modules.config.mjs`を使ってCLIと設定を共有してください。[共有設定とCIの例](https://github.com/minoshintaro/vite-plugin-bem-modules/blob/main/docs/guide.ja.md#cliで検査同期する)を用意しています。

## 導入前に確認すること

- 生成クラスはハッシュ付きではなくグローバルなBEM名になります。検査対象の範囲内で、ブロック名と生成クラス名を一意にしてください。既定の検査範囲はViteの`root`配下です。
- クラス名は明示的に書く必要があります。Sassの`&--modifier`、セレクタ補間、`@at-root`、`@extend`には対応しません。
- BEM変換するファイルでは`composes`、`?raw`、`?inline`、`?url`を使えません。`css.transformer: "lightningcss"`も非対応です。
- フレームワークが生成する`<style module>`など、実体パスを持たない仮想CSS Moduleは対象外です。

詳しい対応範囲、公開API、診断コードは[利用ガイド](https://github.com/minoshintaro/vite-plugin-bem-modules/blob/main/docs/guide.ja.md#対応範囲と注意点)を参照してください。

## ライセンス

MIT
