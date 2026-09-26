# vite-plugin-bem-modules

English | [日本語](./README.ja.md)

This plugin turns Vite CSS Module classes into BEM names such as `c-card`, `c-card__title`, and `c-card--compact`.

Components use ordinary CSS Module keys such as `styles.root` and `styles.title`. If you generate adjacent type declarations, editors can complete those keys and type checking can catch references to missing classes.

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

Only `.module.css` and `.module.scss` files with an `@block` comment receive BEM names. CSS Modules without the comment, ordinary CSS, and CSS Modules in dependencies use Vite's standard processing.

## Requirements

- Vite 8.x
- Node.js `^22.13.0` or `>=24.0.0`
- `.module.css` and `.module.scss`
- Vite's default PostCSS transformer

For SCSS, install a Sass implementation supported by Vite:

```sh
pnpm add -D sass-embedded
# or
npm install -D sass-embedded
```

The plugin does not support `css.transformer: "lightningcss"` for CSS Modules. You can still use `build.cssMinify: "lightningcss"` to minify CSS during a build.

## Install

```sh
pnpm add -D vite-plugin-bem-modules
# or
npm install -D vite-plugin-bem-modules
```

## Quick start

### 1. Register the Vite and PostCSS plugins

Register both plugins in `vite.config.ts` or `vite.config.js`:

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

`createBemPostcssPlugin()` is required. Put other PostCSS plugins in the same array. PostCSS visitor phases can run after this plugin analyzes the CSS even when another plugin appears earlier in the array; classes added or renamed in those phases are outside the supported scope. Here, `types: true` enables declaration generation during a build.

### 2. Declare the Block in a CSS Module

Create `Card.module.css` and give it a Block name with an `@block` comment. The plugin does not infer the Block name from the file name.

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

The classes become:

| CSS Module class | Output class | Component access |
| --- | --- | --- |
| `.root` | `c-card` | `styles.root` |
| `.root--compact` | `c-card--compact` | `styles.rootCompact` |
| `.title` | `c-card__title` | `styles.title` |

`.root` becomes the Block name itself. A class such as `.title` becomes an Element. Each Modifier needs its base class: define `.title` if you use `.title--large`.

### 3. Use the classes in a component

By default, `modifierOutput: "only"` leaves the base class out of a Modifier value. Include both classes when you need both sets of styles.

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

## Main options

Pass BEM options to `bemModules(...)` in your Vite config. You can write them there directly. If you also use the CLI, put shared options in `bem-modules.config.mjs`, import the file in your Vite config, and pass its exported object to `bemModules(config)`. The CLI finds the file automatically.

| Option | Default | Purpose |
| --- | --- | --- |
| `modifierOutput` | `"only"` | Choose whether Modifier values include their base class |
| `naming.wordCase` | `"camel"` | Use camelCase or kebab-case class names in CSS Modules |
| `naming.elementSeparator` | `"__"` | Separate Block and Element in output names |
| `naming.modifierSeparator` | `"--"` | Separate Modifiers in source and output names |
| `globalScope.exact` | `[]` | Exclude exact class names from BEM conversion |
| `globalScope.prefix` | `[]` | Exclude class names with these prefixes from BEM conversion |
| `types` | Depends on command | Generate, retain, or remove adjacent declarations |
| `project.include` | `["."]` | Include files or directories for CLI synchronization and generated-declaration cleanup |
| `project.exclude` | `[]` | Exclude files or directories from that scope |

`project.include` and `project.exclude` do not accept glob patterns. Use file or directory paths relative to Vite's `root`, or absolute paths. `include: []` selects no files.

This scope controls CLI synchronization and cleanup of generated declarations. Vite still converts any imported CSS Module with a real file path and an `@block` comment, even when it falls outside this scope.

### Include the base class in Modifier values

```ts
bemModules({
  modifierOutput: "withBase",
});
```

With this option, `styles.rootCompact` is `"c-card c-card--compact"`. You do not need to add `styles.root` separately.

### Use kebab-case class names

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

JavaScript and TypeScript can still use camelCase keys:

```ts
styles.profileImage;
styles.profileImageRounded;
```

The Element and Modifier separators can each be `"-"`, `"--"`, `"_"`, or `"__"`, but cannot be the same. With `wordCase: "kebab"`, a single `-` separates words, so `modifierSeparator: "-"` is unsupported.

### Keep classes out of BEM conversion

You can use the standard CSS Modules `:global(...)` syntax:

```css
/* @block c-card */

:global(.utility) .title {
  display: block;
}
```

To keep names such as `is-*` and `has-*` out of BEM conversion, use `globalScope`:

```ts
bemModules({
  globalScope: {
    exact: ["active"],
    prefix: ["is-", "has-"],
  },
});
```

`root` always represents the Block, so it is converted even when it matches `globalScope`.

A class matched by `globalScope` keeps its original global name and key in the plugin's class API and `.d.ts` file. A class written directly as `:global(...)` in CSS is not added to that API.

### Share options between Vite and the CLI

`bem-modules.config.mjs` is optional. Without it, the CLI scans the project root. Use this file to give the CLI a reusable scope through `project.include` and `project.exclude`.

The CLI also needs the Vite configuration shown in Quick start. Vite does not automatically load `bem-modules.config.mjs`: import it in Vite config to use those options during Vite processing. The CLI reads the file itself to select its scope.

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

The CLI looks for `bem-modules.config.mjs`, then `bem-modules.config.js`. Use `--config <path>` to select another file, and import that same file in Vite config if you want matching options. Vite finds its own config file separately.

## Manage type declarations

When Vite processes a BEM CSS Module, the plugin can generate a declaration such as `Card.module.css.d.ts` next to the source file:

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

Declarations contain class keys only. They do not include IDs, keyframes, `@value`, or arbitrary ICSS `:export` entries.

| Command | `types` | Behavior |
| --- | --- | --- |
| Vite dev server | Omitted or `true` | Generate or update declarations for processed BEM CSS Modules |
| Vite build | `true` | Generate or update declarations for processed BEM CSS Modules |
| Vite build | Omitted | Leave existing declarations unchanged |
| Vite dev server / build | `false` | Remove generated declarations for processed Modules; a build also cleans the configured scope |
| `bem-modules sync` | — | Scan all CSS Modules in scope and synchronize declarations |

Commit generated `.d.ts` files without editing them by hand. Editors and `tsc` can then read the types immediately after a clone. If a handwritten file or symbolic link occupies a declaration path, the plugin stops with `BEM006` instead of overwriting it.

### Check CSS Modules and synchronize declarations in one pass

The Vite dev server and build process convert only the CSS Modules they load. Use the CLI to check unimported files and bring their declarations up to date. Add these scripts to `package.json` and run the one you need:

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

- `bem:check` validates files in scope without changing declarations.
- `bem:sync` validates, generates or updates declarations, and removes plugin-generated declarations no longer needed within the scope.

Declarations are inputs to type checking. After changing CSS Modules or options that affect class keys, run `bem:sync → tsc → vite build` in that order. Commit the generated declarations so unchanged builds do not need to synchronize them again. In CI, check for changes after synchronization to detect stale declarations. Generating declarations during a build with `types: true` cannot supply them to a type check that runs before that build.

The CLI processes the scoped CSS Modules in one Vite build without writing build output. It uses Vite's configuration for SCSS compilation, aliases, `additionalData`, custom importers, and PostCSS order. An environment that checks `.module.scss` files needs a Sass implementation supported by Vite, such as `sass-embedded`.

The CLI uses the plugins already registered in Vite config. If either plugin is missing, or the PostCSS plugin is registered only in an external PostCSS config, it stops with `BEM010`. The CLI also accepts `--root` and repeatable `--include` and `--exclude` options.

Because the CLI uses a Vite build, hooks from other Vite plugins also run. If their side effects are a problem, select a dedicated Vite config with `--vite-config <path>`.

## CSS and SCSS behavior

### Use Vite's CSS pipeline

Vite handles SCSS compilation, aliases, `additionalData`, custom importers, PostCSS, CSS Modules, and HMR. The plugin does not start a separate Sass compiler. It analyzes the CSS that Vite passes to PostCSS, so classes produced by a mixin appear in both the CSS and the declarations.

### Write explicit Sass class names

Write BEM class names in a form that can be determined statically:

```scss
/* @block c-card */

.root {}
.root--compact {}
```

This form is unsupported:

```scss
.root {
  &--compact {}
}
```

`&--modifier`, selector interpolation, `@at-root`, and `@extend` are rejected with `BEM005`. To share declarations, use a mixin that does not extend selectors.

### IDs and keyframes keep global names

In BEM CSS Modules, IDs and `@keyframes` are not exported by CSS Modules; they keep the names written in the source. References in `animation` and `animation-name` use those same names.

Defining the same `@keyframes` name in multiple BEM files produces a warning without stopping the build. The normal CSS rules determine which animation applies.

### Generated classes have global names too

Generated BEM classes do not receive CSS Module hashes. Different CSS Modules may output the same Block or class name. If they collide, the normal CSS cascade determines the result.

### Use ordinary CSS Modules alongside BEM Modules

`.module.css` and `.module.scss` files without `@block` remain ordinary Vite CSS Modules in the same project.

```css
/* Plain.module.css */
.root {
  color: rebeccapurple;
}
```

Ordinary CSS, CSS Modules under `node_modules`, and virtual CSS Modules without a real file path are also outside this plugin's scope.

## Unsupported features

- CSS Modules `composes`
- `?raw`, `?inline`, or `?url` imports of BEM CSS Modules
- Sass `&--modifier`, selector interpolation, `@at-root`, and `@extend`
- `css.transformer: "lightningcss"` for CSS Modules
- Virtual CSS Modules without a real file path, such as framework-generated `<style module>`
- Classes added or renamed by another PostCSS plugin after BEM analysis, including `Rule` and `AtRule` visitors

Deleting an imported CSS Module makes its import fail to resolve. The plugin cleans up adjacent declarations and its internal state but does not change the importing source file.

## Diagnostic codes

Errors use codes in the form `[vite-plugin-bem-modules:BEMxxx]`.

| Code | Meaning |
| --- | --- |
| `BEM001` | Missing or invalid `@block` name |
| `BEM002` | Multiple `@block` comments in one CSS Module |
| `BEM003` | Invalid or colliding class, Modifier, Block, or generated name |
| `BEM004` | Unsupported option, command, or feature |
| `BEM005` | Dynamic Sass selector or `@extend` |
| `BEM006` | Adjacent declaration is not a regular file owned by the plugin |
| `BEM007` | `composes` is used |
| `BEM008` | Unsupported query on a BEM CSS Module |
| `BEM010` | Missing Vite or PostCSS plugin registration, or duplicate PostCSS plugin |
| `BEM011` | Lightning CSS selected as the CSS Modules transformer |

## Public API

| API | Purpose |
| --- | --- |
| Default export `bemModules` | Create the Vite plugin |
| `createBemPostcssPlugin` | Create the PostCSS plugin that converts BEM classes |
| `defineBemModulesConfig` | Type and return shared options for Vite and the CLI |
| `isBemGlobalClassName` | Check a class name against `globalScope` |
| `BemModulesOptions` and other public types | Write options in TypeScript |

Low-level compiler, project, schema, and keyframes bookkeeping implementations are not part of the public API.

## License

MIT
