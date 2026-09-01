import path from "node:path";
import { createBemDiagnosticError } from "./diagnostics.js";
import type {
  BemModulesOptions,
  BemProjectOptions,
  BemProjectStartup,
  BemOutputSeparator,
  ModifierOutput,
  ResolvedBemModulesOptions,
  ResolvedBemNamingOptions,
} from "./types.js";

const DEFAULT_NAMING: ResolvedBemNamingOptions = {
  wordCase: "camel",
  elementSeparator: "__",
  modifierSeparator: "--",
};

const BEM_SEPARATORS = new Set<BemOutputSeparator>(["-", "--", "_", "__"]);
const MODIFIER_OUTPUTS = new Set<ModifierOutput>(["only", "withBase"]);
const PROJECT_STARTUPS = new Set<BemProjectStartup>(["scan", "defer"]);

function normalizeProjectPath(value: string): string {
  return path.posix.normalize(value.replaceAll("\\", "/")).replace(/^\.\//, "").replace(/\/$/, "");
}

function validateProjectPaths(
  project: unknown,
): asserts project is BemProjectOptions | undefined {
  if (project === undefined) return;
  if (typeof project !== "object" || project === null || Array.isArray(project)) {
    throw createBemDiagnosticError(
      "BEM004",
      "project must be an object.",
      { details: [`received: ${JSON.stringify(project)}`] },
    );
  }

  const configured = project as BemProjectOptions;
  if (configured.startup !== undefined && !PROJECT_STARTUPS.has(configured.startup)) {
    throw createBemDiagnosticError(
      "BEM004",
      'project.startup must be "scan" or "defer".',
      { details: [`received: ${JSON.stringify(configured.startup)}`] },
    );
  }
  for (const [kind, values] of [
    ["include", configured.include],
    ["exclude", configured.exclude],
  ] as const) {
    if (values === undefined) continue;
    if (!Array.isArray(values)) {
      throw createBemDiagnosticError(
        "BEM004",
        `project.${kind} must be an array of paths.`,
        { details: [`received: ${JSON.stringify(values)}`] },
      );
    }
    for (const [index, value] of values.entries()) {
      const normalized = typeof value === "string" ? normalizeProjectPath(value.trim()) : "";
      const isAbsolute = normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized);
      const isEmpty = normalized.length === 0;
      const isParent = !isAbsolute && normalized.split("/").some((segment) => segment === "..");
      const excludesRoot = kind === "exclude" && normalized === ".";
      if (!isEmpty && !isParent && !excludesRoot) continue;
      throw createBemDiagnosticError(
        "BEM004",
        `project.${kind} must contain non-empty project paths.`,
        {
          details: [
            `index: ${index}`,
            `received: ${JSON.stringify(value)}`,
            "use a root-relative path or an absolute path to opt into an external directory.",
          ],
        },
      );
    }
  }
}

function validateGlobalScope(scope: unknown): asserts scope is { exact?: readonly string[]; prefix?: readonly string[] } {
  if (typeof scope !== "object" || scope === null || Array.isArray(scope)) {
    throw createBemDiagnosticError(
      "BEM004",
      "globalScope must be an object.",
      { details: [`received: ${JSON.stringify(scope)}`] },
    );
  }
  const normalizedScope = scope as { exact?: readonly string[]; prefix?: readonly string[] };

  for (const [kind, values] of [
    ["exact", normalizedScope.exact ?? []],
    ["prefix", normalizedScope.prefix ?? []],
  ] as const) {
    if (!Array.isArray(values)) {
      throw createBemDiagnosticError(
        "BEM004",
        `globalScope.${kind} must be an array of strings.`,
        { details: [`received: ${JSON.stringify(values)}`] },
      );
    }
    const invalidIndex = values.findIndex(
      (value) => typeof value !== "string" || value.trim().length === 0,
    );
    if (invalidIndex === -1) continue;
    throw createBemDiagnosticError(
      "BEM004",
      `globalScope.${kind} must contain non-empty strings.`,
      {
        details: [
          `index: ${invalidIndex}`,
          `received: ${JSON.stringify(values[invalidIndex])}`,
        ],
      },
    );
  }
}

export function resolveOptions(options: BemModulesOptions = {}): ResolvedBemModulesOptions {
  const naming = {
    ...DEFAULT_NAMING,
    ...options.naming,
  };

  if (naming.wordCase !== "kebab" && naming.wordCase !== "camel") {
    throw createBemDiagnosticError("BEM004", "naming.wordCase must be \"kebab\" or \"camel\".");
  }

  if (naming.wordCase === "kebab" && naming.modifierSeparator === "-") {
    throw createBemDiagnosticError(
      "BEM004",
      "kebab wordCase does not support naming.modifierSeparator \"-\" because it conflicts with kebab-case names.",
    );
  }

  for (const [name, value] of [
    ["naming.elementSeparator", naming.elementSeparator],
    ["naming.modifierSeparator", naming.modifierSeparator],
  ] as const) {
    if (!BEM_SEPARATORS.has(value)) {
      throw createBemDiagnosticError(
        "BEM004",
        `${name} must be one of "-", "--", "_", or "__".`,
        { details: [`received: ${JSON.stringify(value)}`] }
      );
    }
  }
  if (naming.elementSeparator === naming.modifierSeparator) {
    throw createBemDiagnosticError(
      "BEM004",
      "naming.elementSeparator and naming.modifierSeparator must be different.",
      { details: [`separator: ${JSON.stringify(naming.elementSeparator)}`] },
    );
  }

  if (options.types !== undefined && typeof options.types !== "boolean") {
    throw createBemDiagnosticError(
      "BEM004",
      "types must be a boolean.",
      { details: [`received: ${JSON.stringify(options.types)}`] },
    );
  }

  if (options.modifierOutput !== undefined && !MODIFIER_OUTPUTS.has(options.modifierOutput)) {
    throw createBemDiagnosticError(
      "BEM004",
      "modifierOutput must be \"only\" or \"withBase\".",
      { details: [`received: ${JSON.stringify(options.modifierOutput)}`] },
    );
  }

  validateProjectPaths(options.project);

  const globalScope = options.globalScope ?? {};
  validateGlobalScope(globalScope);

  const project = options.project ?? {};
  const include = project.include ?? ["."];
  const exclude = project.exclude ?? [];

  return {
    naming,
    globalScope: {
      exact: [...(globalScope.exact ?? [])],
      prefix: [...(globalScope.prefix ?? [])],
    },
    modifierOutput: options.modifierOutput ?? "only",
    types: options.types,
    project: {
      include: include.map((value) => normalizeProjectPath(value.trim())),
      exclude: exclude.map((value) => normalizeProjectPath(value.trim())),
      startup: project.startup ?? "scan",
    },
  };
}
