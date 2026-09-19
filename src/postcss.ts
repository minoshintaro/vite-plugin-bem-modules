import path from "node:path";
import type { Result, Root } from "postcss";
import { collectKeyframeNames, analyzeAndLowerParsedModuleIfOwned } from "./schema.js";
import { KeyframesRegistry } from "./keyframes-registry.js";
import { removeGeneratedDts, renderDts, resolveDtsPath, writeGeneratedDts } from "./dts.js";
import { canonicalFilePath } from "./utils.js";
import { resolveOptions } from "./options.js";
import type {
  BemModulesOptions,
  ResolvedBemCompilerOptions,
} from "./types.js";
import { isInNodeModules } from "./vite-utils.js";

export const BEM_POSTCSS_PLUGIN_NAME = "vite-plugin-bem-modules";
export const BEM_POSTCSS_PLUGIN_MARKER = "__vitePluginBemModulesPostcss";

export type BemPostcssDtsMode = "generate" | "remove" | "ignore";

export type BemPostcssConfigure = {
  compilerOptions: ResolvedBemCompilerOptions;
  dtsMode: BemPostcssDtsMode;
  keyframesRegistry: KeyframesRegistry;
};

export type BemPostcssPlugin = {
  postcssPlugin: typeof BEM_POSTCSS_PLUGIN_NAME;
  [BEM_POSTCSS_PLUGIN_MARKER]: true;
  Once(root: Root, helpers: { result: Result }): Promise<void>;
  configure(config: BemPostcssConfigure): void;
  cleanup(filePath: string): Promise<void>;
  ignore(filePath: string): void;
};

const CSS_MODULE_PATH = /\.module\.(?:css|scss)$/;

function isCssModulePath(filePath: string): boolean {
  return CSS_MODULE_PATH.test(filePath);
}

function conflictKey(name: string, files: readonly string[]): string {
  return `${name}\u0000${files.join("\u0000")}`;
}

function clearResolvedWarnings(
  registry: KeyframesRegistry,
  reportedConflicts: Set<string>,
): void {
  const activeKeys = new Set(registry.conflicts().map(({ name, files }) => conflictKey(name, files)));
  for (const key of reportedConflicts) {
    if (!activeKeys.has(key)) reportedConflicts.delete(key);
  }
}

function reportConflicts(
  registry: KeyframesRegistry,
  reportedConflicts: Set<string>,
  filePath: string,
  result: Result,
): void {
  clearResolvedWarnings(registry, reportedConflicts);
  for (const conflict of registry.conflicts()) {
    if (!conflict.files.includes(filePath)) continue;
    const key = conflictKey(conflict.name, conflict.files);
    if (reportedConflicts.has(key)) continue;
    const otherFile = conflict.files.find((file) => file !== filePath) ?? filePath;
    result.warn(`duplicate global keyframes "${conflict.name}" also seen in ${otherFile}`, {
      plugin: BEM_POSTCSS_PLUGIN_NAME,
    });
    reportedConflicts.add(key);
  }
}

export function createBemPostcssPlugin(options: BemModulesOptions = {}): BemPostcssPlugin {
  const resolved = resolveOptions(options);
  let compilerOptions: ResolvedBemCompilerOptions = {
    naming: resolved.naming,
    globalScope: resolved.globalScope,
    modifierOutput: resolved.modifierOutput,
  };
  let dtsMode: BemPostcssDtsMode = options.types === true ? "generate"
    : options.types === false ? "remove" : "ignore";
  let keyframesRegistry = new KeyframesRegistry();
  const reportedConflicts = new Set<string>();
  const ignoredFiles = new Set<string>();

  const cleanup = async (filePath: string): Promise<void> => {
    const canonical = canonicalFilePath(path.resolve(filePath));
    keyframesRegistry.remove(canonical);
    clearResolvedWarnings(keyframesRegistry, reportedConflicts);
    if (dtsMode !== "ignore" && isCssModulePath(canonical)) {
      await removeGeneratedDts(resolveDtsPath(canonical));
    }
  };

  const plugin: BemPostcssPlugin = {
    postcssPlugin: BEM_POSTCSS_PLUGIN_NAME,
    [BEM_POSTCSS_PLUGIN_MARKER]: true,

    configure(config) {
      compilerOptions = config.compilerOptions;
      dtsMode = config.dtsMode;
      keyframesRegistry = config.keyframesRegistry;
    },

    cleanup,

    ignore(filePath) {
      ignoredFiles.add(canonicalFilePath(path.resolve(filePath)));
    },

    async Once(root, { result }) {
      const from = result.opts.from;
      if (!from || from.startsWith("<") || from.includes("\0")) return;
      const sourcePath = canonicalFilePath(path.resolve(from));
      if (ignoredFiles.delete(sourcePath)) return;
      if (!isCssModulePath(sourcePath) || isInNodeModules(sourcePath)) return;
      const keyframeNames = collectKeyframeNames(root);
      let schema;
      try {
        schema = analyzeAndLowerParsedModuleIfOwned(sourcePath, root, compilerOptions);
      } catch (error) {
        await cleanup(sourcePath);
        throw error;
      }

      if (!schema) {
        await cleanup(sourcePath);
        return;
      }

      keyframesRegistry.replace(sourcePath, keyframeNames);
      reportConflicts(keyframesRegistry, reportedConflicts, sourcePath, result);
      if (dtsMode === "ignore") return;
      if (dtsMode === "generate") {
        await writeGeneratedDts(resolveDtsPath(sourcePath), renderDts(schema));
      } else {
        await removeGeneratedDts(resolveDtsPath(sourcePath));
      }
    },
  };
  return plugin;
}
