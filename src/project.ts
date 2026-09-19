import fs from "node:fs/promises";
import path from "node:path";
import { compileBemModule, type CompileBemModuleResult } from "./compiler.js";
import { collectAdjacentDtsFiles, collectModuleFiles, isProjectFileInScope } from "./files.js";
import {
  GENERATED_DTS_HEADER,
  removeGeneratedDts,
  renderDts,
  resolveDtsPath,
  writeGeneratedDts,
} from "./dts.js";
import type {
  BemModuleSchema,
  ResolvedBemCompilerOptions,
} from "./types.js";
import { canonicalFilePath, normalizeFilePath } from "./utils.js";

export type ProjectDtsMode = "generate" | "remove" | "ignore";

export type BemProjectScope = {
  include: readonly string[];
  exclude: readonly string[];
};

export type BemProjectIndexOptions = {
  root: string;
  compilerOptions: ResolvedBemCompilerOptions;
  scope: BemProjectScope;
  dtsMode?: ProjectDtsMode;
};

export type BemProjectIndex = {
  readonly root: string;
  setDtsMode(mode: ProjectDtsMode): void;
  isInScope(filePath: string): boolean;
  getSchema(filePath: string): BemModuleSchema | undefined;
  getSchemas(): BemModuleSchema[];
  analyze(filePath: string, source: string): CompileBemModuleResult | null;
  compile(filePath: string, source: string): Promise<CompileBemModuleResult | null>;
  remove(filePath: string): Promise<void>;
  check(): Promise<readonly BemModuleSchema[]>;
  sync(): Promise<readonly BemModuleSchema[]>;
};

function isMissingFileError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "ENOTDIR" || code === "EISDIR";
}

async function readModuleSource(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) return null;
    throw error;
  }
}

export function validateProjectSchemas(schemas: readonly BemModuleSchema[]): void {
  // v0.2 intentionally permits global BEM names to collide across Modules.
  // The browser's normal CSS cascade, rather than a project-wide index, owns
  // the meaning of those collisions.
  void schemas;
}

function schemaValues(schemas: Map<string, BemModuleSchema>): BemModuleSchema[] {
  return [...schemas.values()].sort((left, right) => left.filePath.localeCompare(right.filePath));
}

export function createBemProjectIndex({
  root,
  compilerOptions,
  scope: projectScope,
  dtsMode: initialDtsMode = "ignore",
}: BemProjectIndexOptions): BemProjectIndex {
  const canonicalRoot = canonicalFilePath(root);
  const schemas = new Map<string, BemModuleSchema>();
  const generatedDtsFiles = new Set<string>();
  let dtsMode = initialDtsMode;
  let pending: Promise<void> = Promise.resolve();

  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = pending.then(operation);
    pending = result.then(() => {}, () => {});
    return result;
  };

  const isInScope = (filePath: string): boolean => isProjectFileInScope(filePath, {
    root: canonicalRoot,
    ...projectScope,
  });

  const syncDtsForSchema = async (schema: BemModuleSchema | null): Promise<void> => {
    if (!schema) return;
    const outputPath = resolveDtsPath(schema.filePath);
    if (dtsMode === "generate") {
      await writeGeneratedDts(outputPath, renderDts(schema));
      generatedDtsFiles.add(outputPath);
    } else if (dtsMode === "remove") {
      await removeGeneratedDts(outputPath);
      generatedDtsFiles.delete(outputPath);
    }
  };

  const removeSyncedDts = async (filePath: string): Promise<void> => {
    await removeGeneratedDts(filePath);
    generatedDtsFiles.delete(normalizeFilePath(filePath));
  };

  const remove = async (filePath: string): Promise<void> => {
    const canonical = canonicalFilePath(filePath);
    if (!isInScope(canonical)) return;
    schemas.delete(canonical);
    if (dtsMode !== "ignore") await removeSyncedDts(resolveDtsPath(canonical));
  };

  const replaceSchema = async (
    filePath: string,
    result: CompileBemModuleResult | null,
  ): Promise<void> => {
    const canonical = canonicalFilePath(filePath);
    if (result) {
      const others = schemaValues(schemas).filter((schema) => schema.filePath !== canonical);
      validateProjectSchemas([...others, result.schema]);
      await syncDtsForSchema(result.schema);
      schemas.set(canonical, result.schema);
    } else {
      await remove(canonical);
    }
  };

  const compile = async (
    filePath: string,
    source: string,
  ): Promise<CompileBemModuleResult | null> => {
    const canonical = canonicalFilePath(filePath);
    const analyze = () => compileBemModule({ filePath: canonical, source, options: compilerOptions });
    if (!isInScope(canonical)) return analyze();
    return enqueue(async () => {
      try {
        const result = analyze();
        await replaceSchema(canonical, result);
        return result;
      } catch (error) {
        await remove(canonical);
        throw error;
      }
    });
  };

  const compileFiles = async (
    files: readonly string[],
  ): Promise<Map<string, BemModuleSchema>> => {
    const next = new Map<string, BemModuleSchema>();
    for (const filePath of files) {
      const source = await readModuleSource(filePath);
      if (source === null) continue;
      const result = compileBemModule({ filePath, source, options: compilerOptions });
      if (result) next.set(canonicalFilePath(filePath), result.schema);
    }
    validateProjectSchemas(schemaValues(next));
    return next;
  };

  const collectFiles = () => collectModuleFiles(canonicalRoot, projectScope);

  const sync = async (): Promise<readonly BemModuleSchema[]> => {
    const files = await collectFiles();
    const next = await compileFiles(files);
    if (dtsMode === "generate") {
      for (const schema of schemaValues(next)) await syncDtsForSchema(schema);
    } else if (dtsMode === "remove") {
      for (const filePath of await collectAdjacentDtsFiles(canonicalRoot, projectScope)) {
        await removeSyncedDts(filePath);
      }
      for (const filePath of generatedDtsFiles) await removeSyncedDts(filePath);
    }

    if (dtsMode !== "ignore") {
      const expected = dtsMode === "generate"
        ? new Set(schemaValues(next).map((schema) => resolveDtsPath(schema.filePath)))
        : new Set<string>();
      const candidates = new Set(generatedDtsFiles);
      for (const filePath of await collectAdjacentDtsFiles(canonicalRoot, projectScope)) candidates.add(filePath);
      for (const candidate of candidates) {
        if (!expected.has(candidate)) await removeSyncedDts(candidate);
      }
    }

    schemas.clear();
    for (const [filePath, schema] of next) schemas.set(filePath, schema);
    return schemaValues(schemas);
  };

  const check = async (): Promise<readonly BemModuleSchema[]> => {
    const files = await collectFiles();
    const next = await compileFiles(files);
    schemas.clear();
    for (const [filePath, schema] of next) schemas.set(filePath, schema);
    return schemaValues(schemas);
  };

  return {
    root: canonicalRoot,
    setDtsMode(mode) {
      dtsMode = mode;
    },
    isInScope,
    getSchema(filePath) {
      return schemas.get(canonicalFilePath(filePath));
    },
    getSchemas() {
      return schemaValues(schemas);
    },
    analyze(filePath, source) {
      return compileBemModule({
        filePath: canonicalFilePath(filePath),
        source,
        options: compilerOptions,
      });
    },
    compile,
    remove: (filePath) => enqueue(() => remove(filePath)),
    check: () => enqueue(check),
    sync: () => enqueue(sync),
  };
}
