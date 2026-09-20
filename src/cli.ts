#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build, type InlineConfig, type Plugin, type ResolvedConfig, type UserConfig } from "vite";
import {
  assertGeneratedDtsWritable,
  isPluginGeneratedDts,
  removeGeneratedDts,
  renderDts,
  resolveDtsPath,
  writeGeneratedDts,
} from "./dts.js";
import { createBemDiagnosticError } from "./diagnostics.js";
import { collectAdjacentDtsFiles, collectModuleFiles } from "./files.js";
import {
  BEM_POSTCSS_CAPTURE_MARKER,
  BEM_POSTCSS_PLUGIN_MARKER,
  type BemPostcssPlugin,
} from "./postcss.js";
import {
  BEM_CLI_CAPTURE_CONFIG,
  BEM_VITE_COMPANION_MARKER,
  BEM_VITE_COMPANION_PROTOCOL,
} from "./runtime.js";
import { resolveOptions } from "./options.js";
import { canonicalFilePath, normalizeFilePath } from "./utils.js";
import type { BemModuleSchema, BemModulesOptions } from "./types.js";

type CliArguments = {
  command: "check" | "sync";
  root: string;
  include?: string[];
  exclude: string[];
  config?: string;
  viteConfig?: string;
};

type CliCaptureState = {
  enabled: boolean;
  disabledReason?: "css-modules";
  schemas: Map<string, BemModuleSchema>;
};

const CLI_ENTRY_SPECIFIER = "virtual:vite-plugin-bem-modules:cli-entry";
const CLI_ENTRY_ID = `\0${CLI_ENTRY_SPECIFIER}`;

function usage(): string {
  return [
    "Usage: bem-modules <check|sync> [options]",
    "",
    "Options:",
    "  --root <path>       Project root (default: current directory)",
    "  --config <path>     Shared bem-modules config (default: bem-modules.config.mjs/js)",
    "  --vite-config <path> Vite config (default: Vite's standard config search from root)",
    "  --include <path>    Include a root-relative or absolute path (repeatable)",
    "  --exclude <path>    Exclude a root-relative or absolute path (repeatable)",
    "  -h, --help          Show this help",
    "  -v, --version       Show the package version",
  ].join("\n");
}

async function packageVersion(): Promise<string> {
  const packageJson = JSON.parse(
    await fs.readFile(new URL("../package.json", import.meta.url), "utf8"),
  ) as { version?: unknown };
  if (typeof packageJson.version !== "string") {
    throw new Error("Package version is missing from package.json.");
  }
  return packageJson.version;
}

function requireValue(args: readonly string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a path.\n\n${usage()}`);
  return value;
}

function parseArguments(args: readonly string[]): CliArguments {
  const command = args[0];
  if (command !== "check" && command !== "sync") throw new Error(usage());

  let root = process.cwd();
  let include: string[] | undefined;
  const exclude: string[] = [];
  let config: string | undefined;
  let viteConfig: string | undefined;
  for (let index = 1; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--root") {
      root = requireValue(args, index, flag);
      index += 1;
    } else if (flag === "--include") {
      (include ??= []).push(requireValue(args, index, flag));
      index += 1;
    } else if (flag === "--exclude") {
      exclude.push(requireValue(args, index, flag));
      index += 1;
    } else if (flag === "--config") {
      config = requireValue(args, index, flag);
      index += 1;
    } else if (flag === "--vite-config") {
      viteConfig = requireValue(args, index, flag);
      index += 1;
    } else {
      throw new Error(`Unknown option: ${flag}\n\n${usage()}`);
    }
  }
  return {
    command,
    root: path.resolve(root),
    include,
    exclude,
    config,
    viteConfig,
  };
}

async function resolveConfigPath(root: string, configuredPath: string | undefined): Promise<string | null> {
  const candidates = configuredPath
    ? [path.resolve(root, configuredPath)]
    : [path.join(root, "bem-modules.config.mjs"), path.join(root, "bem-modules.config.js")];
  for (const candidate of candidates) {
    try {
      const stats = await fs.stat(candidate);
      if (stats.isFile()) return candidate;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
    }
  }
  if (configuredPath) throw new Error(`Config file not found: ${candidates[0]}\n\n${usage()}`);
  return null;
}

async function loadBemModulesOptions(root: string, configuredPath: string | undefined): Promise<BemModulesOptions> {
  const configPath = await resolveConfigPath(root, configuredPath);
  if (!configPath) return {};
  const loaded = await import(`${pathToFileURL(configPath).href}?bem-modules-config=${Date.now()}`) as {
    default?: unknown;
    bemModulesConfig?: unknown;
  };
  const value = loaded.default ?? loaded.bemModulesConfig;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Config file must export a BemModulesOptions object: ${configPath}`);
  }
  return value as BemModulesOptions;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function directBemPostcssPlugins(value: unknown): BemPostcssPlugin[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is BemPostcssPlugin => (
    isRecord(item)
    && item[BEM_POSTCSS_PLUGIN_MARKER] === true
    && typeof item[BEM_POSTCSS_CAPTURE_MARKER] === "function"
  ));
}

function containsBemPostcssPlugin(value: unknown): boolean {
  if (Array.isArray(value)) return value.some((item) => containsBemPostcssPlugin(item));
  return isRecord(value) && value[BEM_POSTCSS_PLUGIN_MARKER] === true;
}

function containsNestedBemPostcssPlugin(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  return value.some((item) => (
    Array.isArray(item)
      ? containsBemPostcssPlugin(item)
      : false
  ));
}

function containsBemCompanion(value: unknown): boolean {
  if (Array.isArray(value)) return value.some((item) => containsBemCompanion(item));
  return isRecord(value) && value[BEM_VITE_COMPANION_MARKER] === BEM_VITE_COMPANION_PROTOCOL;
}

function postcssPluginsFromUserConfig(config: UserConfig): unknown {
  const postcss = config.css?.postcss;
  if (!isRecord(postcss)) return undefined;
  return postcss.plugins;
}

function virtualEntryPlugin(files: readonly string[]): Plugin {
  const source = [
    ...files.map((filePath) => `import ${JSON.stringify(pathToFileURL(filePath).href)};`),
    "export {};",
    "",
  ].join("\n");
  return {
    name: "vite-plugin-bem-modules:cli-entry",
    enforce: "pre",
    resolveId(sourceId) {
      return sourceId === CLI_ENTRY_SPECIFIER ? CLI_ENTRY_ID : null;
    },
    load(id) {
      return id === CLI_ENTRY_ID ? source : null;
    },
  };
}

function cliCapturePlugins(
  files: readonly string[],
  state: CliCaptureState,
): Plugin[] {
  const fileSet = new Set(files.map((filePath) => canonicalFilePath(filePath)));

  const captureGuard: Plugin = {
    name: "vite-plugin-bem-modules:cli-capture-guard",
    enforce: "pre",
    config(config) {
      (config as UserConfig & Record<string, unknown>)[BEM_CLI_CAPTURE_CONFIG] = true;
      return undefined;
    },
  };

  const captureConfig: Plugin = {
    name: "vite-plugin-bem-modules:cli-capture-config",
    enforce: "post",
    config: {
      order: "post",
      handler(config) {
        const buildConfig = (config.build ??= {});
        buildConfig.write = false;
        buildConfig.emptyOutDir = false;
        const rollupOptions = (buildConfig.rollupOptions ??= {});
        if (isRecord(rollupOptions)) rollupOptions.input = CLI_ENTRY_SPECIFIER;
        const rolldownOptions = buildConfig.rolldownOptions;
        if (isRecord(rolldownOptions)) rolldownOptions.input = CLI_ENTRY_SPECIFIER;

        const configuredPostcss = postcssPluginsFromUserConfig(config);
        const directPlugins = directBemPostcssPlugins(configuredPostcss);
        if (directPlugins.length > 1 || containsNestedBemPostcssPlugin(configuredPostcss)) {
          throw createBemDiagnosticError(
            "BEM010",
            "BEM PostCSS plugin must be registered exactly once for CLI capture.",
            { details: ["keep one direct createBemPostcssPlugin() entry in css.postcss.plugins."] },
          );
        }

        return undefined;
      },
    },
    configResolved(config: ResolvedConfig) {
      const postcss = config.css.postcss as unknown;
      const directPlugins = directBemPostcssPlugins(isRecord(postcss) ? postcss.plugins : undefined);
      if (!containsBemCompanion(config.plugins)) {
        throw createBemDiagnosticError(
          "BEM010",
          "CLI capture requires the vite-plugin-bem-modules companion plugin.",
          {
            details: [
              "register bemModules(...) in the Vite plugin array and createBemPostcssPlugin(...) directly in css.postcss.plugins.",
            ],
          },
        );
      }
      if (directPlugins.length !== 1) {
        throw createBemDiagnosticError(
          "BEM010",
          "BEM PostCSS plugin must be registered in css.postcss.plugins for CLI capture.",
          {
            details: [
              "register createBemPostcssPlugin() directly in the PostCSS plugin array; the CLI does not reconstruct external PostCSS settings.",
            ],
          },
        );
      }
      if (config.css.modules === false) {
        state.enabled = false;
        state.disabledReason = "css-modules";
        for (const plugin of directPlugins) {
          plugin[BEM_POSTCSS_CAPTURE_MARKER]({ record() {} }, false);
        }
        return;
      }
      state.enabled = true;
      directPlugins[0]![BEM_POSTCSS_CAPTURE_MARKER]({
        record(filePath, schema) {
          const canonical = canonicalFilePath(filePath);
          if (!fileSet.has(canonical)) return;
          if (schema) state.schemas.set(canonical, schema);
          else state.schemas.delete(canonical);
        },
      }, true);
    },
  };

  return [captureGuard, captureConfig, virtualEntryPlugin(files)];
}

async function reconcileDeclarations(
  root: string,
  scope: { include: readonly string[]; exclude: readonly string[] },
  schemas: ReadonlyMap<string, BemModuleSchema>,
): Promise<void> {
  const expected = new Map<string, string>();
  for (const schema of [...schemas.values()].sort((left, right) => left.filePath.localeCompare(right.filePath))) {
    const outputPath = normalizeFilePath(resolveDtsPath(schema.filePath));
    expected.set(outputPath, renderDts(schema));
  }

  const candidates = await collectAdjacentDtsFiles(root, scope);
  const removals: string[] = [];
  for (const candidate of candidates) {
    const normalized = normalizeFilePath(candidate);
    if (expected.has(normalized)) continue;
    if (await isPluginGeneratedDts(candidate)) removals.push(candidate);
  }

  // Check every expected output before the first write or deletion. This is
  // a preflight for ownership, not a claim that multiple OS renames are one
  // transaction.
  for (const outputPath of expected.keys()) await assertGeneratedDtsWritable(outputPath);

  for (const [outputPath, content] of expected) await writeGeneratedDts(outputPath, content);
  for (const filePath of removals) await removeGeneratedDts(filePath);
}

async function runViteCapture(
  parsed: CliArguments,
  scope: { include: readonly string[]; exclude: readonly string[] },
): Promise<CliCaptureState> {
  const files = await collectModuleFiles(parsed.root, scope);
  const state: CliCaptureState = { enabled: true, schemas: new Map() };
  const inlineConfig: InlineConfig = {
    root: parsed.root,
    ...(parsed.viteConfig ? { configFile: path.resolve(parsed.root, parsed.viteConfig) } : {}),
    logLevel: "warn",
    plugins: cliCapturePlugins(files, state),
    build: {
      write: false,
      emptyOutDir: false,
      rollupOptions: {
        input: CLI_ENTRY_SPECIFIER,
      },
    },
  };
  await build(inlineConfig);
  return state;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (args.length === 1 && (args[0] === "--version" || args[0] === "-v")) {
    process.stdout.write(`${await packageVersion()}\n`);
    return;
  }

  const parsed = parseArguments(args);
  const loadedOptions = await loadBemModulesOptions(parsed.root, parsed.config);
  const resolvedConfig = resolveOptions(loadedOptions);
  const scope = resolveOptions({
    project: {
      include: parsed.include ?? resolvedConfig.project.include,
      exclude: parsed.exclude.length > 0 ? parsed.exclude : resolvedConfig.project.exclude,
    },
  }).project;
  const capture = await runViteCapture(parsed, scope);

  if (parsed.command === "sync" && capture.enabled) {
    await reconcileDeclarations(parsed.root, scope, capture.schemas);
  }
  if (capture.disabledReason === "css-modules") {
    process.stderr.write("bem-modules: disabled because css.modules is false; no files were checked or synchronized.\n");
  }
  process.stdout.write(`${parsed.command}: ${capture.schemas.size} BEM CSS Module(s)\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
