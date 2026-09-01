import assert from "node:assert/strict";
import test from "node:test";
import { resolveOptions } from "../src/options.js";

test("Compiler設定の既定値を解決する", () => {
  const options = resolveOptions();
  assert.deepEqual(options.naming, {
    wordCase: "camel",
    elementSeparator: "__",
    modifierSeparator: "--",
  });
  assert.deepEqual(options.globalScope, { exact: [], prefix: [] });
  assert.equal(options.modifierOutput, "only");
});

test("kebab で単一ハイフンのModifier区切りを選ぶことはできない", () => {
  assert.throws(
    () => resolveOptions({ naming: { wordCase: "kebab", modifierSeparator: "-" } }),
    /kebab wordCase does not support naming.modifierSeparator "-"/,
  );
});

test("separatorはBEMの慣用的な4値に限定し、ElementとModifierの一致を拒否する", () => {
  for (const value of ["x", "-_", "---"] as const) {
    assert.throws(
      () => resolveOptions({ naming: { elementSeparator: value as never } }),
      /naming.elementSeparator must be one of/,
    );
    assert.throws(
      () => resolveOptions({ naming: { modifierSeparator: value as never } }),
      /naming.modifierSeparator must be one of/,
    );
  }
  assert.throws(
    () => resolveOptions({ naming: { elementSeparator: "__", modifierSeparator: "__" } }),
    /naming.elementSeparator and naming.modifierSeparator must be different/,
  );
});

test("typesは実行時にもbooleanへ限定する", () => {
  assert.throws(
    () => resolveOptions({ types: "false" as never }),
    /types must be a boolean/,
  );
});

test("modifierOutputはonlyまたはwithBaseに限定し、既定値はonlyとする", () => {
  assert.equal(resolveOptions().modifierOutput, "only");
  assert.equal(resolveOptions({ modifierOutput: "withBase" }).modifierOutput, "withBase");
  assert.throws(
    () => resolveOptions({ modifierOutput: "invalid" as never }),
    /modifierOutput must be "only" or "withBase"/,
  );
});

test("Projectのinclude/excludeはpath集合として正規化し、include未指定はroot全体を表す", () => {
  assert.deepEqual(resolveOptions().project, { include: ["."], exclude: [] });
  assert.deepEqual(resolveOptions({ project: { include: ["./src", "packages/ui/"], exclude: ["./fixtures"] } }).project, {
    include: ["src", "packages/ui"],
    exclude: ["fixtures"],
  });
  assert.deepEqual(resolveOptions({ project: { include: [] } }).project.include, []);
  assert.deepEqual(resolveOptions({ project: { include: ["/tmp/shared"] } }).project.include, ["/tmp/shared"]);
  for (const value of ["", "../outside", "."] as const) {
    assert.throws(
      () => resolveOptions({ project: { exclude: [value] } }),
      /project\.exclude must contain non-empty project paths/,
      value,
    );
  }
});

test("resolved optionsはCompiler設定と明示的なProject範囲を持つ", () => {
  assert.deepEqual(Object.keys(resolveOptions({})).sort(), [
    "globalScope",
    "modifierOutput",
    "naming",
    "project",
    "types",
  ]);
});

test("JavaScript設定のscopeとProject pathも配列へ限定する", () => {
  assert.throws(
    () => resolveOptions({ globalScope: { exact: "root" } } as never),
    /globalScope\.exact must be an array of strings/,
  );
  assert.throws(
    () => resolveOptions({ project: { exclude: "dist" } } as never),
    /project\.exclude must be an array of paths/,
  );
});

test("空のglobalScope値は全classに一致するため拒否する", () => {
  assert.throws(
    () => resolveOptions({ globalScope: { prefix: [""] } }),
    /globalScope.prefix must contain non-empty strings/,
  );
  assert.throws(
    () => resolveOptions({ globalScope: { exact: [""] } }),
    /globalScope.exact must contain non-empty strings/,
  );
});
