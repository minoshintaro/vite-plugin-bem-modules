# vite-plugin-bem-modules

English | [日本語](./README.ja.md)

A Vite plugin that outputs CSS Module classes as BEM names such as `p-card` and `p-card__title`. Components access them through familiar keys such as `styles.root` and `styles.title`, with TypeScript completion.

Only files containing an `@block` comment in their CSS source are converted, so existing CSS Modules can remain unchanged.

## Install

```sh
npm install -D vite-plugin-bem-modules
# or
pnpm add -D vite-plugin-bem-modules
```

Requires Vite 8 and Node.js `^22.13.0` or `>=24.0.0`. Supports `.module.css` and `.module.scss`; SCSS also requires `sass` or `sass-embedded`.

## Usage

### 1. Register the plugin

Add the plugin to `vite.config.ts` or `vite.config.js`:

```ts
import { defineConfig } from "vite";
import bemModules, { createBemPostcssPlugin } from "vite-plugin-bem-modules";

export default defineConfig({
  plugins: [bemModules()],
  css: { postcss: { plugins: [createBemPostcssPlugin()] } },
});
```

### 2. Declare the Block in CSS

At the top of `Card.module.css`, write an `@block` comment as shown below. The plugin reads this comment and uses `p-card` as the Block name; it never infers the name from the file name.

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

`root` represents the Block itself, while `title` is an Element inside it. `root--compact` is a Modifier of `root`, so its Base class, `.root`, must also be defined.

| CSS class | Generated BEM class | Access |
| --- | --- | --- |
| `.root` | `p-card` | `styles.root` |
| `.root--compact` | `p-card--compact` | `styles.rootCompact` |
| `.title` | `p-card__title` | `styles.title` |

Files without an `@block` comment use ordinary CSS Modules processing.

### 3. Use the classes in a component

By default, a Modifier export does not include its Base class. Add both to `className` to apply both sets of styles:

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

## Configure as needed

### Include the Base class in Modifier exports

Set `modifierOutput: "withBase"` when registering the plugin to apply both classes using only `styles.rootCompact`:

```ts
bemModules({ modifierOutput: "withBase" });
```

With this option, `styles.rootCompact` is `"p-card p-card--compact"`. Do not add `styles.root` again.

### Change separators and name spelling

Configure separators and the spelling of names in CSS through the `naming` option passed to `bemModules`:

| Option | Default | What it changes |
| --- | --- | --- |
| `naming.elementSeparator` | `"__"` | The separator between Block and Element in output names (`p-card__title`) |
| `naming.modifierSeparator` | `"--"` | The separator before a Modifier in both source CSS and output names (`.root--compact`, `p-card--compact`) |
| `naming.wordCase` | `"camel"` | The spelling of names in CSS; `"kebab"` allows names such as `.profile-image` |

JavaScript keys remain camelCase, such as `styles.profileImage`, even with kebab-case input. See the [usage guide](https://github.com/minoshintaro/vite-plugin-bem-modules/blob/main/docs/guide.md) for supported separator combinations and configuration examples.

Use `globalScope` to exclude classes such as `is-*` from conversion, and `project.include` / `project.exclude` to limit validation and type generation. Paths are relative to Vite's `root` or absolute; they are not globs. A `globalScope` match keeps the class in the plugin's local class API and class-only declaration with its original name; an explicit `:global(.utility)` class is outside that API. You can write `:global(.utility)` directly in CSS.

## Type generation and CLI

Managed CSS Modules receive adjacent declarations such as `Card.module.css.d.ts` when Vite processes them in dev or during a build with `types: true`. Declarations contain class keys only; ID, keyframes, `@value`, and arbitrary ICSS exports are not part of the stable TypeScript API. Commit generated declarations so types are available immediately after a clone.

Set `types: true` to generate declarations for Modules that the build actually processes. Unimported Modules are intentionally left for explicit CLI synchronization. Omitting `types` during a build leaves existing declarations unchanged. `types: false` removes plugin-generated declarations in the configured scope without running a second Sass/PostCSS pass.

To validate or synchronize without starting Vite, run the bundled CLI through package scripts:

```json
{
  "scripts": {
    "bem:check": "bem-modules check",
    "bem:sync": "bem-modules sync"
  }
}
```

`npm run bem:check` validates without changing declarations; `npm run bem:sync` validates and synchronizes CSS Module declarations. The CLI creates one `write: false` programmatic Vite build with a virtual entry that imports the complete Project scope. Sass, `additionalData`, aliases, custom importers, PostCSS ordering, CSS Modules, and worker shutdown therefore remain Vite responsibilities. A Vite-compatible Sass implementation such as `sass-embedded` is required in CI when the scope contains `.module.scss` files.

That build loads Vite config with `command: "build"` and Vite's default `mode: "production"`, and it runs the other plugin hooks in the selected config. Keep those hooks free of unsafe side effects for CLI use, or select a dedicated config with `--vite-config <path>`.

`--config` continues to select `bem-modules.config.mjs` or `.js`. Vite config is discovered by Vite from `--root`; use `--vite-config <path>` only when an explicit Vite config path is needed. Share one options object from `bem-modules.config.mjs` between `bemModules(...)`, `createBemPostcssPlugin()`, and the CLI. The CLI requires the standard Vite companion in `plugins` and one direct `createBemPostcssPlugin()` registration in the resolved `css.postcss.plugins` array, then reuses that registration without adding either plugin. No Vite config, an external PostCSS config alone, a missing companion, or another indirect registration fails with `BEM010`. The CLI does not inspect, copy, reconstruct, or override external PostCSS configuration.

## Before adopting the plugin

- Generated classes use global BEM names rather than hashes. Names may collide across Modules; the resulting CSS follows the normal cascade and animation rules.
- Register `createBemPostcssPlugin()` explicitly in `css.postcss.plugins`. The Vite companion does not insert or reorder PostCSS plugins and fails during config resolution when the registration is missing.
- Class names must be explicit. Sass `&--modifier`, selector interpolation, `@at-root`, and `@extend` are unsupported.
- Managed files cannot use `composes`, `?raw`, `?inline`, or `?url`. `css.transformer: "lightningcss"` is also unsupported.
- Virtual CSS Modules without a real file path, such as framework-generated `<style module>`, are outside this plugin's scope.

See the [usage guide](https://github.com/minoshintaro/vite-plugin-bem-modules/blob/main/docs/guide.md#supported-behavior-and-limitations) for full limitations, the public API, and diagnostic codes.

## License

MIT
