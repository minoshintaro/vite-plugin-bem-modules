import type { BemSourcePreprocessor } from "./project.js";

type ConfigRecord = Record<string, unknown>;

type ViteModule = {
  preprocessCSS(
    code: string,
    filename: string,
    config: ConfigRecord,
  ): Promise<{ code: string }>;
  resolveConfig(
    inlineConfig: ConfigRecord,
    command: "build" | "serve",
  ): Promise<ConfigRecord>;
};

const VITE_SPECIFIER = "vite";
const BEM_POSTCSS_PLUGIN_MARKER = "__vitePluginBemModulesPostcss";
let viteModulePromise: Promise<ViteModule> | null = null;

function isRecord(value: unknown): value is ConfigRecord {
  return typeof value === "object" && value !== null;
}

async function loadVite(): Promise<ViteModule> {
  const loaded = await import(VITE_SPECIFIER) as Partial<ViteModule>;
  if (typeof loaded.preprocessCSS !== "function" || typeof loaded.resolveConfig !== "function") {
    throw new Error("The installed Vite version must expose preprocessCSS and resolveConfig.");
  }
  return loaded as ViteModule;
}

function viteModule(): Promise<ViteModule> {
  return viteModulePromise ??= loadVite();
}

function isBemPostcssPlugin(value: unknown): boolean {
  return isRecord(value) && value[BEM_POSTCSS_PLUGIN_MARKER] === true;
}

function createPreprocessConfig(config: unknown, excludedPlugin: unknown): ConfigRecord {
  if (!isRecord(config) || !isRecord(config.css)) {
    throw new Error("Vite resolved config is missing css options.");
  }
  const css = config.css;
  const postcss = isRecord(css.postcss) ? css.postcss : {};
  const plugins = Array.isArray(postcss.plugins)
    ? postcss.plugins.filter((plugin) => plugin !== excludedPlugin && !isBemPostcssPlugin(plugin))
    : [];

  // preprocessCSS is used only for Sass and source-level PostCSS here. CSS
  // Modules and the BEM plugin must remain in Vite's real processing pass.
  return {
    ...config,
    css: {
      ...css,
      modules: false,
      postcss: { ...postcss, plugins },
    },
  };
}

export function createVitePreprocessor(
  config: unknown,
  excludedPlugin?: unknown,
): BemSourcePreprocessor {
  const preprocessConfig = createPreprocessConfig(config, excludedPlugin);
  return async (filePath, source) => {
    const { preprocessCSS } = await viteModule();
    const result = await preprocessCSS(source, filePath, preprocessConfig);
    return result.code;
  };
}

export async function resolveViteConfig(root: string): Promise<unknown> {
  const { resolveConfig } = await viteModule();
  return resolveConfig({ root, logLevel: "silent" }, "build");
}
