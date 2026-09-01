import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { compileBemModule } from "../src/compiler.js";
import type { ResolvedBemCompilerOptions } from "../src/types.js";

const COMPILER_OPTIONS = {
  naming: {
    wordCase: "camel",
    elementSeparator: "__",
    modifierSeparator: "--",
  },
  globalScope: { exact: [], prefix: [] },
  modifierOutput: "only",
} satisfies ResolvedBemCompilerOptions;

test("CompilerはschemaとloweredSourceを一つの純粋な結果として返す", () => {
  const result = compileBemModule({
    filePath: "/tmp/Card.module.css",
    source: "/* @block p-card */ .root {} .root--compact {}",
    options: COMPILER_OPTIONS,
  });

  assert.ok(result);
  assert.equal(result.schema.classMap.rootCompact, "p-card--compact");
  assert.match(result.loweredSource, /:global\(\.p-card--compact\)/);
  assert.doesNotMatch(result.loweredSource, /@block/);
});

test("Compilerは@blockのないCSS Moduleを所有外としてnullにする", () => {
  const result = compileBemModule({
    filePath: "/tmp/Plain.module.css",
    source: ".root {}",
    options: COMPILER_OPTIONS,
  });

  assert.equal(result, null);
});

test("Compilerはfilesystem pathに含まれる疑問符をqueryとして解釈しない", () => {
  const filePath = path.resolve("/tmp/Question?.module.css").replaceAll("\\", "/");
  const result = compileBemModule({ filePath, source: "/* @block card */ .root {}", options: COMPILER_OPTIONS });
  assert.equal(result?.schema.filePath, filePath);
});
