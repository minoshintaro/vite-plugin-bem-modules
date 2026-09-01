import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createBemProjectIndex } from "../src/project.js";
import { resolveOptions } from "../src/options.js";
import { GENERATED_DTS_HEADER } from "../src/dts.js";

async function makeProject(prefix = "bem-modules-project-") {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

function createProject(
  root: string,
  options = resolveOptions(),
  dtsMode: "generate" | "remove" | "ignore" = "ignore",
) {
  return createBemProjectIndex({
    root,
    compilerOptions: {
      naming: options.naming,
      globalScope: options.globalScope,
      modifierOutput: options.modifierOutput,
    },
    scope: options.project,
    dtsMode,
  });
}

test("Project checkはimport状態に関係なく明示範囲全体の衝突を検査する", async () => {
  const root = await makeProject();
  try {
    await fs.writeFile(path.join(root, "A.module.css"), "/* @block card */ .root {}", "utf8");
    await fs.writeFile(path.join(root, "B.module.css"), "/* @block card */ .root {}", "utf8");
    const project = createProject(root);

    await assert.rejects(() => project.check(), /Block names must be unique across CSS Modules/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Project excludeは重複を範囲外へ置き、includeの空配列は空集合にする", async () => {
  const root = await makeProject();
  try {
    const cssFile = path.join(root, "A.module.css");
    await fs.writeFile(cssFile, "/* @block card */ .root {}", "utf8");
    await fs.writeFile(path.join(root, "fixtures.module.css"), "/* @block card */ .root {}", "utf8");

    const excluded = createProject(
      root,
      resolveOptions({ project: { exclude: ["fixtures.module.css"] } }),
    );
    assert.equal((await excluded.check()).length, 1);

    const empty = createProject(root, resolveOptions({ project: { include: [] } }));
    assert.deepEqual(await empty.check(), []);
    assert.equal(empty.isInScope(cssFile), false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Project syncは未importModuleのd.tsを生成し、到達性変化では削除しない", async () => {
  const root = await makeProject();
  try {
    const cssFile = path.join(root, "Card.module.css");
    const dtsFile = `${cssFile}.d.ts`;
    await fs.writeFile(cssFile, "/* @block p-card */ .root {} .root--compact {}", "utf8");
    const project = createProject(root, resolveOptions({ types: true }), "generate");

    await project.sync();
    assert.match(await fs.readFile(dtsFile, "utf8"), /rootCompact/);
    await project.compile(cssFile, "/* @block p-card */ .root {} .root--large {}");
    assert.match(await fs.readFile(dtsFile, "utf8"), /rootLarge/);
    assert.doesNotMatch(await fs.readFile(dtsFile, "utf8"), /rootCompact/);

    await project.compile(cssFile, ".root {}");
    await assert.rejects(() => fs.access(dtsFile), { code: "ENOENT" });

    await fs.writeFile(cssFile, "/* @block p-card */ .root {}", "utf8");
    await project.sync();
    assert.ok(await fs.stat(dtsFile));
    await fs.rm(cssFile);
    await project.sync();
    await assert.rejects(() => fs.access(dtsFile), { code: "ENOENT" });

    await project.remove(cssFile);
    await assert.rejects(() => fs.access(dtsFile), { code: "ENOENT" });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Projectはroot外でも明示includeした範囲だけを所有する", async () => {
  const parent = await makeProject("bem-modules-project-external-");
  const root = path.join(parent, "app");
  const external = path.join(parent, "shared");
  try {
    await fs.mkdir(root);
    await fs.mkdir(external);
    const externalCss = path.join(external, "Shared.module.css");
    await fs.writeFile(externalCss, "/* @block shared */ .root {}", "utf8");
    const project = createProject(
      root,
      resolveOptions({ project: { include: [external] }, types: true }),
      "generate",
    );

    await project.sync();
    assert.equal(project.isInScope(externalCss), true);
    assert.ok(await fs.stat(`${externalCss}.d.ts`));
  } finally {
    await fs.rm(parent, { recursive: true, force: true });
  }
});

test("明示includeしたsourceのsymlinkは実体と同じschemaと隣接型を使う", async () => {
  const parent = await makeProject("bem-modules-project-source-link-");
  const root = path.join(parent, "app");
  try {
    await fs.mkdir(root);
    const target = path.join(parent, "Shared.module.css");
    const alias = path.join(root, "Alias.module.css");
    const source = "/* @block shared */ .root {}";
    await fs.writeFile(target, source);
    await fs.symlink(target, alias, "file");
    assert.deepEqual(await createProject(root).check(), []);

    const project = createProject(root, resolveOptions({ project: { include: [alias] } }), "generate");
    await project.sync();
    assert.equal(project.isInScope(target), true);
    assert.equal(project.getSchema(alias), project.getSchema(target));
    assert.match(await fs.readFile(`${target}.d.ts`, "utf8"), /readonly "root": string/);
    await assert.rejects(() => fs.access(`${alias}.d.ts`), { code: "ENOENT" });

    await project.compile(alias, source);
    assert.equal(project.getSchemas().length, 1);
    await project.remove(alias);
    await assert.rejects(() => fs.access(`${target}.d.ts`), { code: "ENOENT" });
    assert.equal(await fs.readFile(target, "utf8"), source);
  } finally {
    await fs.rm(parent, { recursive: true, force: true });
  }
});

test("Project syncは範囲外の生成d.tsを削除しない", async () => {
  const parent = await makeProject("bem-modules-project-out-of-scope-");
  const root = path.join(parent, "app");
  const external = path.join(parent, "shared");
  try {
    await fs.mkdir(root);
    await fs.mkdir(external);
    const externalDts = path.join(external, "Shared.module.css.d.ts");
    await fs.writeFile(
      externalDts,
      "// Generated by vite-plugin-bem-modules. Do not edit.\n",
      "utf8",
    );
    const project = createProject(root, resolveOptions({ types: true }), "generate");

    await project.sync();
    assert.ok(await fs.stat(externalDts));
  } finally {
    await fs.rm(parent, { recursive: true, force: true });
  }
});

test("Project syncはfile単位excludeでsourceに紐づく隣接d.tsを維持する", async () => {
  const root = await makeProject("bem-modules-project-file-exclude-");
  try {
    const cssFile = path.join(root, "Legacy.module.css");
    const dtsFile = `${cssFile}.d.ts`;
    await fs.writeFile(cssFile, "/* @block legacy */ .root {}", "utf8");
    await fs.writeFile(
      dtsFile,
      "// Generated by vite-plugin-bem-modules. Do not edit.\n",
      "utf8",
    );

    const options = resolveOptions({
      types: true,
      project: { exclude: ["Legacy.module.css"] },
    });
    const project = createProject(root, options, "generate");
    assert.equal((await project.check()).length, 0);
    await project.sync();
    await assert.doesNotReject(() => fs.access(dtsFile));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Project syncは単一file includeのsource削除後も隣接d.tsを掃除する", async () => {
  const root = await makeProject("bem-modules-project-file-include-");
  try {
    const cssFile = path.join(root, "Card.module.css");
    const dtsFile = `${cssFile}.d.ts`;
    await fs.writeFile(cssFile, "/* @block p-card */ .root {}", "utf8");
    const options = resolveOptions({ types: true, project: { include: ["Card.module.css"] } });
    await createProject(root, options, "generate").sync();
    await assert.doesNotReject(() => fs.access(dtsFile));

    await fs.rm(cssFile);
    await createProject(root, options, "generate").sync();
    await assert.rejects(() => fs.access(dtsFile), { code: "ENOENT" });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Projectは並行compileでも一意性を維持し、失敗後の更新を処理できる", async () => {
  const parent = await makeProject("bem-modules-project-concurrent-");
  try {
    for (const mode of ["ignore", "generate", "remove"] as const) {
      const root = path.join(parent, mode);
      await fs.mkdir(root);
      const project = createProject(root, resolveOptions(), mode);
      const files = [path.join(root, "A.module.css"), path.join(root, "B.module.css")];
      const results = await Promise.allSettled(files.map((file) =>
        project.compile(file, "/* @block shared */ .root {}"),
      ));
      assert.equal(results.filter((result) => result.status === "fulfilled").length, 1, mode);
      const failedIndex = results.findIndex((result) => result.status === "rejected");
      const failed = results[failedIndex] as PromiseRejectedResult;
      assert.match(String(failed.reason), /BEM003/);
      assert.equal(project.getSchemas().length, 1);

      await project.compile(files[failedIndex]!, "/* @block other */ .root {} .root--large {}");
      assert.equal(project.getSchemas().length, 2);
      if (mode === "generate") {
        assert.match(await fs.readFile(`${files[failedIndex]}.d.ts`, "utf8"), /rootLarge/);
      }
    }
  } finally {
    await fs.rm(parent, { recursive: true, force: true });
  }
});

test("Projectの全走査とremoveは呼び出し順に反映される", async () => {
  const root = await makeProject("bem-modules-project-ordered-");
  try {
    const cssFile = path.join(root, "Card.module.css");
    await fs.writeFile(cssFile, "/* @block card */ .root {}");
    const project = createProject(root, resolveOptions(), "generate");
    await project.sync();
    await Promise.all([project.sync(), project.remove(cssFile)]);
    assert.deepEqual(project.getSchemas(), []);
    await assert.rejects(fs.access(`${cssFile}.d.ts`), { code: "ENOENT" });
    await Promise.all([project.check(), project.remove(cssFile)]);
    assert.deepEqual(project.getSchemas(), []);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Projectの解析失敗は旧schemaと生成型を除き、次のcompileを妨げない", async () => {
  const root = await makeProject("bem-modules-project-recovery-");
  try {
    const cssFile = path.join(root, "Card.module.css");
    const project = createProject(root, resolveOptions(), "generate");
    await project.compile(cssFile, "/* @block card */ .root {}");
    await assert.rejects(project.compile(cssFile, "/* @block card */ .root--large {}"), /BEM003/);
    assert.equal(project.getSchema(cssFile), undefined);
    await assert.rejects(fs.access(`${cssFile}.d.ts`), { code: "ENOENT" });
    await project.compile(path.join(root, "Other.module.css"), "/* @block card */ .root {}");
    assert.equal(project.getSchemas().length, 1);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("生成型をsymlinkへ置き換えてもremoveとsyncはリンク先を所有しない", async () => {
  const parent = await makeProject("bem-modules-project-dts-link-");
  try {
    const root = path.join(parent, "app");
    await fs.mkdir(root);
    const cssFile = path.join(root, "Card.module.css");
    const dtsFile = `${cssFile}.d.ts`;
    const external = path.join(parent, "External.module.css.d.ts");
    const original = `${GENERATED_DTS_HEADER}export const external = true;\n`;
    await fs.writeFile(cssFile, "/* @block card */ .root {}");
    await fs.writeFile(external, original);
    const project = createProject(root, resolveOptions(), "generate");
    await project.sync();
    await fs.unlink(dtsFile);
    await fs.symlink(external, dtsFile, "file");
    await project.remove(cssFile);
    project.setDtsMode("remove");
    await project.sync();
    assert.equal(await fs.readFile(external, "utf8"), original);
    assert.ok((await fs.lstat(dtsFile)).isSymbolicLink());
  } finally {
    await fs.rm(parent, { recursive: true, force: true });
  }
});

test("生成型の更新はhardlinkで共有されたscope外ファイルを書き換えない", async () => {
  const parent = await makeProject("bem-modules-project-dts-hardlink-");
  try {
    const root = path.join(parent, "app");
    await fs.mkdir(root);
    const cssFile = path.join(root, "Card.module.css");
    const external = path.join(parent, "External.module.css.d.ts");
    const original = `${GENERATED_DTS_HEADER}export const external = true;\n`;
    await fs.writeFile(cssFile, "/* @block card */ .root {}");
    await fs.writeFile(external, original);
    await fs.link(external, `${cssFile}.d.ts`);
    await createProject(root, resolveOptions(), "generate").sync();
    assert.equal(await fs.readFile(external, "utf8"), original);
    assert.match(await fs.readFile(`${cssFile}.d.ts`, "utf8"), /readonly "root": string/);
  } finally {
    await fs.rm(parent, { recursive: true, force: true });
  }
});
