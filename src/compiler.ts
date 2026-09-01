import { analyzeAndLowerModuleSourceIfOwned } from "./schema.js";
import type {
  BemModuleSchema,
  ResolvedBemCompilerOptions,
} from "./types.js";

/** Input for the filesystem- and Vite-independent BEM compiler. */
export type CompileBemModuleInput = {
  /** Canonical absolute path supplied by the Vite or Project adapter. */
  filePath: string;
  source: string;
  options: ResolvedBemCompilerOptions;
};

/** The projections produced from one CSS Module source. */
export type CompileBemModuleResult = {
  schema: BemModuleSchema;
  loweredSource: string;
};

/**
 * Compile one CSS Module into the canonical BEM schema and lowered source.
 *
 * A module without an `@block` declaration is outside this compiler's
 * ownership and returns `null`. No filesystem, Vite, or runtime state is
 * consulted here. Callers must provide a canonical absolute `filePath`;
 * relative paths are outside this internal contract.
 */
export function compileBemModule(
  input: CompileBemModuleInput,
): CompileBemModuleResult | null {
  const result = analyzeAndLowerModuleSourceIfOwned(
    input.filePath,
    input.source,
    input.options,
  );
  if (!result) return null;
  return {
    schema: result.schema,
    loweredSource: result.loweredSource,
  };
}
