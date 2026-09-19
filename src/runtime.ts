import fs from "node:fs/promises";
import path from "node:path";
import type {
  ConfigEnv,
  EnvironmentModuleNode,
  HotUpdateOptions,
  ResolvedConfig,
  UserConfig,
  ViteDevServer,
} from "vite";
import { createBemDiagnosticError } from "./diagnostics.js";
import { compileBemModule } from "./compiler.js";
import { createBemProjectIndex, type BemProjectIndex, type ProjectDtsMode } from "./project.js";
import type {
  BemModuleSchema,
  BemModulesOptions,
  ResolvedBemCompilerOptions,
  ResolvedBemModulesOptions,
} from "./types.js";
import { canonicalFilePath } from "./utils.js";
import {
  isAdjacentDtsFile,
  isInNodeModules,
  isModuleFile,
  isScriptModule,
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
  handleHotUpdate(context: HotUpdateOptions): Promise<EnvironmentModuleNode[] | void>;
};

function findBemPostcssPlugin(value: unknown): BemPostcssPlugin | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findBemPostcssPlugin(item);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Partial<BemPostcssPlugin>;
  return candidate[BEM_POSTCSS_PLUGIN_MARKER] === true
    && typeof candidate.configure === "function"
    && typeof candidate.cleanup === "function"
    ? candidate as BemPostcssPlugin
    : null;
}

function resolvedPostcssPlugin(config: ResolvedConfig): BemPostcssPlugin | null {
  const postcss = config.css.postcss as unknown;
  if (typeof postcss !== "object" || postcss === null) return null;
  return findBemPostcssPlugin((postcss as { plugins?: unknown }).plugins);
}

function collectAffectedModules(modules: readonly EnvironmentModuleNode[]): EnvironmentModuleNode[] {
  const affected = new Set<EnvironmentModuleNode>(modules);
  const queue = [...modules];
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index]!;
    for (const importer of current.importers) {
      if (!isScriptModule(importer.id ?? "") || affected.has(importer)) continue;
      affected.add(importer);
      queue.push(importer);
    }
  }
  return [...affected];
}

function cssProjectionMatches(previous: BemModuleSchema, next: BemModuleSchema): boolean {
  const previousClassMap = Object.entries(previous.classMap).sort(([left], [right]) => left.localeCompare(right));
  const nextClassMap = Object.entries(next.classMap).sort(([left], [right]) => left.localeCompare(right));
  const previousExportMap = Object.entries(previous.exportMap).sort(([left], [right]) => left.localeCompare(right));
  const nextExportMap = Object.entries(next.exportMap).sort(([left], [right]) => left.localeCompare(right));
  const previousNonClassExports = [...previous.nonClassExportNames].sort();
  const nextNonClassExports = [...next.nonClassExportNames].sort();
  return JSON.stringify([
    previousClassMap,
    previousExportMap,
    previousNonClassExports,
  ]) === JSON.stringify([
    nextClassMap,
    nextExportMap,
    nextNonClassExports,
  ]);
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
  const externalSchemas = new Map<string, BemModuleSchema>();
  let project: BemProjectIndex | null = null;
  let resolvedConfig: ResolvedConfig | null = null;
  let command: ConfigEnv["command"] = "serve";
  let postcssPlugin: BemPostcssPlugin | null = null;

  const compile = async (filePath: string, source: string) => {
    if (!project) return compileBemModule({ filePath, source, options: compilerOptions });
    const canonical = canonicalFilePath(stripQuery(filePath));
    try {
      const result = await project.compile(canonical, source);
      if (project.isInScope(canonical) || !result) externalSchemas.delete(canonical);
      else externalSchemas.set(canonical, result.schema);
      return result;
    } catch (error) {
      externalSchemas.delete(canonical);
      throw error;
    }
  };

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
      externalSchemas.clear();
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
      // The PostCSS factory owns AST lowering. The Vite companion keeps this
      // hook as a no-op so Sass/PostCSS/CSS Modules are executed exactly once
      // by Vite in the user's declared plugin order.
      void filePath;
      void source;
      return null;
    },

    async handleBuildStart() {
      if (!resolvedConfig || !this.isActive() || !project) return;
      // Serve-time declarations are written by the registered PostCSS plugin
      // for modules Vite actually processes. Full-scope reconciliation is an
      // explicit `bem-modules sync`/build responsibility.
      if (command === "serve") return;
      if (resolvedOptions.project.startup === "defer") return;
      const mode = projectDtsModeFor(resolvedOptions, command);
      project.setDtsMode(mode);
      if (mode === "ignore") await project.check();
      else await project.sync();
    },

    async handleHotUpdate(context) {
      if (!resolvedConfig || !this.isActive() || isInNodeModules(context.file)) return;
      if (isAdjacentDtsFile(context.file)) return;
      if (!isModuleFile(context.file)) return;

      const canonical = canonicalFilePath(stripQuery(context.file));
      const previousSchema = project?.getSchema(canonical) ?? externalSchemas.get(canonical);
      if (context.type === "delete") {
        await project?.remove(canonical);
        await postcssPlugin?.cleanup(canonical);
        externalSchemas.delete(canonical);
        return collectAffectedModules(context.modules);
      }

      let source: string;
      try {
        source = await context.read();
      } catch (error) {
        await project?.remove(canonical);
        externalSchemas.delete(canonical);
        throw error;
      }
      // Project.compile owns failure cleanup inside its mutation queue.
      const result = await compile(canonical, source);
      if (!result) return collectAffectedModules(context.modules);
      if (previousSchema && cssProjectionMatches(previousSchema, result.schema)) return;
      return collectAffectedModules(context.modules);
    },
  };
}
