import fs from "node:fs/promises";
import path from "node:path";
import {
  canonicalFilePath,
  isAdjacentDtsPath,
  isModuleFilePath,
  normalizeFilePath,
} from "./utils.js";

const IGNORED_DIRECTORIES = new Set([".git", ".pnpm-store", "node_modules", "dist", "coverage"]);
const IGNORED_ROOT_DIRECTORIES = new Set([
  ".cache",
  ".netlify",
  ".next",
  ".output",
  ".turbo",
  ".vercel",
  "build",
  "out",
  "storybook-static",
  "temp",
  "tmp",
]);

export type ProjectFileScope = {
  root: string;
  /** Root-relative or absolute files/directories to include. */
  include?: readonly string[];
  /** Root-relative or absolute files/directories to exclude. */
  exclude?: readonly string[];
};

function normalizedConfiguredPaths(root: string, configuredPaths: readonly string[] | undefined): string[] {
  const values = configuredPaths === undefined ? ["."] : configuredPaths;
  return values.map((configuredPath) => canonicalFilePath(path.resolve(root, configuredPath)));
}

function isPathWithin(filePath: string, directory: string): boolean {
  const relative = path.relative(directory, filePath);
  return relative === ""
    || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function isExcluded(filePath: string, root: string, excludes: readonly string[]): boolean {
  if (excludes.length === 0) return false;
  const canonicalFile = canonicalFilePath(filePath);
  return normalizedConfiguredPaths(root, excludes)
    .some((excluded) => isPathWithin(canonicalFile, canonicalFilePath(excluded)));
}

function sourcePathForAdjacentDts(filePath: string): string {
  return isAdjacentDtsPath(filePath) ? filePath.slice(0, -".d.ts".length) : filePath;
}

export function isProjectFileInScope(filePath: string, scope: ProjectFileScope): boolean {
  const root = canonicalFilePath(scope.root);
  const canonicalFile = canonicalFilePath(sourcePathForAdjacentDts(filePath));
  const includes = normalizedConfiguredPaths(root, scope.include);
  const isIncluded = includes.some((included) => {
    if (!isPathWithin(canonicalFile, included)) return false;
    // An explicit include opts into that path, but not ignored descendants.
    const directories = path.relative(included, canonicalFile).split(path.sep).slice(0, -1);
    let directory = included;
    for (const name of directories) {
      directory = path.join(directory, name);
      if (isIgnoredDirectory(root, directory, name)) return false;
    }
    return true;
  });
  return isIncluded && !isExcluded(canonicalFile, root, scope.exclude ?? []);
}

function isIgnoredDirectory(root: string, directory: string, name: string): boolean {
  return IGNORED_DIRECTORIES.has(name)
    || (path.dirname(canonicalFilePath(directory)) === root && IGNORED_ROOT_DIRECTORIES.has(name));
}

async function collectFiles(
  scope: ProjectFileScope,
  predicate: (filePath: string) => boolean,
): Promise<string[]> {
  const result = new Set<string>();
  const root = canonicalFilePath(scope.root);
  const includes = normalizedConfiguredPaths(scope.root, scope.include);
  const excludes = scope.exclude ?? [];

  async function visit(directory: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR" || code === "EISDIR") return;
      throw error;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const fullPath = path.join(directory, entry.name);
      if (isExcluded(fullPath, root, excludes)) continue;
      if (entry.isDirectory()) {
        if (!isIgnoredDirectory(root, fullPath, entry.name)) await visit(fullPath);
        continue;
      }
      if (entry.isFile() && predicate(fullPath) && isProjectFileInScope(fullPath, scope)) {
        // Include roots are canonical and recursion never follows symlinks.
        // Do not resolve a declaration's final component to another file.
        result.add(normalizeFilePath(fullPath));
      }
    }
  }

  for (const configuredInclude of includes) {
    if (isExcluded(configuredInclude, root, excludes)) continue;
    let stats;
    try {
      stats = await fs.stat(configuredInclude);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR" || code === "EISDIR") continue;
      throw error;
    }
    if (stats.isDirectory()) {
      await visit(configuredInclude);
    } else if (
      stats.isFile()
      && predicate(configuredInclude)
      && isProjectFileInScope(configuredInclude, scope)
    ) {
      result.add(normalizeFilePath(configuredInclude));
    }
  }

  return [...result].sort();
}

export async function collectModuleFiles(
  root: string,
  scope: Omit<ProjectFileScope, "root"> = {},
): Promise<string[]> {
  return collectFiles({ root, ...scope }, isModuleFilePath);
}

export async function collectAdjacentDtsFiles(
  root: string,
  scope: Omit<ProjectFileScope, "root"> = {},
): Promise<string[]> {
  const fullScope: ProjectFileScope = { root, ...scope };
  const files = await collectFiles(fullScope, isAdjacentDtsPath);
  const result = new Set(files);
  const includes = normalizedConfiguredPaths(root, scope.include);
  for (const configuredInclude of includes) {
    if (!isModuleFilePath(configuredInclude)) continue;
    const adjacent = `${configuredInclude}.d.ts`;
    if (!isProjectFileInScope(adjacent, fullScope)) continue;
    try {
      if ((await fs.lstat(adjacent)).isFile()) result.add(normalizeFilePath(adjacent));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR" && code !== "EISDIR") throw error;
    }
  }
  return [...result].sort();
}
