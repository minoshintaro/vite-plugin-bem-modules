import path from "node:path";
import { pathToFileURL } from "node:url";
import { createBemDiagnosticError } from "./diagnostics.js";

type SassCompileResult = { css: string };

type SassCompiler = {
  compileStringAsync(
    source: string,
    options: { url: URL; loadPaths: string[]; style: "expanded" },
  ): Promise<SassCompileResult>;
};

let compilerPromise: Promise<SassCompiler> | null = null;

async function loadSassCompiler(): Promise<SassCompiler> {
  for (const packageName of ["sass-embedded", "sass"]) {
    try {
      const loaded = await import(packageName) as { default?: unknown } & Record<string, unknown>;
      const candidate = loaded.default ?? loaded;
      if (
        typeof candidate === "object"
        && candidate !== null
        && typeof (candidate as { compileStringAsync?: unknown }).compileStringAsync === "function"
      ) {
        return candidate as SassCompiler;
      }
    } catch {
      // SCSS support is optional for consumers. Try the alternate Sass package.
    }
  }

  throw createBemDiagnosticError(
    "BEM004",
    "SCSS synchronization requires the `sass` or `sass-embedded` package.",
    { details: ["install one of these packages before running bem-modules sync or check."] },
  );
}

function sassCompiler(): Promise<SassCompiler> {
  return compilerPromise ??= loadSassCompiler();
}

export async function expandScssSource(filePath: string, source: string): Promise<string> {
  if (!filePath.endsWith(".module.scss")) return source;
  const compiler = await sassCompiler();
  const result = await compiler.compileStringAsync(source, {
    url: pathToFileURL(filePath),
    loadPaths: [path.dirname(filePath)],
    style: "expanded",
  });
  return result.css;
}
