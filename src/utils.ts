import fs from "node:fs";
import path from "node:path";

/** Normalize a filesystem path without interpreting module-id queries. */
export function normalizeFilePath(filePath: string): string {
  return path.resolve(filePath).replaceAll("\\", "/");
}

function normalizePathSlashes(filePath: string): string {
  return filePath.replaceAll("\\", "/");
}

/**
 * Return a stable file identity for cache and cross-hook comparisons.
 *
 * Vite can hand the plugin a symlink spelling in one hook and a realpath
 * spelling in another. Keep the lexical normalizer for display paths, but
 * use this identity whenever data crosses hook boundaries.
 */
export function canonicalFilePath(filePath: string): string {
  const normalized = normalizeFilePath(filePath);
  try {
    return normalizePathSlashes(fs.realpathSync.native(normalized));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") return normalized;
    try {
      const parent = path.dirname(normalized);
      const realParent = fs.realpathSync.native(parent);
      return normalizePathSlashes(path.join(realParent, path.basename(normalized)));
    } catch (parentError) {
      if ((parentError as NodeJS.ErrnoException).code !== "ENOENT") return normalized;
      return normalized;
    }
  }
}

/** File-kind predicates used by filesystem-owned code. Inputs are paths, not Vite ids. */
export function isModuleFilePath(filePath: string): boolean {
  return filePath.endsWith(".module.css") || filePath.endsWith(".module.scss");
}

/** Adjacent declaration predicate used by filesystem-owned code. */
export function isAdjacentDtsPath(filePath: string): boolean {
  return filePath.endsWith(".module.css.d.ts") || filePath.endsWith(".module.scss.d.ts");
}
