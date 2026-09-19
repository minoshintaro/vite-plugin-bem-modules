# Usage guide

[← README](../README.md) | English | [日本語](./guide.ja.md)

A Vite plugin that applies BEM naming rules to CSS Modules in Vite 8. Only CSS Modules with an `@block` declaration are transformed; their generated class names remain available through the familiar CSS Modules API.

```tsx
styles.root                    // "p-card"
styles.rootCompact             // "p-card--compact"
styles.profileImage            // "p-card__profileImage"
styles.profileImageRounded     // "p-card__profileImage--rounded"
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

The stable generated type surface contains class keys only. ID, keyframes, `@value`, and arbitrary ICSS export keys are intentionally outside the v0.2 TypeScript API.

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

The Vite companion and the PostCSS transformer are separate by design. Register the PostCSS factory explicitly and keep other PostCSS plugins in the same array and order. The companion fails with `BEM010` when the marker is missing. It cannot be used as a Rollup plugin.

## Minimal example

### Write the CSS

Declare the Block name in `Card.module.css`, then write classes as you would in any CSS Module:

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
| `.root` | `p-card` | `styles.root` |
| `.root--compact` | `p-card--compact` | `styles.rootCompact` |
| `.profileImage` | `p-card__profileImage` | `styles.profileImage` |
| `.profileImage--rounded` | `p-card__profileImage--rounded` | `styles.profileImageRounded` |

By default, a Modifier export contains only the Modifier class. `styles.rootCompact` is `"p-card--compact"`, and `styles.profileImageRounded` is `"p-card__profileImage--rounded"`. Add both the Base and Modifier classes to apply both sets of styles.

```tsx
const className = compact
  ? styles.root + " " + styles.rootCompact
  : styles.root;
```

To include the Base automatically, set `modifierOutput: "withBase"`. In that mode, `styles.rootCompact` becomes `"p-card p-card--compact"`. Do not combine it with `styles.root`, or the Base class will be duplicated.

## CSS rules

### Declare a Block

A CSS Module managed by this plugin must contain exactly one `@block` declaration:

```css
/* @block p-card */
```

The Block name is never inferred from the file name. A CSS Module without `@block` is left to Vite's standard CSS Modules processing.

A file cannot declare more than one `@block`. v0.2 allows the same Block or generated class name in multiple Modules; CSS keeps the normal global cascade semantics.

### `root` and Elements

`root` is the reserved Base name and represents the Block itself:

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
/* @block p-card */

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

Here, `.root-primary` is a Modifier of `root`, and the generated class is `p-card-primary`.

Configure the Element separator independently with `elementSeparator`:

```ts
bemModules({
  naming: {
    elementSeparator: "_",
    modifierSeparator: "-",
  },
});
```

With this configuration, `.title-large` becomes `p-card_title-large`. Separators may be `-`, `--`, `_`, or `__`, but the Element and Modifier separators must differ.

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
| `"only"` | `"p-card--compact"` | `"p-card__profileImage--rounded"` |
| `"withBase"` | `"p-card p-card--compact"` | `"p-card__profileImage p-card__profileImage--rounded"` |

### Commit generated type declarations

When Vite processes a CSS Module with `@block` during dev—or during a build with `types: true`—it receives an adjacent declaration such as `Card.module.css.d.ts`. The declaration contains class keys only. TypeScript can then complete the stable class API and reject missing keys.

The generated `.d.ts` is derived from the CSS source. For v0.1, committing it to the consumer repository is recommended so editors and `tsc` can resolve the class dictionary immediately after a clone. Do not edit generated declarations by hand; regenerate them whenever the source CSS changes.

The bundled CLI is the primary way to synchronize CSS declarations without starting Vite. It scans the same Project scope locally and in CI, independent of entry points and import reachability. SCSS synchronization is unavailable in the standalone CLI (`BEM004`); use a Vite build or dev server so Sass, PostCSS, CSS Modules, and declaration projection share one host-owned pipeline.

```sh
bem-modules sync
tsc --noEmit
git diff --exit-code
test -z "$(git ls-files --others --exclude-standard -- '*.module.css.d.ts' '*.module.scss.d.ts')"
```

The final command fails when a newly generated `.d.ts` remains untracked. See [Validate and synchronize with the CLI](#validate-and-synchronize-with-the-cli) for shared configuration and package-script examples.

#### Synchronize during a Vite build

To make declaration generation part of the Vite build lifecycle, use a dedicated configuration with `types: true`:

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

`project.include` / `project.exclude` define the explicit scope for `check` and `sync`, including Modules that are not imported. Project-wide Block-name and generated-class uniqueness checks are not part of v0.2.

The Vite companion does not run a full-scope Project `check` / `sync` during `buildStart`. It lets the registered PostCSS plugin generate declarations for Modules that Vite actually processes. `project.startup` remains accepted for configuration compatibility, but full-scope CSS synchronization belongs to the explicit CLI operation; SCSS remains a `BEM004` boundary for that standalone command.

```ts
bemModules({
  project: {
    startup: "defer",
  },
});
```

`bem-modules check` and `bem-modules sync` are explicit CLI operations, so they always process the full scope regardless of `project.startup`. Use the default `"scan"` for ordinary applications. Reserve `"defer"` for integrations where another step owns full-Project validation.

### Validate and synchronize with the CLI

The bundled `bem-modules` CLI reads `naming`, `globalScope`, `modifierOutput`, and `project` from `bem-modules.config.mjs` at the root, falling back to `.js`. Pass `--config` to select another configuration path. `--include` and `--exclude` explicitly override the Project scope.

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

`bem-modules check` validates every CSS Module in the explicit scope. After validation, `bem-modules sync` creates or updates adjacent `.d.ts` files and removes orphaned, plugin-owned declarations inside that scope. CLI behavior is determined by the command rather than by `types`: `check` never changes generated files, while `sync` reconciles them. A declaration is not removed merely because its Module is no longer imported. `.module.scss` files stop with `BEM004` because the standalone CLI cannot safely own Vite's Sass worker lifecycle.

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

`exact` performs an exact match, while `prefix` matches by prefix. Matching classes keep their original names and are not interpreted as BEM Bases or Modifiers. `root` always represents the Block, even if it matches `globalScope`.

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
- `css.modules.localsConvention` and other CSS Modules export options are delegated to Vite. The plugin's declaration file contains only its own class keys; additional runtime aliases are not added to that stable type contract.
- `css.transformer: "lightningcss"` is not supported. Use Vite's default CSS Modules transformer.

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
| `BEM010` | The BEM PostCSS plugin is not registered in `css.postcss.plugins` |
| `BEM011` | The unsupported Lightning CSS transformer is enabled for CSS Modules |

## License

MIT
