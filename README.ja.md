# vite-plugin-bem-modules

[English](./README.md) | 日本語

ViteのCSS Modulesで、出力するクラス名を`c-card`、`c-card__title`、`c-card--compact`のようなBEM名に固定するプラグインです。

コンポーネントからは、通常のCSS Modulesと同じように`styles.root`や`styles.title`で参照できます。隣接する型宣言を生成すると、クラス名が補完され、存在しないクラスへの参照も型検査で見つけられます。

```css
/* @block c-card */

.root {}
.root--compact {}
.title {}
```

```ts
styles.root;        // "c-card"
styles.rootCompact; // "c-card--compact"
styles.title;       // "c-card__title"
```

`@block`コメントを書いた`.module.css`と`.module.scss`だけがBEM変換の対象です。コメントのないCSS Module、通常のCSS、依存パッケージ内のCSS ModuleはViteの標準処理へ委ねます。

## 対応環境

- Vite 8.x
- Node.js `^22.13.0`または`>=24.0.0`
- `.module.css`と`.module.scss`
- Viteの既定のPostCSS変換器

SCSSを使う場合は、Viteが利用できるSass処理系も必要です。

```sh
pnpm add -D sass-embedded
# または
npm install -D sass-embedded
```

CSS Modulesの変換器に`css.transformer: "lightningcss"`を指定した構成には対応していません。ビルド時に`build.cssMinify: "lightningcss"`でCSSを圧縮することはできます。

## インストール

```sh
pnpm add -D vite-plugin-bem-modules
# または
npm install -D vite-plugin-bem-modules
```

## クイックスタート

### 1. ViteプラグインとPostCSSプラグインを登録する

`vite.config.ts`または`vite.config.js`に、ViteプラグインとPostCSSプラグインの両方を登録します。

```ts
import { defineConfig } from "vite";
import bemModules, { createBemPostcssPlugin } from "vite-plugin-bem-modules";

export default defineConfig({
  plugins: [bemModules({ types: true })],
  css: {
    postcss: {
      plugins: [createBemPostcssPlugin()],
    },
  },
});
```

`createBemPostcssPlugin()`の登録は必須です。ほかのPostCSSプラグインがある場合は、同じ`plugins`配列に登録してください。配列内で先に置いたプラグインでも、visitorの処理段階によってはこのプラグインの解析後に実行されます。その段階で追加・改名されるクラスは対応範囲外です。例の`types: true`は、ビルド中にも型宣言を生成する設定です。

### 2. CSS ModuleにBlock名を書く

`Card.module.css`を作り、`@block`コメントで出力するBlock名を指定します。Block名をファイル名から推測することはありません。

```css
/* @block c-card */

.root {
  display: grid;
  gap: 12px;
  padding: 16px;
}

.root--compact {
  gap: 4px;
  padding: 8px;
}

.title {
  font-weight: 700;
}
```

クラスは次のように変換されます。

| CSS Moduleのクラス | 出力されるクラス | コンポーネントからの参照 |
| --- | --- | --- |
| `.root` | `c-card` | `styles.root` |
| `.root--compact` | `c-card--compact` | `styles.rootCompact` |
| `.title` | `c-card__title` | `styles.title` |

`.root`はBlock名そのものに変換されます。`.title`のような基本クラスはElementになり、Modifierには対応する基本クラスが必要です。たとえば`.title--large`を使うには、`.title`も定義します。

### 3. コンポーネントから参照する

既定の`modifierOutput: "only"`では、Modifierの値に基本クラスを含めません。両方のスタイルを使うときは、基本クラスとModifierを並べます。

```tsx
import styles from "./Card.module.css";

type CardProps = {
  compact?: boolean;
  title: string;
};

export function Card({ compact = false, title }: CardProps) {
  const className = compact
    ? `${styles.root} ${styles.rootCompact}`
    : styles.root;

  return (
    <article className={className}>
      <h2 className={styles.title}>{title}</h2>
    </article>
  );
}
```

## 主な設定

BEMの設定は、Vite設定の`bemModules(...)`に渡します。引数に直接書くこともできます。CLIも使う場合は、共有する設定を`bem-modules.config.mjs`に書き、Vite設定から読み込んだオブジェクトを`bemModules(config)`に渡してください。CLIはそのファイルを自動で探します。

| 設定 | 既定値 | 用途 |
| --- | --- | --- |
| `modifierOutput` | `"only"` | Modifierの出力値に基本クラスを含めるか選ぶ |
| `naming.wordCase` | `"camel"` | CSS Module内のクラスをcamelCaseまたはkebab-caseで記述する |
| `naming.elementSeparator` | `"__"` | 出力名のBlockとElementを区切る |
| `naming.modifierSeparator` | `"--"` | 入力名と出力名のModifierを区切る |
| `globalScope.exact` | `[]` | 完全一致したクラスをBEM変換から除外する |
| `globalScope.prefix` | `[]` | 指定した接頭辞のクラスをBEM変換から除外する |
| `types` | 実行方法による | 隣接型を生成、維持、削除する |
| `project.include` | `["."]` | CLIでの同期と生成済み型宣言の掃除に含めるファイルやディレクトリを指定する |
| `project.exclude` | `[]` | 対象範囲からファイルやディレクトリを除外する |

`project.include`と`project.exclude`はglobパターンを受け付けません。Viteの`root`からの相対パス、または絶対パスでファイルやディレクトリを指定します。`include: []`では対象が空になります。

この対象範囲は、後述するCLIの同期と生成済み型宣言の掃除に使います。範囲外でも、実体ファイルに`@block`コメントがあり、Viteが読み込んだCSS ModuleはBEM変換されます。

### Modifierの値に基本クラスを含める

```ts
bemModules({
  modifierOutput: "withBase",
});
```

この設定では、`styles.rootCompact`が`"c-card c-card--compact"`になります。値に基本クラスが含まれるため、`styles.root`を重ねて指定する必要はありません。

### kebab-caseでクラスを書く

```ts
bemModules({
  naming: {
    wordCase: "kebab",
  },
});
```

```css
/* @block c-card */

.root {}
.profile-image {}
.profile-image--rounded {}
```

JavaScript / TypeScriptではcamelCaseのキーも利用できます。

```ts
styles.profileImage;
styles.profileImageRounded;
```

ElementとModifierの区切りには`"-"`、`"--"`、`"_"`、`"__"`を指定できます。両方に同じ値は使えません。`wordCase: "kebab"`では単一の`-`が単語区切りになるため、`modifierSeparator: "-"`は指定できません。

### BEM変換しないクラスを使う

CSS Modules標準の`:global(...)`を利用できます。

```css
/* @block c-card */

:global(.utility) .title {
  display: block;
}
```

`is-*`や`has-*`のような名前をBEM変換から除外するには、`globalScope`を使います。

```ts
bemModules({
  globalScope: {
    exact: ["active"],
    prefix: ["is-", "has-"],
  },
});
```

`root`は常にBlockを表す予約語なので、`globalScope`に一致してもBEM変換されます。

`globalScope`に一致するクラスは、グローバル名のまま、プラグインのクラスAPIと`.d.ts`にも元のキーで残ります。一方、CSSに直接`:global(...)`と書いたクラスは、プラグインのクラスAPIに追加されません。

### ViteとCLIで設定を共有する

`bem-modules.config.mjs`は任意です。ファイルがなければ、CLIはプロジェクトのルート以下を走査します。`project.include`や`project.exclude`で対象範囲を継続的に指定する場合は、このファイルを使います。

CLIにも、クイックスタートで示したVite設定が必要です。Viteは`bem-modules.config.mjs`を自動では読みません。Viteの処理に設定を反映するには、Vite設定から読み込んでください。CLIは同じファイルを自分で読み、対象範囲を決めます。

```js
// bem-modules.config.mjs
export default {
  types: true,
  naming: {
    wordCase: "kebab",
  },
  project: {
    include: ["src"],
    exclude: ["src/fixtures"],
  },
};
```

```ts
// vite.config.ts
import { defineConfig } from "vite";
import bemModules, {
  createBemPostcssPlugin,
  defineBemModulesConfig,
} from "vite-plugin-bem-modules";
import config from "./bem-modules.config.mjs";

const bemConfig = defineBemModulesConfig(config);

export default defineConfig({
  plugins: [bemModules(bemConfig)],
  css: {
    postcss: {
      plugins: [createBemPostcssPlugin()],
    },
  },
});
```

CLIは`bem-modules.config.mjs`、次に`bem-modules.config.js`を探します。別のファイルを使う場合は`--config <path>`で指定し、Viteでも同じ設定を使うならVite設定からそのファイルを読み込みます。Viteは自身の設定ファイルを別に探します。

## 型宣言を運用する

ViteがBEM対象のCSS Moduleを処理すると、`Card.module.css.d.ts`のような型宣言を元ファイルの隣に生成できます。

```ts
// Generated by vite-plugin-bem-modules. Do not edit.
export type Styles = {
  readonly "root": string;
  readonly "root--compact": string;
  readonly "rootCompact": string;
  readonly "title": string;
};

declare const styles: Styles;

export default styles;
```

型宣言にはクラスのキーだけを含めます。ID、keyframes、`@value`、任意のICSS `:export`は含めません。

| 実行方法 | `types` | 動作 |
| --- | --- | --- |
| Viteの開発サーバー | 省略または`true` | 処理したBEM対象のCSS Moduleの型を生成・更新する |
| Viteのビルド | `true` | 処理したBEM対象のCSS Moduleの型を生成・更新する |
| Viteのビルド | 省略 | 既存の型宣言を変更しない |
| Viteの開発サーバー／ビルド | `false` | 処理したCSS Moduleの生成済み型を削除する。ビルドでは対象範囲も掃除する |
| `bem-modules sync` | ― | 対象範囲のCSS Moduleを全走査して型を同期する |

生成された`.d.ts`は手で編集せず、リポジトリへコミットすることを推奨します。クローン直後からエディタと`tsc`がクラスの型を読めるためです。生成先に手書きファイルやシンボリックリンクがある場合は上書きせず、`BEM006`で停止します。

### CSS Moduleを一括で検査し、型宣言を同期する

Viteの開発サーバーとビルドは、読み込んだCSS ModuleだけをBEM変換します。読み込まれていないファイルも含めて検査したり、型宣言を揃えたりする場合はCLIを使います。`package.json`に次のスクリプトを追加し、目的に応じて実行してください。

```json
{
  "scripts": {
    "bem:check": "bem-modules check",
    "bem:sync": "bem-modules sync"
  }
}
```

```sh
pnpm bem:check
pnpm bem:sync
```

- `bem:check`は対象ファイルを検査し、型宣言は変更しません。
- `bem:sync`は検査後に型宣言を生成・更新し、プラグインが生成した型宣言のうち、対象範囲内で不要になったものを削除します。

型宣言は型検査の入力なので、CSS Moduleやクラスキーに影響する設定を変えたら、`bem:sync → tsc → vite build`の順に実行します。生成した宣言をコミットすれば、変更のないビルドで毎回同期する必要はありません。CIでは同期後に差分がないことを確認できます。`types: true`でビルド中に型を生成しても、そのビルドより前の型検査には間に合いません。

CLIは対象範囲のCSS Moduleを1回のViteビルドで処理します。ビルド結果は書き出さず、SCSSの展開、エイリアス、`additionalData`、独自のimporter、PostCSSの実行順にはViteの設定を使います。`.module.scss`を検査する環境には、Viteが利用できるSass実装（`sass-embedded`など）が必要です。

CLIはViteの設定ファイルに登録済みのプラグインを使います。どちらかのプラグインが欠けている場合や、外部のPostCSS設定にだけ登録した場合は`BEM010`で停止します。CLIでは`--root`、繰り返し指定できる`--include`と`--exclude`も利用できます。

CLIはViteのビルド処理を使うため、ほかのプラグインのフックも実行します。それらの副作用が問題になる場合は、`--vite-config <path>`でCLI専用のVite設定を指定してください。

## CSSとSCSSの扱い

### ViteのCSS処理経路をそのまま使う

SCSSのコンパイル、エイリアス、`additionalData`、独自のimporter、PostCSS、CSS Modules、HMRはViteが処理します。このプラグインは別のSassコンパイラを起動せず、ViteがPostCSSへ渡したCSSを解析して変換します。そのため、mixinが出力したクラスも実際のCSSと型宣言へ同じ結果で反映されます。

### Sassではクラス名を明示する

BEM対象のクラス名は静的に確定できる形で書いてください。

```scss
/* @block c-card */

.root {}
.root--compact {}
```

次の書き方には対応しません。

```scss
.root {
  &--compact {}
}
```

`&--modifier`、セレクタの補間、`@at-root`、`@extend`は`BEM005`で拒否します。宣言を共有する場合は、セレクタを継承しないmixinを利用できます。

### IDとkeyframesはグローバル名になる

BEM対象のCSS Module内では、IDと`@keyframes`をCSS Modulesのexportに含めず、記述した名前をグローバルに維持します。`animation`と`animation-name`の参照も同じ名前へ変換します。

複数のBEM対象ファイルで同じ`@keyframes`名を定義すると警告しますが、ビルドは停止しません。同名のアニメーションには通常のCSSの規則が適用されます。

### 生成クラスもグローバル名になる

生成するBEMクラスにはCSS Modulesのハッシュを付けません。異なるCSS Moduleから同じBlock名やクラス名を出力することも許容します。衝突した場合は、通常のCSSと同じカスケードの規則で結果が決まります。

### 通常のCSS Modulesと併用する

`@block`のない`.module.css`と`.module.scss`はBEM変換しません。Viteの通常のCSS Modulesとして、同じプロジェクト内で併用できます。

```css
/* Plain.module.css */
.root {
  color: rebeccapurple;
}
```

通常のCSS、`node_modules`内のCSS Module、実体ファイルを持たない仮想CSS Moduleもこのプラグインの対象外です。

## 対応していない機能

- CSS Modulesの`composes`
- BEM対象のCSS Moduleへの`?raw`、`?inline`、`?url`
- Sassの`&--modifier`、セレクタの補間、`@at-root`、`@extend`
- CSS Modulesの変換に`css.transformer: "lightningcss"`を使う構成
- フレームワークが生成する`<style module>`など、実体パスのない仮想CSS Module
- BEM解析後に別のPostCSSプラグインが追加・改名するクラス（`Rule`や`AtRule`のvisitorを含む）

読み込み中のCSS Moduleを削除すると、importの解決が失敗します。隣接する型宣言と内部の登録情報は掃除しますが、読み込み元のimport文は自動修正しません。

## 診断コード

エラーには`[vite-plugin-bem-modules:BEMxxx]`形式のコードが付きます。

| コード | 意味 |
| --- | --- |
| `BEM001` | `@block`の名前が空または不正 |
| `BEM002` | 1つのCSS Moduleに`@block`が複数ある |
| `BEM003` | クラス名、Modifier、Block名、生成名の規則違反または衝突 |
| `BEM004` | 設定値、実行方法、または対象機能が対応範囲外 |
| `BEM005` | 動的なSassセレクタまたは`@extend`を検出した |
| `BEM006` | 隣接型がプラグイン所有の通常ファイルではない |
| `BEM007` | `composes`が使われている |
| `BEM008` | BEM対象のCSS Moduleに非対応クエリが付いている |
| `BEM010` | ViteまたはPostCSSプラグインの登録が不足しているか、PostCSSプラグインが重複している |
| `BEM011` | CSS Modulesの変換器にLightning CSSが指定されている |

## 公開API

| API | 用途 |
| --- | --- |
| デフォルトエクスポート`bemModules` | Viteプラグインを作る |
| `createBemPostcssPlugin` | BEM変換を行うPostCSSプラグインを作る |
| `defineBemModulesConfig` | ViteとCLIで共有する設定に型を付け、そのまま返す補助関数 |
| `isBemGlobalClassName` | `globalScope`とクラス名の一致を判定する |
| `BemModulesOptions`ほか公開型 | 設定をTypeScriptで記述する |

コンパイラ、プロジェクト管理、スキーマ、keyframesの管理などの内部実装は公開APIではありません。

## ライセンス

MIT
