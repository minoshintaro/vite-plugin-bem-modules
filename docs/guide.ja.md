# 利用ガイド

[← README](../README.ja.md) | [English](./guide.md) | 日本語

Vite 8のCSS ModulesにBEMの命名規則を適用し、生成されたclass名を提供するプラグインです。`@block`を付けたCSS ModuleだけがBEMの対象になり、生成されたclassは通常のCSS Modulesと同じように参照できます。

```tsx
styles.root                    // "c-card"
styles.rootCompact             // "c-card--compact"
styles.profileImage            // "c-card__profileImage"
styles.profileImageRounded     // "c-card__profileImage--rounded"
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

npmレジストリからインストールします。

```sh
pnpm add -D vite-plugin-bem-modules
npm install -D vite-plugin-bem-modules
```

## 公開API

package rootは次のAPIを公開します。

| API | 用途 |
| --- | --- |
| default export `bemModules` | Viteへ登録するプラグインfactory |
| `createBemPostcssPlugin` | `css.postcss.plugins`へ明示登録するPostCSS AST変換 |
| `defineBemModulesConfig` | Vite configとCLIで同じ設定objectを共有するidentity helper |
| `isBemGlobalClassName` | global classの一致判定を共有するhelper |
| `BemGlobalScopeOptions`、`BemModulesOptions`、`BemNamingOptions`、`BemOutputSeparator`、`BemProjectOptions`、`BemProjectStartup`、`ModifierOutput`、`WordCase` | `naming`、`globalScope`、`modifierOutput`、`types`、`project`の設定 |

生成される型の安定した公開面はclass keyだけです。ID、keyframes、`@value`、任意のICSS export keyはv0.2のTypeScript APIに含めません。

## Viteへの追加

`vite.config.ts`または`vite.config.js`でプラグインを登録します。

```ts
import { defineConfig } from "vite";
import bemModules, { createBemPostcssPlugin } from "vite-plugin-bem-modules";

export default defineConfig({
  plugins: [bemModules()],
  css: { postcss: { plugins: [createBemPostcssPlugin()] } },
});
```

Vite companionとPostCSS transformerは役割を分けています。PostCSS factoryを明示登録し、他のPostCSS pluginも同じ配列へ順番どおりに並べてください。markerが見つからない場合、companionは`BEM010`で停止します。Rollup pluginとしては利用できません。

## 最小例

### CSSを書く

`Card.module.css`にBlock名を宣言し、通常のCSS Modulesと同じようにclassを書きます。

```css
/* @block c-card */

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
    <div className={compact ? styles.root + " " + styles.rootCompact : styles.root}>
      <img
        className={rounded ? styles.profileImage + " " + styles.profileImageRounded : styles.profileImage}
        alt=""
      />
    </div>
  );
}
```

既定の設定では、classは次のように変換されます。

| CSS Moduleのclass | 生成されるBEM class | JavaScript / TypeScriptでの参照 |
| --- | --- | --- |
| `.root` | `c-card` | `styles.root` |
| `.root--compact` | `c-card--compact` | `styles.rootCompact` |
| `.profileImage` | `c-card__profileImage` | `styles.profileImage` |
| `.profileImage--rounded` | `c-card__profileImage--rounded` | `styles.profileImageRounded` |

Modifierのexportは、既定ではModifierのclassだけを返します。`styles.rootCompact`は`"c-card--compact"`、`styles.profileImageRounded`は`"c-card__profileImage--rounded"`になります。BaseとModifierの両方のスタイルを適用するには、両方のclassを指定します。

```tsx
const className = compact
  ? styles.root + " " + styles.rootCompact
  : styles.root;
```

BaseをModifierへ自動で含める場合は、`modifierOutput: "withBase"`を指定します。この場合、`styles.rootCompact`は`"c-card c-card--compact"`になります。`styles.root`と併用するとBaseが重複するため、どちらか一方を使います。

## CSSのルール

### Blockを宣言する

BEMとして扱うCSS Moduleには、`@block`を1つだけ書きます。

```css
/* @block c-card */
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
.root          → c-card
.title         → c-card__title
.title--large  → c-card__title--large
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
/* @block c-card */

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

この場合、`.root-primary`は`root`のModifierとして扱われ、生成されるclassは`c-card-primary`になります。

Elementとの区切りは`elementSeparator`で個別に指定できます。

```ts
bemModules({
  naming: {
    elementSeparator: "_",
    modifierSeparator: "-",
  },
});
```

この設定では、CSSに`.title-large`と書くと`c-card_title-large`になります。separatorには`-`、`--`、`_`、`__`を指定できますが、ElementとModifierに同じ値は使えません。

## 主な設定

### Modifierの出力を切り替える

`modifierOutput`は、Modifierのexport valueを切り替えます。既定値は`"only"`です。

```ts
import { defineConfig } from "vite";
import bemModules, { createBemPostcssPlugin } from "vite-plugin-bem-modules";

export default defineConfig({
  plugins: [bemModules({ modifierOutput: "withBase" })],
  css: { postcss: { plugins: [createBemPostcssPlugin()] } },
});
```

| 設定 | `styles.rootCompact` | `styles.profileImageRounded` |
| --- | --- | --- |
| `"only"` | `"c-card--compact"` | `"c-card__profileImage--rounded"` |
| `"withBase"` | `"c-card c-card--compact"` | `"c-card__profileImage c-card__profileImage--rounded"` |

### 型宣言をコミットする

Viteがserve中に処理した、または`types: true`でbuildした`@block`付きCSS Moduleには、`Card.module.css.d.ts`を生成します。宣言に含めるのはclass keyだけです。TypeScriptでは、安定したclass APIを補完でき、存在しないkeyを検出できます。

生成された`.d.ts`はCSS Moduleの隣に置かれます。このファイルはCSSから作られる派生ファイルですが、v0.1では利用者のプロジェクトでコミットする運用を推奨します。コミットしておけば、clone直後でもエディタと`tsc`が公開キーの辞書を読めます。`.d.ts`は手編集せず、元のCSSを変更したときに再生成してください。

型宣言の同期では、Viteのdev serverを起動しない同梱CLIを主経路にします。CLIは同じProject scopeを収集し、全Moduleをside-effect importするvirtual entryを使って一回の`write: false` programmatic Vite buildを実行します。Sass、`additionalData`、alias、custom importer、PostCSSの順序、CSS Modules、worker lifecycleはViteへ委譲されます。CIで`.module.scss`を含むscopeを検査する場合は、Viteが利用できるSass実装（`sass-embedded`など）を依存に含めてください。

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
import bemModules, { createBemPostcssPlugin } from "vite-plugin-bem-modules";

export default defineConfig({
  plugins: [bemModules({ types: true, project: { include: ["src"] } })],
  css: { postcss: { plugins: [createBemPostcssPlugin()] } },
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
import bemModules, { createBemPostcssPlugin } from "vite-plugin-bem-modules";

export default defineConfig({
  plugins: [bemModules({ types: false })],
  css: { postcss: { plugins: [createBemPostcssPlugin()] } },
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
import bemModules, { createBemPostcssPlugin } from "vite-plugin-bem-modules";

// Vite configには、上のPostCSS登録も残します。
bemModules({
  project: {
    include: ["src", "/workspace/shared/blocks"],
    exclude: ["src/fixtures"],
  },
});
```

`project.include` / `project.exclude`は、importされていないModuleも含めた`check` / `sync`の明示範囲を決めます。CLIはこの範囲をvirtual entryからimportし、個別にSass compilerや`preprocessCSS`を呼びません。v0.2ではProject全体のBlock名・生成class名の一意性検査を行いません。

`project.startup`の`"scan"`と`"defer"`は設定互換のため受け付けますが、v0.2のVite pluginはどちらでも起動時のProject全体走査を開始しません。Viteから到達したCSS Moduleの変換と型同期は実処理経路で行い、未import Moduleを含む全体同期はCLIの明示操作へ委ねます。

```ts
bemModules({
  project: {
    startup: "defer",
  },
});
```

`bem-modules check`と`bem-modules sync`は明示的なCLI操作なので、`project.startup`に関係なくscope全体を処理します。

### CLIで検査・同期する

同梱の`bem-modules` CLIは、rootの`bem-modules.config.mjs`（次に`.js`）を読み、`project`を明示scopeの決定に使います。ファイルがなければ、root以下を対象にします。`naming`、`globalScope`、`modifierOutput`、`types`をViteの処理にも反映するには、Vite configから同じ設定objectを読み込んで`bemModules(...)`へ渡します。`--config`で別の設定ファイルを指定できます。Vite configは`--root`からViteの標準探索で読み込み、明示指定が必要な場合だけ`--vite-config`を使います。`--include` / `--exclude`はProject scopeを明示的に上書きします。CLIはVite configと`bem-modules.config`の設定差分を推測・統合しません。

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
import bemModules, { createBemPostcssPlugin, defineBemModulesConfig } from "vite-plugin-bem-modules";
import bemConfig from "./bem-modules.config.mjs";

const config = defineBemModulesConfig(bemConfig);
export default defineConfig({
  plugins: [bemModules(config)],
  css: { postcss: { plugins: [createBemPostcssPlugin()] } },
});
```

```json
{
  "scripts": {
    "bem:check": "bem-modules check",
    "bem:sync": "bem-modules sync"
  }
}
```

`bem-modules check`は一回のVite buildで明示scopeの全Moduleを検査し、型宣言を変更しません。`bem-modules sync`は同じcapture済みschema集合を使い、build成功後にexpected pathを一括preflightしてから隣接`.d.ts`を生成・更新し、scope内のplugin-owned孤立生成物を削除します。buildまたはpreflightが失敗した場合、最初のfileを書き込む前なので既存型は変更されません。複数fileのOS I/Oまでを一つのtransactionとは扱わず、file単位のatomic renameの範囲を保証します。importされなくなっただけでは生成物を削除しません。

CLIは標準Vite companionの`plugins`登録と、解決済み`css.postcss.plugins`に直接登録された一つの`createBemPostcssPlugin()`を必要とし、両方をcaptureへ切り替えて再利用します。BEM PostCSS pluginは一度だけ設定順に実行され、SCSSのsource-level診断もcompanion lifecycleを通ります。Vite config、companion、直接登録のいずれかがない場合、または外部PostCSS設定だけの場合は`BEM010`で停止します。CLIはcompanionやPostCSS factoryを追加せず、外部PostCSS設定も探索・読み込み・コピー・再構成・上書きしません。CLI buildは`command: "build"`と既定の`mode: "production"`で設定を読み、Vite config内の他plugin hookも実行します。安全に回避できない副作用はCLI側で隠さないため、必要なら`--vite-config`で副作用のない専用configを指定してください。`css.modules: false`の場合は検査と同期を無効にし、0件の通常結果と区別できる通知を標準エラーへ出します。

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

`exact`は完全一致、`prefix`は接頭辞一致です。対象のclassは元の名前で出力され、BEMのBaseやModifierとして扱われません。ただし、`globalScope`は互換設定による分類なので、対象classはpluginのlocal class APIとclass-onlyの`.d.ts`へ元のkeyで残ります。明示した`:global(...)`のclassはこれと異なり、pluginのclass APIへ追加されません。`root`は`globalScope`に一致してもBlockになります。

## 既存のCSS Modulesと併用する

`@block`のないCSS Moduleは、通常のVite処理で利用できます。

```css
/* LegacyButton.module.css */

.button {
  appearance: none;
}
```

このファイルにはBEM変換やBEM用の`.d.ts`生成は適用されません。BEMを使うファイルだけに`@block`を付けてください。

BEM対象のlocal classは最終BEM名の`:global(...)`として出力されるため、CSS Modulesのhashによるscope隔離は適用されません。名前が衝突した場合は、ブラウザの通常のcascadeとanimationの規則に従います。

## 対応範囲と注意点

- `.module.css`と`.module.scss`に対応しています。
- JavaScript / TypeScript / JSX / TSXから、通常のCSS Modulesと同じexportを参照できます。
- CSSだけを読み込むside-effect import（`import "./Card.module.css"`）も利用できます。
- framework pluginが生成するSFC内の`<style module>`など、実体pathを持たないvirtual CSS Moduleはこのプラグインの所有外です。外部の`.module.css` / `.module.scss`は、Viteが通常のCSS Moduleとして解決する範囲で利用できます。framework固有の統合動作は本プラグインの保証対象に含めません。
- CSS Modulesの`composes`は対応していません。
- BEM対象のselectorは、`.root--compact`のようにclass名を完全に静的に書いてください。Sassの`&--modifier`、`#{...}`を含むselector、`@at-root`構文は、lowering対象を確定できないため`BEM005`で拒否します。宣言値のSass補間と、明示的なselectorを使う通常のnestingは許可します。
- BEM対象ではSassの`@extend`に対応していません。source内の`@extend`は`!optional`やplaceholder宛ても`BEM005`になります。外部partialやmixin内部の`@extend`までは検出しないため、それらを経由する場合も使用しないでください。宣言の共有には、selector継承を行わないmixinを使えます。
- Sassのpartialやmixinが出力する静的なlocal classも、管理対象Moduleのclassとして処理します。BEM class APIの外へ置く共有helper classは、`:global(.sharedHelper)`として明示してください。
- BEM対象のCSS Moduleでは、`?raw`、`?inline`、`?url`は使えません。
- `css.modules: false`では、BEM変換・query検査・Project検査・型同期を行いません。queryの対応範囲はViteの標準処理に従います。
- `css.modules.localsConvention`などのCSS Modules export設定はViteへ委譲します。プラグインの型宣言は自身のclass keyだけを含み、追加runtime aliasは安定した型契約に含めません。
- CSS Modulesの変換に`css.transformer: "lightningcss"`を使う構成には対応していません。Vite標準のPostCSS transformerを使用してください。`build.cssMinify: "lightningcss"`によるビルド時のCSS圧縮は利用できます。

### 診断コード

| コード | 内容 |
| --- | --- |
| `BEM001` | `@block`コメントのBlock名が空、または不正 |
| `BEM002` | 1つのCSS Moduleに`@block`が複数ある |
| `BEM003` | class名、Modifier、Blockの命名規則違反 |
| `BEM004` | 設定値またはCSS transformerが対応範囲外 |
| `BEM005` | Sassの動的selectorまたは非対応の`@extend`を検出 |
| `BEM006` | 隣接`.d.ts`がプラグイン所有ではない |
| `BEM007` | CSS Modulesの`composes`が使われている |
| `BEM008` | BEM対象に`?raw` / `?inline` / `?url`が付いている |
| `BEM010` | `css.postcss.plugins`にBEM PostCSS pluginが登録されていない |
| `BEM011` | CSS Modulesの変換にLightning CSS transformerが指定されている |

## ライセンス

MIT
