import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src");

function packageName(specifier: string): string | null {
  if (specifier.startsWith(".")) return null;
  if (specifier.startsWith("@")) return specifier.split("/", 2).join("/");
  return specifier.split("/", 1)[0] ?? null;
}

function resolveSourceImport(importer: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const requested = path.resolve(path.dirname(importer), specifier);
  const withoutJs = requested.endsWith(".js") ? requested.slice(0, -".js".length) : requested;
  const candidates = [
    requested,
    `${withoutJs}.ts`,
    `${withoutJs}.tsx`,
    `${withoutJs}.mts`,
    `${withoutJs}.cts`,
    path.join(requested, "index.ts"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function staticModuleSpecifiers(filePath: string): string[] {
  const source = ts.createSourceFile(
    filePath,
    fs.readFileSync(filePath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const specifiers: string[] = [];
  function visit(node: ts.Node): void {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      && node.moduleSpecifier
      && ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    }
    if (
      ts.isImportEqualsDeclaration(node)
      && ts.isExternalModuleReference(node.moduleReference)
      && ts.isStringLiteral(node.moduleReference.expression)
    ) {
      specifiers.push(node.moduleReference.expression.text);
    }
    if (
      ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === "require"
      && node.arguments.length === 1
      && ts.isStringLiteral(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return specifiers;
}

function reachableViteImports(entry: string): string[] {
  const visited = new Set<string>();
  const reached = new Set<string>();
  function visit(filePath: string): void {
    const canonical = path.resolve(filePath);
    if (visited.has(canonical)) return;
    visited.add(canonical);
    for (const specifier of staticModuleSpecifiers(canonical)) {
      const local = resolveSourceImport(canonical, specifier);
      if (local) {
        visit(local);
        continue;
      }
      if (packageName(specifier) === "vite") reached.add(`${canonical} -> ${specifier}`);
    }
  }
  visit(entry);
  return [...reached].sort();
}

test("Compiler・ProjectはVite runtimeへ到達せず、CLIはprogrammatic buildへ委譲する", () => {
  for (const entryName of ["compiler.ts", "project.ts"]) {
    const reached = reachableViteImports(path.join(sourceRoot, entryName));
    assert.deepEqual(reached, [], `${entryName} must not statically reach the vite package`);
  }
  assert.ok(
    reachableViteImports(path.join(sourceRoot, "cli.ts"))
      .some((entry) => entry.endsWith(`${path.join("src", "cli.ts")} -> vite`)),
    "cli.ts must use Vite's programmatic build API",
  );
});

test("runtimeとCLIはSass packageやVite preprocess APIを直接呼ばない", () => {
  for (const fileName of ["runtime.ts", "cli.ts", "project.ts"]) {
    const source = fs.readFileSync(path.join(sourceRoot, fileName), "utf8");
    assert.doesNotMatch(source, /["'](?:sass|sass-embedded)["']/);
    assert.doesNotMatch(source, /preprocessCSS/);
  }
});

test("CLIはPostCSS設定をVite plugin配列へ追加せず、外部設定の探索も模倣しない", () => {
  const source = fs.readFileSync(path.join(sourceRoot, "cli.ts"), "utf8");
  assert.doesNotMatch(source, /EXTERNAL_POSTCSS_CONFIG_NAMES|hasExternalPostcssConfig/);
  assert.doesNotMatch(source, /injectedPostcss|as unknown as Plugin|config\.plugins\s*=|const additions/);
});

test("test runnerはVite workerのlifecycle leakをforce-exitで隠さない", () => {
  const source = fs.readFileSync(path.resolve(sourceRoot, "../scripts/run-tests.mjs"), "utf8");
  assert.doesNotMatch(source, /test-force-exit/);
});
