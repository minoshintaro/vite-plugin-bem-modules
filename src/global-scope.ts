import type { BemGlobalScopeOptions } from "./types.js";

/**
 * Return whether a local class is intentionally outside the BEM schema.
 * `root` remains the Block Base even when it appears in an exact scope list.
 */
export function isBemGlobalClassName(
  name: string,
  scope: BemGlobalScopeOptions,
): boolean {
  if (name === "root") return false;
  return (scope.exact ?? []).includes(name)
    || (scope.prefix ?? []).some((prefix) => name.startsWith(prefix));
}
