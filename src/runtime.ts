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
import { isBemModuleSourceOwned, validateBemModuleSourceSyntaxIfOwned } from "./schema.js";

export const BEM_CLI_CAPTURE_CONFIG = "__vitePluginBemModulesCliCapture";
export const BEM_VITE_COMPANION_MARKER = "__vitePluginBemModulesCompanion";
export const BEM_VITE_COMPANION_PROTOCOL = 1;

type BemRuntime = {
  options: ResolvedBemModulesOptions;
  configResolved(config: ResolvedConfig): void;
  config(config: UserConfig, _env: ConfigEnv): UserConfig;
  configureServer(server: ViteDevServer): void;
  isActive(): boolean;
  excludeVirtualCssModule(filePath: string): void;
  isOwnedCssModule(filePath: string): Promise<boolean>;
  transformCss(filePath: string, source: string): Promise<void>;
  handleBuildStart(): Promise<void>;
  handleBuildEnd(error?: Error): void;
  handleRenderError(error: Error): void;
  handleCloseBundle(error?: Error): Promise<void>;
  handleHotUpdate(context: HotUpdateOptions): Promise<void>;
};

function findBemPostcssPlugins(value: unknown): BemPostcssPlugin[] {
  if (!Array.isArray(value)) return [];
  const found: BemPostcssPlugin[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
    const candidate = item as Partial<BemPostcssPlugin>;
    if (
      candidate[BEM_POSTCSS_PLUGIN_MARKER] === true
      && typeof candidate.configure === "function"
      && typeof candidate.cleanup === "function"
    ) found.push(candidate as BemPostcssPlugin);
  }
  return found;
}

function resolvedPostcssPlugins(config: ResolvedConfig): BemPostcssPlugin[] {
  const postcss = config.css.postcss as unknown;
  if (typeof postcss !== "object" || postcss === null) return [];
  return findBemPostcssPlugins((postcss as { plugins?: unknown }).plugins);
}

function assertSupportedLocalsConvention(
  config: ResolvedConfig,
  options: ResolvedBemModulesOptions,
  command: ConfigEnv["command"],
  cliCapture: boolean,
): void {
  if (config.css.modules === false) return;
  if (dtsModeFor(options, command) !== "generate" && !cliCapture) return;
  const convention = config.css.modules?.localsConvention;
  if (convention === undefined || convention === "camelCase" || convention === "dashes") return;
  throw createBemDiagnosticError(
    "BEM004",
    "css.modules.localsConvention is not supported when BEM declarations are generated.",
    {
      details: [
        'use the Vite default, "camelCase", or "dashes".',
        '"camelCaseOnly", "dashesOnly", and callback forms can remove source class keys declared by the generated .d.ts.',
      ],
    },
  );
}

function dtsModeFor(
  options: ResolvedBemModulesOptions,
  command: ConfigEnv["command"],
): ProjectDtsMode {
  if (options.types === false) return "remove";
  if (options.types === true || command === "serve") return "generate";
  return "ignore";
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
  let cliCapture = false;

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
      const registeredPostcssPlugins = resolvedPostcssPlugins(config);
      if (registeredPostcssPlugins.length > 1) {
        throw createBemDiagnosticError(
          "BEM010",
          "BEM PostCSS plugin must be registered exactly once in css.postcss.plugins.",
          {
            details: [
              `found ${registeredPostcssPlugins.length} direct registrations.`,
              "keep one createBemPostcssPlugin() entry in the resolved PostCSS plugin array.",
            ],
          },
        );
      }
      postcssPlugin = registeredPostcssPlugins[0] ?? null;
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
      assertSupportedLocalsConvention(config, resolvedOptions, command, cliCapture);
      resolvedConfig = config;
      project = createBemProjectIndex({
        root: config.root,
        compilerOptions,
        scope: resolvedOptions.project,
        dtsMode: dtsModeFor(resolvedOptions, command),
      });
      postcssPlugin?.configure({
        enabled: config.css.modules !== false,
        compilerOptions,
        dtsMode: dtsModeFor(resolvedOptions, command) as BemPostcssDtsMode,
        deferDtsWrites: command === "build" && resolvedOptions.types === true && !cliCapture,
        keyframesRegistry: new KeyframesRegistry(),
      });
    },

    config(config, env) {
      command = env.command;
      cliCapture = (config as UserConfig & Record<string, unknown>)[BEM_CLI_CAPTURE_CONFIG] === true;
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
        void Promise.resolve()
          .then(() => postcssPlugin?.cleanup(file))
          .catch((error: unknown) => {
            const detail = error instanceof Error ? error.stack ?? error.message : String(error);
            server.config.logger.error(
              `[vite-plugin-bem-modules] failed to clean up generated artifacts for ${file}: ${detail}`,
              { error: error instanceof Error ? error : null },
            );
          });
      });
    },

    isActive() {
      return resolvedConfig?.css.modules !== false;
    },

    excludeVirtualCssModule(filePath) {
      postcssPlugin?.exclude(filePath);
    },

    async isOwnedCssModule(filePath) {
      if (isVirtualModule(filePath) || !isModuleFile(filePath)) return false;
      const source = await readSource(filePath);
      if (source === null) return false;
      return isBemModuleSourceOwned(canonicalFilePath(stripQuery(filePath)), source);
    },

    async transformCss(filePath, source) {
      // The PostCSS factory owns AST lowering. For SCSS only, inspect the raw
      // source before Vite's Sass phase so source-level BEM diagnostics such
      // as @extend and implicit nesting remain fail-closed. This hook never
      // returns transformed CSS and never runs Sass/PostCSS itself.
      if (filePath.endsWith(".module.scss")) {
        validateBemModuleSourceSyntaxIfOwned(canonicalFilePath(filePath), source);
      }
    },

    async handleBuildStart() {
      postcssPlugin?.discardDeferredDts();
      if (!resolvedConfig || !this.isActive() || !project || cliCapture) return;
      if (command === "serve") return;
      // Vite's registered PostCSS plugin owns declarations for modules that
      // the real CSS pipeline processes. Build startup only performs the
      // parse-free cleanup required by types:false; full-scope sync remains
      // the explicit CLI responsibility.
      if (resolvedOptions.types === false) await project.cleanupGeneratedDts();
    },

    handleBuildEnd(error) {
      if (error) postcssPlugin?.discardDeferredDts();
    },

    handleRenderError() {
      postcssPlugin?.discardDeferredDts();
    },

    async handleCloseBundle(error) {
      if (error) {
        postcssPlugin?.discardDeferredDts();
        return;
      }
      // Vite's programmatic build closes Rolldown without forwarding errors
      // from later writeBundle hooks. This can only honor failures already
      // reported by buildEnd or renderError.
      await postcssPlugin?.flushDeferredDts();
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
