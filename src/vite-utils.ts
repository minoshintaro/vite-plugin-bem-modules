import path from "node:path";
import {
  isAdjacentDtsPath,
  isModuleFilePath,
  normalizeFilePath,
} from "./utils.js";

/** Strip Vite's query suffix from a module id. */
export function stripQuery(id: string): string {
  return id.split("?", 1)[0] ?? id;
}

export function isVirtualModule(id: string): boolean {
  return stripQuery(id).includes("\0");
}

export function isInNodeModules(id: string): boolean {
  return normalizeFilePath(stripQuery(id)).split("/").includes("node_modules");
}

export function isModuleFile(id: string): boolean {
  return isModuleFilePath(stripQuery(id));
}

export function isAdjacentDtsFile(id: string): boolean {
  return isAdjacentDtsPath(stripQuery(id));
}

export function isScriptModule(id: string): boolean {
  const clean = stripQuery(id);
  return [".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".mts", ".cts"]
    .some((extension) => clean.endsWith(extension));
}

export function hasQueryFlag(id: string, flag: string): boolean {
  const query = id.split("?", 2)[1];
  if (!query) return false;
  return query
    .split("&")
    .some((part) => part.split("=", 1)[0] === flag);
}

export type NonModuleQuery = "raw" | "inline" | "url";

export function getNonModuleQuery(id: string): NonModuleQuery | null {
  for (const flag of ["raw", "inline", "url"] as const) {
    if (hasQueryFlag(id, flag)) return flag;
  }
  return null;
}

export function hasNonModuleQuery(id: string): boolean {
  return getNonModuleQuery(id) !== null;
}

export function resolveRelativeModulePath(source: string, importer: string, root: string): string | null {
  const clean = stripQuery(source);
  if (clean.startsWith("/")) return normalizeFilePath(path.resolve(root, `.${clean}`));
  if (!clean.startsWith("./") && !clean.startsWith("../")) return null;
  return normalizeFilePath(path.resolve(path.dirname(stripQuery(importer)), clean));
}
