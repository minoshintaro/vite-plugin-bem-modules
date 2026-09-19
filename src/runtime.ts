import fs from "node:fs/promises";
import path from "node:path";
import type {
  ConfigEnv,
  HotUpdateOptions,
  ResolvedConfig,
  UserConfig,
  ViteDevServer,
} from "vite";
import { createBemDiagnosticError } from "./diagnostics.js";
import { createBemProjectIndex, type BemProjectIndex, type ProjectDtsMode } from "./project.js";
import type {
  BemModulesOptions,
  ResolvedBemCompilerOptions,
  ResolvedBemModulesOptions,
} from "./types.js";
import { canonicalFilePath } from "./utils.js";
import {
  isAdjacentDtsFile,
  isInNodeModules,
  isModuleFile,
  isVirtualModule,
  stripQuery,
} from "./vite-utils.js";
import { resolveOptions } from "./options.js";
import {
  BEM_POSTCSS_PLUGIN_MARKER,
  type BemPostcssDtsMode,
  type BemPostcssPlugin,
} from "./postcss.js";
import { KeyframesRegistry } from "./keyframes-registry.js";

type BemRuntime = {
  options: ResolvedBemModulesOptions;
  configResolved(config: ResolvedConfig): void;
  config(config: UserConfig, _env: ConfigEnv): UserConfig;
  configureServer(server: ViteDevServer): void;
  isActive(): boolean;
  ignoreVirtualCssModule(filePath: string): void;
  isOwnedCssModule(filePath: string): Promise<boolean>;
  transformCss(filePath: string, source: string): Promise<string | null>;
  handleBuildStart(): Promise<void>;
  handleHotUpdate(context: HotUpdateOptions): Promise<void>;
};

function findBemPostcssPlugin(value: unknown): BemPostcssPlugin | null {
  if (!Array.isArray(value)) return null;
  for (const item of value) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
    const candidate = item as Partial<BemPostcssPlugin>;
    if (
      candidate[BEM_POSTCSS_PLUGIN_MARKER] === true
      && typeof candidate.configure === "function"
      && typeof candidate.cleanup === "function"
    ) return candidate as BemPostcssPlugin;
  }
  return null;
}

function resolvedPostcssPlugin(config: ResolvedConfig): BemPostcssPlugin | null {
  const postcss = config.css.postcss as unknown;
  if (typeof postcss !== "object" || postcss === null) return null;
  return findBemPostcssPlugin((postcss as { plugins?: unknown }).plugins);
}

function dtsModeFor(
  options: ResolvedBemModulesOptions,
  command: ConfigEnv["command"],
): ProjectDtsMode {
  if (options.types === false) return "remove";
  if (options.types === true || command === "serve") return "generate";
  return "ignore";
}

function projectDtsModeFor(
  options: ResolvedBemModulesOptions,
  command: ConfigEnv["command"],
): ProjectDtsMode {
  // In dev, PostCSS writes declarations only for Modules that Vite actually
  // processes. Full-scope generation remains the explicit `bem-modules sync`
  // responsibility; false still performs cleanup.
  return dtsModeFor(options, command);
}

async function readSource(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR" || code === "EISDIR") return null;
    throw error;
  }
}

function isPathWithin(filePath: string, directory: string): boolean {
  const relative = path.relative(directory, filePath);
  return relative === ""
    || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function externalProjectIncludes(
  root: string,
  includes: readonly string[],
): string[] {
  const canonicalRoot = canonicalFilePath(root);
  return [...new Set(includes
    .map((include) => canonicalFilePath(path.resolve(root, include)))
    .filter((include) => !isPathWithin(include, canonicalRoot)))];
}

export function createBemRuntime(options: BemModulesOptions = {}): BemRuntime {
  const resolvedOptions = resolveOptions(options);
  const compilerOptions: ResolvedBemCompilerOptions = {
    naming: resolvedOptions.naming,
    globalScope: resolvedOptions.globalScope,
    modifierOutput: resolvedOptions.modifierOutput,
  };
  let project: BemProjectIndex | null = null;
  let resolvedConfig: ResolvedConfig | null = null;
  let command: ConfigEnv["command"] = "serve";
  let postcssPlugin: BemPostcssPlugin | null = null;

  return {
    options: resolvedOptions,

    configResolved(config) {
      if (config.css.transformer === "lightningcss" && config.css.modules !== false) {
        throw createBemDiagnosticError(
          "BEM011",
          "css.transformer: \"lightningcss\" is not supported by vite-plugin-bem-modules.",
          { details: ["use the default \"postcss\" transformer for CSS Modules integration."] },
        );
      }
      postcssPlugin = resolvedPostcssPlugin(config);
      if (config.css.modules !== false && !postcssPlugin) {
        throw createBemDiagnosticError(
          "BEM010",
          "BEM PostCSS plugin must be explicitly registered in css.postcss.plugins.",
          {
            details: [
              "register createBemPostcssPlugin() in the same PostCSS plugin array as the other CSS plugins.",
            ],
          },
        );
      }
      resolvedConfig = config;
      project = createBemProjectIndex({
        root: config.root,
        compilerOptions,
        scope: resolvedOptions.project,
        dtsMode: projectDtsModeFor(resolvedOptions, command),
      });
      postcssPlugin?.configure({
        compilerOptions,
        dtsMode: dtsModeFor(resolvedOptions, command) as BemPostcssDtsMode,
        keyframesRegistry: new KeyframesRegistry(),
      });
    },

    config(config, env) {
      command = env.command;
      project?.setDtsMode(projectDtsModeFor(resolvedOptions, command));
      // The registered PostCSS factory owns the AST and appends the class-only
      // :export map. Vite remains the sole producer of the runtime CSS Module
      // object; do not rewrite or validate its JSON projection here.
      void config;
      return {};
    },

    configureServer(server) {
      const includes = externalProjectIncludes(server.config.root, resolvedOptions.project.include);
      if (includes.length > 0) server.watcher.add(includes);
      server.watcher.on("all", (event, file) => {
        if (event !== "unlink" || !isModuleFile(file)) return;
        void postcssPlugin?.cleanup(file);
      });
    },

    isActive() {
      return resolvedConfig?.css.modules !== false;
    },

    ignoreVirtualCssModule(filePath) {
      postcssPlugin?.ignore(filePath);
    },

    async isOwnedCssModule(filePath) {
      if (isVirtualModule(filePath) || !isModuleFile(filePath)) return false;
      const source = await readSource(filePath);
      if (source === null) return false;
      return (project?.analyze(canonicalFilePath(stripQuery(filePath)), source) ?? null) !== null;
    },

    async transformCss(filePath, source) {
      // The PostCSS factory owns AST lowering. For SCSS only, inspect the raw
      // source before Vite's Sass phase so source-level BEM diagnostics such
      // as @extend and implicit nesting remain fail-closed. This hook never
      // returns transformed CSS and never runs Sass/PostCSS itself.
      if (filePath.endsWith(".module.scss")) {
        project?.analyze(canonicalFilePath(filePath), source);
      }
      return null;
    },

    async handleBuildStart() {
      if (!resolvedConfig || !this.isActive() || !project) return;
      if (command === "serve") return;
      // Vite's registered PostCSS plugin owns declarations for modules that
      // the real CSS pipeline processes. Build startup only performs the
      // parse-free cleanup required by types:false; full-scope sync remains
      // the explicit CLI responsibility.
      if (resolvedOptions.types === false) await project.cleanupGeneratedDts();
    },

    async handleHotUpdate(context) {
      if (!resolvedConfig || !this.isActive() || isInNodeModules(context.file)) return;
      if (isAdjacentDtsFile(context.file)) return;
      if (!isModuleFile(context.file)) return;

      const canonical = canonicalFilePath(stripQuery(context.file));
      if (context.type === "delete") {
        await project?.remove(canonical);
        await postcssPlugin?.cleanup(canonical);
        return;
      }
      // Vite's module graph and the registered PostCSS plugin own regular
      // update processing. Do not read, parse, or return importer modules here.
    },
  };
}
