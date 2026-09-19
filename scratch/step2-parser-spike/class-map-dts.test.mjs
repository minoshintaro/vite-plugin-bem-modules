import assert from "node:assert/strict";
import { readFile, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import postcss from "postcss";
import { createBemPostcssPlugin } from "./parser-plugin.mjs";

async function withTempSource(source, callback) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bem-class-map-dts-"));
  const sourcePath = path.join(directory, "Card.module.css");
  try {
    await writeFile(sourcePath, source);
    return await callback(sourcePath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("@blockのclass対応表からclass-only隣接d.tsを生成する", async () => {
  await withTempSource(`/* @block p-card */
.root { color: red; }
.root--compact { color: blue; }
:global(.utility) .child { display: block; }
#fade { color: black; }
@keyframes fade { from { opacity: 0; } to { opacity: 1; } }
:export { animation: fade; }
`, async (sourcePath) => {
    await postcss([createBemPostcssPlugin({ dts: true })]).process(await readFile(sourcePath, "utf8"), {
      from: sourcePath,
    });

    const declarationPath = `${sourcePath}.d.ts`;
    const declaration = await readFile(declarationPath, "utf8");
    assert.match(declaration, /vite-plugin-bem-modules: generated/);
    assert.match(declaration, /readonly root: string;/);
    assert.match(declaration, /readonly rootCompact: string;/);
    assert.match(declaration, /readonly child: string;/);
    assert.doesNotMatch(declaration, /utility|fade|animation/);
  });
});

test("手書きd.tsを保護し、生成内容が不変なら書き換えない", async () => {
  await withTempSource("/* @block p-card */\n.root {}\n", async (sourcePath) => {
    const declarationPath = `${sourcePath}.d.ts`;
    const handWritten = "// hand-written declaration\nexport default {};\n";
    await writeFile(declarationPath, handWritten);
    await postcss([createBemPostcssPlugin({ dts: true })]).process(await readFile(sourcePath, "utf8"), {
      from: sourcePath,
    });
    assert.equal(await readFile(declarationPath, "utf8"), handWritten);

    await rm(declarationPath);
    await postcss([createBemPostcssPlugin({ dts: true })]).process(await readFile(sourcePath, "utf8"), {
      from: sourcePath,
    });
    const before = await stat(declarationPath);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await postcss([createBemPostcssPlugin({ dts: true })]).process(await readFile(sourcePath, "utf8"), {
      from: sourcePath,
    });
    const after = await stat(declarationPath);
    assert.equal(await readFile(declarationPath, "utf8"), "/* vite-plugin-bem-modules: generated */\ndeclare const styles: {\n  readonly root: string;\n};\nexport default styles;\n");
    assert.equal(after.mtimeMs, before.mtimeMs);
  });
});
