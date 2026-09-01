import fs from "node:fs/promises";
import type {
  CSSModulesOptions,
  ConfigEnv,
  EnvironmentModuleNode,
  HotUpdateOptions,
  ResolvedConfig,
  UserConfig,
} from "vite";
import { cssModuleOutputMismatchError, createBemDiagnosticError } from "./diagnostics.js";
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
  hasNonModuleQuery,
  isAdjacentDtsFile,
  isInNodeModules,
  isModuleFile,
  isScriptModule,
  isVirtualModule,
  stripQuery,
} from "./vite-utils.js";
import { resolveOptions } from "./options.js";

const OBSERVER_GET_JSON = Symbol("vite-plugin-bem-modules:getJSON");
type GetJSON = NonNullable<CSSModulesOptions["getJSON"]>;
type ObserverGetJSON = GetJSON & { [OBSERVER_GET_JSON]?: true };
type CssModulesObserverState = {
  active: boolean;
  observe: (filePath: string, json: Record<string, string>) => void;
};

function createCssModulesObserver(
  existingGetJSON: GetJSON | undefined,
  state: CssModulesObserverState,
): ObserverGetJSON {
  const observer = ((cssFileName, json, outputFileName) => {
    if (state.active) {
      existingGetJSON?.(cssFileName, json, outputFileName);
      return;
    }
    state.active = true;
    try {
      state.observe(cssFileName, json);
      existingGetJSON?.(cssFileName, json, outputFileName);
    } finally {
      state.active = false;
    }
  }) as ObserverGetJSON;
  observer[OBSERVER_GET_JSON] = true;
  return observer;
}

function isObserverGetJSON(value: GetJSON | undefined): boolean {
  return typeof value === "function"
    && (value as ObserverGetJSON)[OBSERVER_GET_JSON] === true;
}

function wrapCssModulesObserver(
  modules: CSSModulesOptions,
  state: CssModulesObserverState,
): void {
  const existingGetJSON = modules.getJSON;
  if (isObserverGetJSON(existingGetJSON)) return;
  modules.getJSON = createCssModulesObserver(existingGetJSON, state);
}

function wrapResolvedCssModulesObserver(
  config: ResolvedConfig,
  state: CssModulesObserverState,
): void {
  const modules = config.css.modules;
  if (!modules || typeof modules !== "object") return;
  wrapCssModulesObserver(modules, state);
}

type BemRuntime = {
  options: ResolvedBemModulesOptions;
  configResolved(config: ResolvedConfig): void;
  config(config: UserConfig, _env: ConfigEnv): UserConfig;
  isActive(): boolean;
  isOwnedCssModule(filePath: string): Promise<boolean>;
  transformCss(filePath: string, source: string): Promise<string | null>;
  handleBuildStart(): Promise<void>;
  handleHotUpdate(context: HotUpdateOptions): Promise<EnvironmentModuleNode[] | void>;
};

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
  return JSON.stringify([previousClassMap, previousExportMap]) === JSON.stringify([nextClassMap, nextExportMap]);
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

async function isRegularFile(filePath: string): Promise<boolean> {
  try {
    return (await fs.stat(filePath)).isFile();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR" || code === "EISDIR") return false;
    throw error;
  }
}

function mergeCssModulesObserver(
  config: UserConfig,
  state: CssModulesObserverState,
): UserConfig {
  if (config.css?.modules === false) return {};
  const existingGetJSON = config.css?.modules && typeof config.css.modules === "object"
    ? config.css.modules.getJSON
    : undefined;

  // Return only the plugin-owned delta. Vite concatenates arrays while
  // merging config hooks, so spreading the user's css config would duplicate
  // inline PostCSS plugins and other array-valued CSS options.
  return {
    css: {
      modules: {
        getJSON: createCssModulesObserver(existingGetJSON, state),
      },
    },
  };
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

  const observeCssModuleOutput = (filePath: string, json: Record<string, string>): void => {
    if (hasNonModuleQuery(filePath)) return;
    const canonical = canonicalFilePath(stripQuery(filePath));
    const schema = project?.getSchema(canonical) ?? externalSchemas.get(canonical);
    if (!schema) return;

    const expected = schema.exportMap;
    const missing = Object.keys(expected).filter((key) => json[key] !== expected[key]);
    const expectedValues = new Set([
      ...Object.values(schema.classMap),
      ...Object.values(expected),
    ]);
    const nonClassExports = new Set(schema.nonClassExportNames);
    const cssModules = resolvedConfig?.css.modules;
    const exportedGlobals = cssModules && typeof cssModules === "object" && cssModules.exportGlobals === true
      ? new Set(schema.explicitGlobalClassNames)
      : new Set<string>();
    const unexpected = Object.keys(json).filter((key) => {
      if (Object.prototype.hasOwnProperty.call(expected, key)) return false;
      if (nonClassExports.has(key)) return false;
      if (exportedGlobals.has(json[key]!)) return false;
      return !expectedValues.has(json[key]!);
    });
    if (missing.length === 0 && unexpected.length === 0) return;

    const details = [
      ...(missing.length > 0 ? [`mismatched keys: ${missing.join(", ")}`] : []),
      ...(unexpected.length > 0 ? [`unexpected keys: ${unexpected.join(", ")}`] : []),
    ];
    throw cssModuleOutputMismatchError(canonical, details);
  };

  const cssModulesObserverState: CssModulesObserverState = {
    active: false,
    observe: observeCssModuleOutput,
  };

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
          "BEM004",
          "css.transformer: \"lightningcss\" is not supported by vite-plugin-bem-modules.",
          { details: ["use the default \"postcss\" transformer for CSS Modules integration."] },
        );
      }
      wrapResolvedCssModulesObserver(config, cssModulesObserverState);
      resolvedConfig = config;
      project = createBemProjectIndex({
        root: config.root,
        compilerOptions,
        scope: resolvedOptions.project,
        dtsMode: dtsModeFor(resolvedOptions, command),
      });
      externalSchemas.clear();
    },

    config(config, env) {
      command = env.command;
      project?.setDtsMode(dtsModeFor(resolvedOptions, command));
      return mergeCssModulesObserver(config, cssModulesObserverState);
    },

    isActive() {
      return resolvedConfig?.css.modules !== false;
    },

    async isOwnedCssModule(filePath) {
      if (isVirtualModule(filePath) || !isModuleFile(filePath)) return false;
      const source = await readSource(filePath);
      if (source === null) return false;
      return (project?.analyze(canonicalFilePath(stripQuery(filePath)), source) ?? null) !== null;
    },

    async transformCss(filePath, source) {
      if (isVirtualModule(filePath)) return null;
      if (!(await isRegularFile(filePath))) return null;
      const result = await compile(canonicalFilePath(stripQuery(filePath)), source);
      return result?.loweredSource ?? null;
    },

    async handleBuildStart() {
      if (!resolvedConfig || !this.isActive() || !project) return;
      if (resolvedOptions.project.startup === "defer") return;
      project.setDtsMode(dtsModeFor(resolvedOptions, command));
      if (dtsModeFor(resolvedOptions, command) === "ignore") await project.check();
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
