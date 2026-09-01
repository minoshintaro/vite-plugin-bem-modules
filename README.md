# vite-plugin-bem-modules

Vite 8のCSS ModulesにBEMの命名規則を適用し、生成されたclass名を提供するプラグインです。`@block`を付けたCSS ModuleだけがBEMの対象になり、生成されたclassは通常のCSS Modulesと同じように参照できます。

```tsx
styles.root                    // "p-card"
styles.rootCompact             // "p-card--compact"
styles.profileImage            // "p-card__profileImage"
styles.profileImageRounded     // "p-card__profileImage--rounded"
```

## できること

- CSS ModuleのclassをBlock・Element・Modifierとして管理する
- `styles.rootCompact`のように生成classを参照する
- ModifierのexportにBaseを含めるかを`modifierOutput`で切り替える
- TypeScriptでCSS Moduleのclass keyを補完・検査する
- `@block`のないCSS Moduleを通常のVite処理で利用する

## 必要な環境

- Vite 8.x
- Node.js `^22.13.0` または `>=24.0.0`
- `.module.scss`を使う場合は、Viteが利用できるSassの処理系（`sass`や`sass-embedded`など）

## インストール

v0.1.0はnpm registryへ公開せず、GitHub Releaseに添付するpackage tarballから配布します。Release作成後、次のURLを指定してください。

```sh
pnpm add -D https://github.com/minoshintaro/vite-plugin-bem-modules/releases/download/v0.1.0/vite-plugin-bem-modules-0.1.0.tgz
npm install -D https://github.com/minoshintaro/vite-plugin-bem-modules/releases/download/v0.1.0/vite-plugin-bem-modules-0.1.0.tgz
```

## 公開API

package rootは次のAPIを公開します。

| API | 用途 |
| --- | --- |
| default export `bemModules` | Viteへ登録するプラグインfactory |
| `defineBemModulesConfig` | Vite configとCLIで同じ設定objectを共有するidentity helper |
| `isBemGlobalClassName` | global classの一致判定を共有するhelper |
| `BemGlobalScopeOptions`、`BemModulesOptions`、`BemNamingOptions`、`BemOutputSeparator`、`BemProjectOptions`、`BemProjectStartup`、`ModifierOutput`、`WordCase` | `naming`、`globalScope`、`modifierOutput`、`types`、`project`の設定 |

CSS Moduleのclass key型は、対象ファイルの隣に生成される`.d.ts`から利用します。

## Viteへの追加

`vite.config.ts`または`vite.config.js`でプラグインを登録します。

```ts
import { defineConfig } from "vite";
import bemModules from "vite-plugin-bem-modules";

export default defineConfig({
  plugins: [bemModules()],
});
```

このパッケージはVite pluginとして動作します。PostCSS pluginやRollup pluginとしては利用できません。

## 最小例

### CSSを書く

`Card.module.css`にBlock名を宣言し、通常のCSS Modulesと同じようにclassを書きます。

```css
/* @block p-card */

.root {
  display: flex;
}

.root--compact {
  gap: 4px;
}

.profileImage {
  width: 40px;
}

.profileImage--rounded {
  border-radius: 50%;
}
```

### コンポーネントから参照する

```tsx
import styles from "./Card.module.css";

type CardProps = {
  compact?: boolean;
  rounded?: boolean;
};

export function Card({ compact = false, rounded = false }: CardProps) {
  return (
    <div className={compact ? styles.rootCompact : styles.root}>
      <img
        className={rounded ? styles.profileImageRounded : styles.profileImage}
        alt=""
      />
    </div>
  );
}
```

既定の設定では、classは次のように変換されます。

| CSS Moduleのclass | 生成されるBEM class | JavaScript / TypeScriptでの参照 |
| --- | --- | --- |
| `.root` | `p-card` | `styles.root` |
| `.root--compact` | `p-card--compact` | `styles.rootCompact` |
| `.profileImage` | `p-card__profileImage` | `styles.profileImage` |
| `.profileImage--rounded` | `p-card__profileImage--rounded` | `styles.profileImageRounded` |

Modifierのexportは、既定ではModifierのclassだけを返します。`styles.rootCompact`は`"p-card--compact"`、`styles.profileImageRounded`は`"p-card__profileImage--rounded"`になります。

```tsx
import clsx from "clsx";

const className = compact ? styles.rootCompact : styles.root;
```

BaseをModifierへ自動で含める場合は、`modifierOutput: "withBase"`を指定します。この場合、`styles.rootCompact`は`"p-card p-card--compact"`になります。`styles.root`と併用するとBaseが重複するため、どちらか一方を使います。

## CSSのルール

### Blockを宣言する

BEMとして扱うCSS Moduleには、`@block`を1つだけ書きます。

```css
/* @block p-card */
```

Block名はファイル名から推測されません。`@block`のないCSS ModuleはBEMの対象にならず、ViteのCSS Modulesとして処理されます。

同じCSS Moduleに`@block`を複数書くことはできません。また、Project scope内で同じBlock名を重複して使うこともできません。

### `root`とElement

`root`は予約されたBase名で、Blockそのものになります。

```css
.root {}
.title {}
.title--large {}
```

```text
.root          → p-card
.title         → p-card__title
.title--large  → p-card__title--large
```

`root`以外のBaseはElementとして扱われます。Modifierには対応するBaseが必要です。`.title--large`を書く場合は、`.title`も定義してください。

## 命名を既存のCSSに合わせる

既定値は次のとおりです。

| 設定 | 既定値 | 役割 |
| --- | --- | --- |
| `naming.wordCase` | `"camel"` | CSSのlocal class名をcamelCaseで書く |
| `naming.elementSeparator` | `"__"` | 生成classでBlockとElementを区切る記号 |
| `naming.modifierSeparator` | `"--"` | CSS入力と生成classでModifierを区切る記号 |

### kebab-caseを使う

既存のCSSがkebab-caseなら、`wordCase: "kebab"`を指定します。

```ts
bemModules({
  naming: {
    wordCase: "kebab",
  },
});
```

```css
/* @block p-card */

.root {}
.profile-image {}
.profile-image--rounded {}
```

JavaScript / TypeScript側のclass keyはcamelCaseになります。

```tsx
styles.profileImageRounded
```

`kebab`では、単一の`-`はElement名の一部です。既定のModifier区切りは`--`で、`modifierSeparator: "-"`は指定できません。

### Modifierの区切りを変える

`modifierSeparator`は、CSSのModifierを見つけるときと生成classでModifierをつなぐときの両方に使われます。入力だけ、または出力だけを別の区切りにすることはできません。

camelCaseで単一ハイフンを使う場合は、次のように指定します。

```ts
bemModules({
  naming: {
    wordCase: "camel",
    modifierSeparator: "-",
  },
});
```

```css
.root {}
.root-primary {}
```

この場合、`.root-primary`は`root`のModifierとして扱われ、生成されるclassは`p-card-primary`になります。

Elementとの区切りは`elementSeparator`で個別に指定できます。

```ts
bemModules({
  naming: {
    elementSeparator: "_",
    modifierSeparator: "-",
  },
});
```

この設定では、CSSに`.title-large`と書くと`p-card_title-large`になります。separatorには`-`、`--`、`_`、`__`を指定できますが、ElementとModifierに同じ値は使えません。

## 主な設定

### Modifierの出力を切り替える

`modifierOutput`は、Modifierのexport valueを切り替えます。既定値は`"only"`です。

```ts
import { defineConfig } from "vite";
import bemModules from "vite-plugin-bem-modules";

export default defineConfig({
  plugins: [bemModules({ modifierOutput: "withBase" })],
});
```

| 設定 | `styles.rootCompact` | `styles.profileImageRounded` |
| --- | --- | --- |
| `"only"` | `"p-card--compact"` | `"p-card__profileImage--rounded"` |
| `"withBase"` | `"p-card p-card--compact"` | `"p-card__profileImage p-card__profileImage--rounded"` |

### 型宣言をコミットする

`@block`を持つCSS Moduleには、serveまたは`types: true`のbuildで、class keyだけを持つ`Card.module.css.d.ts`を生成します。TypeScriptでは、定義したclass keyを補完でき、存在しないkeyを検出できます。

生成された`.d.ts`はCSS Moduleの隣に置かれます。このファイルはCSSから作られる派生ファイルですが、v0.1では利用者のプロジェクトでコミットする運用を推奨します。コミットしておけば、clone直後でもエディタと`tsc`がクラスキーの辞書を読めます。`.d.ts`は手編集せず、元のCSSを変更したときに再生成してください。

型宣言の同期では、Viteを起動しない同梱CLIを主経路にします。ローカルとCIで同じProject scopeを全走査でき、entryやimport状態に結果が左右されません。

```sh
bem-modules sync
tsc --noEmit
git diff --exit-code
test -z "$(git ls-files --others --exclude-standard -- '*.module.css.d.ts' '*.module.scss.d.ts')"
```

最後のコマンドは、未追跡の生成`.d.ts`があると失敗します。CLIの共有設定とpackage scriptの例は「CLIで検査・同期する」で説明します。

#### Vite buildから同期する

Viteのbuild lifecycleに型生成を組み込みたい場合は、`types: true`を指定した専用configでも同期できます。

```ts
// vite.types.config.ts
import { defineConfig } from "vite";
import bemModules from "vite-plugin-bem-modules";

export default defineConfig({
  plugins: [bemModules({ types: true, project: { include: ["src"] } })],
  build: {
    outDir: ".typegen-dist",
    lib: {
      entry: "src/main.ts",
      formats: ["es"],
      fileName: "index",
    },
  },
});
```

`build.lib.entry`は、型生成対象をimportするプロジェクトの実際のentryへ置き換えてください。index.htmlを持たないライブラリや共有パッケージでは、entryを明示すると型生成buildの対象が安定します。

```json
{
  "scripts": {
    "typegen": "vite build --config vite.types.config.ts"
  }
}
```

生成先の`.typegen-dist`はViteのbuild成果物なので、`.gitignore`に追加してください。この方法でも、CIでは`typegen`、`tsc`、生成物の差分確認をこの順番で実行し、新しく未追跡になった`.d.ts`も失敗にします。

`types`を省略した`vite build`は、既存の`.d.ts`を生成も削除もしません。buildで型を生成・同期する場合は`types: true`を指定してください。生成先に手書きファイルやsymlink（リンク切れを含む）があると`BEM006`になり、書き込み失敗もエラーになります。同期時の掃除はプラグインが生成した通常ファイルだけを対象とし、symlinkやその参照先には触れません。

JavaScriptプロジェクトなどで型宣言が不要な場合は、`types: false`を指定します。プラグインが生成した既存の`.d.ts`も同期時に削除されます。

```js
// vite.config.js
import { defineConfig } from "vite";
import bemModules from "vite-plugin-bem-modules";

export default defineConfig({
  plugins: [bemModules({ types: false })],
});
```

### Project scopeを決める

Project検査と型宣言同期の対象は、Viteのimport状態ではなく、`root`と`project.include` / `project.exclude`で明示します。pathはglobではなく、root相対または絶対のfile / directory pathです。

- `include`を省略するとroot全体が対象です。
- `include: []`は空集合です。
- root外のModuleは暗黙importでは対象になりません。必要なら絶対pathを`include`へ追加します。
- `exclude`はCSS Moduleと隣接`.d.ts`の両方へ適用されます。scope外のファイルは検査・削除しません。
- `node_modules`、`.git`、`dist`など既定で無視するdirectoryは、importしてもProjectの検査・型同期の対象になりません。必要なfile / directoryは`include`で明示できます。その場合も、配下の無視directoryは個別の明示が必要です。

```ts
import bemModules from "vite-plugin-bem-modules";

bemModules({
  project: {
    include: ["src", "/workspace/shared/blocks"],
    exclude: ["src/fixtures"],
  },
});
```

Project scopeにあるCSS ModuleはimportされていなくてもBlock名・生成class名の一意性検査に含まれます。これにより検査結果がentryやmodule graphで変わりません。

Vite起動時の全体走査を別の工程へ委ねる統合では、`project.startup: "defer"`を指定できます。この設定は`buildStart`でのProject全体の検査・型同期だけを延期し、Viteから到達したCSS Moduleの変換、HMR、増分一意性検査は維持します。既定の`"scan"`は起動時に明示scope全体を検査・同期します。

```ts
bemModules({
  project: {
    startup: "defer",
  },
});
```

`bem-modules check`と`bem-modules sync`は明示的なCLI操作なので、`project.startup`に関係なくscope全体を処理します。通常のアプリケーションでは既定の`"scan"`を使用し、`"defer"`は別工程が全体検査を所有する統合でだけ使用してください。

### CLIで検査・同期する

同梱の`bem-modules` CLIは、rootの`bem-modules.config.mjs`（次に`.js`）から`naming`、`globalScope`、`modifierOutput`、`project`をVite pluginと共有します。`--config`で設定pathを指定でき、`--include` / `--exclude`はProject scopeを明示的に上書きします。

```js
// bem-modules.config.mjs
export default {
  naming: { wordCase: "kebab" },
  project: { include: ["src"], exclude: ["src/fixtures"] },
};
```

```js
// vite.config.mjs
import { defineConfig } from "vite";
import bemModules, { defineBemModulesConfig } from "vite-plugin-bem-modules";
import bemConfig from "./bem-modules.config.mjs";

const config = defineBemModulesConfig(bemConfig);
export default defineConfig({ plugins: [bemModules(config)] });
```

```json
{
  "scripts": {
    "bem:check": "bem-modules check",
    "bem:sync": "bem-modules sync"
  }
}
```

`bem-modules check`は明示scopeの全Moduleを検査します。`bem-modules sync`は検査後に隣接`.d.ts`を生成・更新し、scope内のplugin-owned孤立生成物を削除します。CLIの動作modeは`types`ではなくコマンドで決まり、`check`は生成物を変更せず、`sync`は生成物を同期します。importされなくなっただけでは生成物を削除しません。

### BEMに変換しないclassを指定する

`is-*`や`has-*`のようにBlockに属さない状態classは、`globalScope`で除外できます。

```ts
bemModules({
  globalScope: {
    exact: ["active"],
    prefix: ["is-", "has-"],
  },
});
```

`exact`は完全一致、`prefix`は接頭辞一致です。対象のclassは元の名前で出力され、BEMのBaseやModifierとして扱われません。`root`は`globalScope`に一致してもBlockになります。

## 既存のCSS Modulesと併用する

`@block`のないCSS Moduleは、通常のVite処理で利用できます。

```css
/* LegacyButton.module.css */

.button {
  appearance: none;
}
```

このファイルにはBEM変換やBEM用の`.d.ts`生成は適用されません。BEMを使うファイルだけに`@block`を付けてください。

BEM対象のlocal classは最終BEM名の`:global(...)`として出力されるため、CSS Modulesのhashによるscope隔離は適用されません。Block名と生成class名はProject scope内で一意である必要があります。

## 対応範囲と注意点

- `.module.css`と`.module.scss`に対応しています。
- JavaScript / TypeScript / JSX / TSXから、通常のCSS Modulesと同じexportを参照できます。
- CSSだけを読み込むside-effect import（`import "./Card.module.css"`）も利用できます。
- framework pluginが生成するSFC内の`<style module>`など、実体pathを持たないvirtual CSS Moduleはこのプラグインの所有外です。外部の`.module.css` / `.module.scss`は、Viteが通常のCSS Moduleとして解決する範囲で利用できます。framework固有の統合動作は本プラグインの保証対象に含めません。
- CSS Modulesの`composes`は対応していません。
- BEM対象のselectorは、`.root--compact`のようにclass名を完全に静的に書いてください。Sassの`&--modifier`、`#{...}`を含むselector、`@at-root`構文は、lowering対象を確定できないため`BEM005`で拒否します。宣言値のSass補間と、明示的なselectorを使う通常のnestingは許可します。
- BEM対象ではSassの`@extend`に対応していません。source内の`@extend`は`!optional`やplaceholder宛ても`BEM005`になります。外部partialやmixin内部の`@extend`までは検出しないため、それらを経由する場合も使用しないでください。宣言の共有には、selector継承を行わないmixinを使えます。
- Sassのpartialやmixinが宣言していないlocal classをBEM対象のCSS Moduleから出力すると、`BEM009`になります。共有helper classは`:global(.sharedHelper)`として明示するか、BEM対象のCSS Moduleの外へ分離してください。
- BEM対象のCSS Moduleでは、`?raw`、`?inline`、`?url`は使えません。
- `css.modules: false`では、BEM変換・query検査・Project検査・型同期を行いません。queryの対応範囲はViteの標準処理に従います。
- `css.modules.localsConvention`で`camelCaseOnly`や`dashesOnly`のようにBEM APIのclass keyを削る設定は、`BEM009`で拒否します。`camelCase`や`dashes`のように追加aliasを残す設定は利用できます。
- `css.transformer: "lightningcss"`には対応していません。Vite標準のCSS Modules変換を使用してください。

### 診断コード

| コード | 内容 |
| --- | --- |
| `BEM001` | `@block`コメントのBlock名が空、または不正 |
| `BEM002` | 1つのCSS Moduleに`@block`が複数ある |
| `BEM003` | class名、Modifier、Block、生成class名の規則違反または衝突 |
| `BEM004` | 設定値またはCSS transformerが対応範囲外 |
| `BEM005` | Sassの動的selectorまたは非対応の`@extend`を検出 |
| `BEM006` | 隣接`.d.ts`がプラグイン所有ではない |
| `BEM007` | CSS Modulesの`composes`が使われている |
| `BEM008` | BEM対象に`?raw` / `?inline` / `?url`が付いている |
| `BEM009` | Viteの最終CSS Module exportがschemaと一致しない |

## ライセンス

MIT
