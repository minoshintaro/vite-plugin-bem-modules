# Usage guide

[← README](../README.md) | English | [日本語](./guide.ja.md)

A Vite plugin that applies BEM naming rules to CSS Modules in Vite 8. Only CSS Modules with an `@block` declaration are transformed; their generated class names remain available through the familiar CSS Modules API.

```tsx
styles.root                    // "c-card"
styles.rootCompact             // "c-card--compact"
styles.profileImage            // "c-card__profileImage"
styles.profileImageRounded     // "c-card__profileImage--rounded"
```

## Features

- Model CSS Module classes as Blocks, Elements, and Modifiers.
- Access generated classes through flat keys such as `styles.rootCompact`.
- Choose whether Modifier exports include their Base with `modifierOutput`.
- Generate TypeScript declarations for CSS Module exports.
- Leave CSS Modules without `@block` to Vite's standard processing.

## Requirements

- Vite 8.x
- Node.js `^22.13.0` or `>=24.0.0`
- A Sass implementation available to Vite, such as `sass` or `sass-embedded`, when using `.module.scss`

## Installation

Install the package from the npm registry:

```sh
pnpm add -D vite-plugin-bem-modules
npm install -D vite-plugin-bem-modules
```

## Public API

The package root exports the following API:

| API | Purpose |
| --- | --- |
| default export `bemModules` | Plugin factory registered with Vite |
| `createBemPostcssPlugin` | PostCSS AST transform registered explicitly in `css.postcss.plugins` |
| `defineBemModulesConfig` | Identity helper for sharing one configuration object between Vite and the CLI |
| `isBemGlobalClassName` | Helper for applying the same global-class matching rules elsewhere |
| `BemGlobalScopeOptions`, `BemModulesOptions`, `BemNamingOptions`, `BemOutputSeparator`, `BemProjectOptions`, `BemProjectStartup`, `ModifierOutput`, `WordCase` | Types for `naming`, `globalScope`, `modifierOutput`, `types`, and `project` options |

The stable generated type surface contains class keys only. ID, keyframes, `@value`, and arbitrary ICSS export keys are intentionally outside the v0.1 TypeScript API.

## Add the plugin to Vite

Register the plugin in `vite.config.ts` or `vite.config.js`:

```ts
import { defineConfig } from "vite";
import bemModules, { createBemPostcssPlugin } from "vite-plugin-bem-modules";

export default defineConfig({
  plugins: [bemModules()],
  css: { postcss: { plugins: [createBemPostcssPlugin()] } },
});
```

The Vite companion and the PostCSS transformer are separate by design. Register one PostCSS factory explicitly and keep other PostCSS plugins in the same array and order. The companion fails with `BEM010` when the marker is missing or appears more than once. It cannot be used as a Rollup plugin.

## Minimal example

### Write the CSS

Declare the Block name in `Card.module.css`, then write classes as you would in any CSS Module:

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

### Use it from a component

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

With the default options, the classes are transformed as follows:

| CSS Module class | Generated BEM class | JavaScript / TypeScript key |
| --- | --- | --- |
| `.root` | `c-card` | `styles.root` |
| `.root--compact` | `c-card--compact` | `styles.rootCompact` |
| `.profileImage` | `c-card__profileImage` | `styles.profileImage` |
| `.profileImage--rounded` | `c-card__profileImage--rounded` | `styles.profileImageRounded` |

By default, a Modifier export contains only the Modifier class. `styles.rootCompact` is `"c-card--compact"`, and `styles.profileImageRounded` is `"c-card__profileImage--rounded"`. Add both the Base and Modifier classes to apply both sets of styles.

```tsx
const className = compact
  ? styles.root + " " + styles.rootCompact
  : styles.root;
```

To include the Base automatically, set `modifierOutput: "withBase"`. In that mode, `styles.rootCompact` becomes `"c-card c-card--compact"`. Do not combine it with `styles.root`, or the Base class will be duplicated.

## CSS rules

### Declare a Block

A CSS Module managed by this plugin must contain exactly one `@block` declaration:

```css
/* @block c-card */
```

The Block name is never inferred from the file name. A CSS Module without `@block` is left to Vite's standard CSS Modules processing.

A file cannot declare more than one `@block`. v0.1 allows the same Block or generated class name in multiple Modules; CSS keeps the normal global cascade semantics.

### `root` and Elements

`root` is the reserved Base name and represents the Block itself:

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

Every Base other than `root` is an Element. A Modifier must have a corresponding Base: defining `.title--large` also requires `.title`.

## Match an existing naming convention

The defaults are:

| Option | Default | Purpose |
| --- | --- | --- |
| `naming.wordCase` | `"camel"` | Write local CSS class names in camelCase |
| `naming.elementSeparator` | `"__"` | Separate the Block and Element in generated classes |
| `naming.modifierSeparator` | `"--"` | Separate Modifiers in both source and generated classes |

### Use kebab-case

Set `wordCase: "kebab"` when the existing CSS uses kebab-case:

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

The JavaScript / TypeScript key remains camelCase:

```tsx
styles.profileImageRounded
```

In `kebab` mode, a single `-` belongs to the Element name. The default Modifier separator is `--`, and `modifierSeparator: "-"` is not allowed.

### Change the Modifier separator

`modifierSeparator` is used both to identify Modifiers in source CSS and to join them in generated classes. Input and output separators cannot be configured independently.

To use a single hyphen with camelCase names:

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

Here, `.root-primary` is a Modifier of `root`, and the generated class is `c-card-primary`.

Configure the Element separator independently with `elementSeparator`:

```ts
bemModules({
  naming: {
    elementSeparator: "_",
    modifierSeparator: "-",
  },
});
```

With this configuration, `.title-large` becomes `c-card_title-large`. Separators may be `-`, `--`, `_`, or `__`, but the Element and Modifier separators must differ.

## Main options

### Choose Modifier output

`modifierOutput` controls the exported value of a Modifier. Its default is `"only"`.

```ts
import { defineConfig } from "vite";
import bemModules, { createBemPostcssPlugin } from "vite-plugin-bem-modules";

export default defineConfig({
  plugins: [bemModules({ modifierOutput: "withBase" })],
  css: { postcss: { plugins: [createBemPostcssPlugin()] } },
});
```

| Option | `styles.rootCompact` | `styles.profileImageRounded` |
| --- | --- | --- |
| `"only"` | `"c-card--compact"` | `"c-card__profileImage--rounded"` |
| `"withBase"` | `"c-card c-card--compact"` | `"c-card__profileImage c-card__profileImage--rounded"` |

### Commit generated type declarations

When Vite processes a CSS Module with `@block` during dev—or completes a build with `types: true`—it writes an adjacent declaration such as `Card.module.css.d.ts`. The declaration contains class keys only. Build declarations are staged during PostCSS processing and written from Vite's public `closeBundle` hook. Successful builds also write declarations with `build.write: false`. If a failure reaches `buildEnd` or `renderError`, the plugin discards the staged declarations; we verified that a CSS Modules transformation failure preserves the previous declaration. Vite's programmatic build does not forward a later `writeBundle` hook failure to `closeBundle`, so a `.d.ts` may already have changed even when a later `writeBundle` plugin makes the build reject. Declaration preservation is not guaranteed for failures at that stage. Before flushing, the plugin checks ownership of every write target, so `BEM006` leaves all declarations untouched. If a later operating system write fails after that check, updates across multiple declaration files are not transactional.

The generated `.d.ts` is derived from the CSS source and is an input to type checking. Commit it to the consumer repository so editors and `tsc` can resolve the class dictionary immediately after a clone. Do not edit generated declarations by hand; regenerate them whenever the source CSS changes.

The bundled CLI is the primary way to synchronize CSS declarations without starting a Vite dev server. It collects the same Project scope and runs one `write: false` programmatic Vite build whose virtual entry side-effect-imports every collected Module. Sass, `additionalData`, aliases, custom importers, PostCSS ordering, CSS Modules, and worker lifecycle therefore remain in Vite's pipeline. CI that includes `.module.scss` needs a Sass implementation available to Vite, such as `sass-embedded`.

```sh
bem-modules sync
tsc --noEmit
vite build
git diff --exit-code
test -z "$(git ls-files --others --exclude-standard -- '*.module.css.d.ts' '*.module.scss.d.ts')"
```

Use this sequence when declarations may be stale, such as after changing a CSS Module or settings that affect class keys. Committed declarations do not need to be regenerated for every local build. CI can run this sequence on every build to detect stale declarations; the final command fails when a newly generated `.d.ts` remains untracked. See [Validate and synchronize with the CLI](#validate-and-synchronize-with-the-cli) for shared configuration and package-script examples.

#### Optional build-time synchronization

To make declaration generation part of the Vite build lifecycle, use a dedicated configuration with `types: true`. This can help generate declarations for Modules processed by that build, but does not supply them to an earlier type check:

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

Replace `build.lib.entry` with a real entry point that imports the files whose types must be generated. An explicit entry keeps type-generation builds deterministic for libraries and shared packages without `index.html`.

```json
{
  "scripts": {
    "typegen": "vite build --config vite.types.config.ts"
  }
}
```

Add `.typegen-dist` to `.gitignore`; it is an ordinary Vite build artifact. In CI, run `typegen`, `tsc`, and the generated-file diff checks in that order, and fail when a new `.d.ts` is left untracked.

A `vite build` without `types` neither creates nor removes existing declarations. Set `types: true` when the build should synchronize them. If the target is a handwritten file or a symlink—including a dangling symlink—the operation fails with `BEM006`. Cleanup removes only regular files generated by the plugin and never follows symlinks.

Set `types: false` when a JavaScript project does not need declarations. Synchronization also removes existing declarations previously generated by the plugin.

```js
// vite.config.js
import { defineConfig } from "vite";
import bemModules, { createBemPostcssPlugin } from "vite-plugin-bem-modules";

export default defineConfig({
  plugins: [bemModules({ types: false })],
  css: { postcss: { plugins: [createBemPostcssPlugin()] } },
});
```

### Define the Project scope

Project validation and declaration synchronization operate on the explicit `root` plus `project.include` / `project.exclude`, not on Vite's current import graph. Paths are root-relative or absolute file and directory paths—not globs.

- Omitting `include` selects the entire root.
- `include: []` selects nothing.
- A Module outside the root is not selected merely because it is imported. Add an absolute path to `include` when it belongs to the Project.
- `exclude` applies to both CSS Modules and adjacent `.d.ts` files. Files outside the scope are neither validated nor removed.
- Directories ignored by default, including `node_modules`, `.git`, and `dist`, remain outside Project validation and type synchronization even when imported. An explicitly included file or directory is admitted, but nested ignored directories still require their own explicit include.

```ts
import bemModules, { createBemPostcssPlugin } from "vite-plugin-bem-modules";

// Keep this PostCSS registration in the Vite config as shown above.
bemModules({
  project: {
    include: ["src", "/workspace/shared/blocks"],
    exclude: ["src/fixtures"],
  },
});
```

`project.include` / `project.exclude` define the explicit scope for `check` and `sync`, including Modules that are not imported. The CLI imports that complete scope through its virtual entry; it does not call the compiler or Vite's experimental `preprocessCSS` separately. Project-wide Block-name and generated-class uniqueness checks are not part of v0.1.

The Vite companion does not run a full-scope Project `check` / `sync` during `buildStart`. It lets the registered PostCSS plugin generate declarations for Modules that Vite actually processes. Both `project.startup: "scan"` and `"defer"` remain accepted for configuration compatibility, but neither starts a full-scope scan; explicit CSS synchronization belongs to the CLI operation.

```ts
bemModules({
  project: {
    startup: "defer",
  },
});
```

`bem-modules check` and `bem-modules sync` are explicit CLI operations, so they always process the full scope regardless of `project.startup`.

### Validate and synchronize with the CLI

The bundled `bem-modules` CLI reads `bem-modules.config.mjs` at the root, falling back to `.js`, and uses its `project` option to select the explicit scope. Without that file, it uses the project root as the scope. To apply `naming`, `globalScope`, `modifierOutput`, and `types` during Vite processing, import the same options object in Vite config and pass it to `bemModules(...)`. Use `--config` to select another options file. Vite config is loaded by Vite's standard search from `--root`; pass `--vite-config` only when an explicit Vite config path is needed. `--include` and `--exclude` explicitly override the Project scope. The CLI does not infer or merge differences between the two config files.

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

`bem-modules check` validates every CSS Module in the explicit scope through that one Vite build and never changes declarations. `bem-modules sync` uses the same captured schema set, preflights every expected declaration, then creates or updates adjacent `.d.ts` files and removes orphaned, plugin-owned declarations inside that scope. A failed build or ownership preflight leaves declarations unchanged; multiple OS writes are not presented as one transaction. A declaration is not removed merely because its Module is no longer imported—the virtual entry makes the scope explicit.

The CLI requires the standard Vite companion in `plugins` and exactly one direct `createBemPostcssPlugin()` marker in the resolved `css.postcss.plugins` array, then reuses both for capture. The BEM PostCSS transform therefore runs once and stays in the configured array order, while SCSS source-level diagnostics continue through the companion lifecycle. A missing or duplicate direct registration, a missing Vite config or companion, or an external PostCSS config without these Vite registrations fails with `BEM010`. The CLI does not inject either plugin and does not inspect, load, copy, reconstruct, or override external PostCSS settings. The build loads config with `command: "build"` and the default `mode: "production"`, and it runs the other Vite plugin hooks. Use `--vite-config` to select a side-effect-free config when necessary. With `css.modules: false`, validation and synchronization are disabled and the CLI writes a notice to standard error so this state is distinguishable from an ordinary zero-file result.

### Exclude global classes from BEM conversion

Use `globalScope` for state classes such as `is-*` and `has-*` that do not belong to a Block:

```ts
bemModules({
  globalScope: {
    exact: ["active"],
    prefix: ["is-", "has-"],
  },
});
```

`exact` performs an exact match, while `prefix` matches by prefix. Matching classes keep their original names and are not interpreted as BEM Bases or Modifiers. They still remain in the plugin's local class API and class-only declaration because `globalScope` is a compatibility classification, not the same as an explicit `:global(...)` selector. An explicit `:global(...)` class stays outside the plugin's class API. `root` always represents the Block, even if it matches `globalScope`.

## Use alongside existing CSS Modules

A CSS Module without `@block` uses Vite's standard processing:

```css
/* LegacyButton.module.css */

.button {
  appearance: none;
}
```

This file receives neither BEM transformation nor a BEM declaration file. Add `@block` only to files managed by this plugin.

Local classes in managed Modules are emitted as final BEM names inside `:global(...)`, so CSS Modules hashing no longer provides scope isolation for them. If names collide, the browser applies its normal CSS cascade and animation rules.

## Supported behavior and limitations

- `.module.css` and `.module.scss` are supported.
- JavaScript, TypeScript, JSX, and TSX can access the standard CSS Modules export.
- Side-effect-only CSS imports such as `import "./Card.module.css"` are supported.
- Virtual CSS Modules without a real file path, such as `<style module>` emitted by framework plugins, are outside this plugin's ownership. External `.module.css` and `.module.scss` files work when Vite resolves them as ordinary CSS Modules, but framework-specific integration behavior is not guaranteed.
- CSS Modules `composes` is not supported.
- Managed selectors must spell out static class names such as `.root--compact`. Sass `&--modifier`, selector interpolation containing `#{...}`, and `@at-root` are rejected with `BEM005` because they prevent deterministic lowering. Sass interpolation in declaration values and ordinary nesting with explicit selectors are supported.
- Sass `@extend` is not supported in managed Modules. Any source-level `@extend`, including `!optional` and placeholder targets, produces `BEM005`. The plugin cannot detect `@extend` hidden inside external partials or mixins, so those forms must also be avoided. Use mixins that share declarations without selector inheritance.
- Static local classes emitted by a Sass partial or mixin are processed as part of the managed Module. Mark shared helper classes explicitly as `:global(.sharedHelper)` when they must remain outside the BEM class API.
- `?raw`, `?inline`, and `?url` cannot be used with a managed Module.
- With `css.modules: false`, BEM transformation, query validation, Project validation, and type synchronization are disabled. Query behavior falls back to Vite.
- `css.modules.localsConvention` and other CSS Modules export options are delegated to Vite. While declarations are generated (`types: true` for builds; by default in dev), the supported convention is Vite's default, `camelCase`, or `dashes`. `camelCaseOnly`, `dashesOnly`, and callback forms are rejected with `BEM004` because they can remove source class keys from the runtime object while the declaration still exposes them. With `types: false`, this type-alignment check is skipped.
- Using Lightning CSS as the CSS Modules transformer (`css.transformer: "lightningcss"`) is unsupported. Use Vite's default PostCSS transformer. Build-time CSS minification with Lightning CSS (`build.cssMinify: "lightningcss"`) is supported.

### Diagnostic codes

| Code | Meaning |
| --- | --- |
| `BEM001` | The Block name in `@block` is empty or invalid |
| `BEM002` | A CSS Module contains more than one `@block` declaration |
| `BEM003` | A class name, Modifier, or Block violates the naming rules |
| `BEM004` | A configuration value or CSS transformer is unsupported |
| `BEM005` | A dynamic Sass selector or unsupported `@extend` was found |
| `BEM006` | An adjacent `.d.ts` is not owned by the plugin |
| `BEM007` | CSS Modules `composes` is used |
| `BEM008` | A managed Module is imported with `?raw`, `?inline`, or `?url` |
| `BEM010` | The BEM PostCSS plugin is missing or registered more than once in `css.postcss.plugins` |
| `BEM011` | Lightning CSS is selected as the CSS Modules transformer |

## License

MIT
