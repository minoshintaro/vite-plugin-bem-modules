#!/usr/bin/env node
import path from "node:path";
import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createBemProjectIndex } from "./project.js";
import { resolveOptions } from "./options.js";
import type { BemModulesOptions } from "./types.js";

type CliArguments = {
  command: "check" | "sync";
  root: string;
  include?: string[];
  exclude: string[];
  config?: string;
};

function usage(): string {
  return [
    "Usage: bem-modules <check|sync> [options]",
    "",
    "Options:",
    "  --root <path>       Project root (default: current directory)",
    "  --config <path>     Shared bem-modules config (default: bem-modules.config.mjs/js)",
    "  --include <path>    Include a root-relative or absolute path (repeatable)",
    "  --exclude <path>    Exclude a root-relative or absolute path (repeatable)",
  ].join("\n");
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
    } else {
      throw new Error(`Unknown option: ${flag}\n\n${usage()}`);
    }
  }
  return { command, root: path.resolve(root), include, exclude, config };
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

async function main(): Promise<void> {
  const parsed = parseArguments(process.argv.slice(2));
  const config = await loadBemModulesOptions(parsed.root, parsed.config);
  // Resolve the shared object before applying CLI scope overrides. Besides
  // normalizing the same values as the Vite adapter, this keeps malformed
  // nested config from being hidden by an object spread.
  const resolvedConfig = resolveOptions(config);
  const scope = resolveOptions({
    project: {
      include: parsed.include ?? resolvedConfig.project.include,
      exclude: parsed.exclude.length > 0 ? parsed.exclude : resolvedConfig.project.exclude,
    },
  }).project;
  const project = createBemProjectIndex({
    root: parsed.root,
    compilerOptions: {
      naming: resolvedConfig.naming,
      globalScope: resolvedConfig.globalScope,
      modifierOutput: resolvedConfig.modifierOutput,
    },
    scope,
    dtsMode: parsed.command === "sync" ? "generate" : "ignore",
  });
  const schemas = parsed.command === "sync" ? await project.sync() : await project.check();
  process.stdout.write(`${parsed.command}: ${schemas.length} BEM CSS Module(s)\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
