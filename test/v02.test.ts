import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import postcss from "postcss";
import { build } from "vite";
import bemModules, { createBemPostcssPlugin } from "../src/index.js";

async function withTempRoot<T>(callback: (root: string) => Promise<T>): Promise<T> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bem-modules-v02-"));
  try {
    return await callback(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

test("PostCSS factoryは管理対象のclass、ID、keyframes、animationを構文単位でglobal化する", async () => {
  await withTempRoot(async (root) => {
    const sourcePath = path.join(root, "Card.module.css");
    const result = await postcss([createBemPostcssPlugin({ types: true })]).process(`/* @block p-card */
.root { animation: 200ms ease fade; animation-name: slide, fade; }
.root--compact { color: red; }
:global(.utility) .child { display: block; }
#dialog { color: blue; }
@-webkit-keyframes fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes slide { from { opacity: 0; } to { opacity: 1; } }
`, { from: sourcePath });

    assert.match(result.css, /:global\(\.p-card\)/);
    assert.match(result.css, /:global\(\.p-card--compact\)/);
    assert.match(result.css, /:global\(\.utility\) :global\(\.p-card__child\)/);
    assert.match(result.css, /:global\(#dialog\)/);
    assert.match(result.css, /@-webkit-keyframes :global\(fade\)/);
    assert.match(result.css, /animation: 200ms ease global\(fade\)/);
    assert.match(result.css, /animation-name: global\(slide\), global\(fade\)/);
    assert.match(result.css, /root: p-card/);
    assert.match(result.css, /rootCompact: p-card--compact/);
    assert.doesNotMatch(result.css, /utility: p-card/);

    const declaration = await fs.readFile(`${sourcePath}.d.ts`, "utf8");
    assert.match(declaration, /readonly "root": string;/);
    assert.match(declaration, /readonly "rootCompact": string;/);
    assert.match(declaration, /readonly "child": string;/);
    assert.doesNotMatch(declaration, /dialog|fade|slide|utility/);
  });
});

test("PostCSS factoryのkeyframes台帳は再処理・改名・削除で古いfileを残さない", async () => {
  await withTempRoot(async (root) => {
    const fileA = path.join(root, "A.module.css");
    const fileB = path.join(root, "B.module.css");
    const plugin = createBemPostcssPlugin();
    const process = (from: string, body: string) => postcss([plugin]).process(
      `/* @block p-test */\n${body}`,
      { from },
    );

    await process(fileA, "@keyframes fade { from { opacity: 0; } to { opacity: 1; } }");
    const first = await process(fileB, "@keyframes fade { from { opacity: 0; } to { opacity: 1; } }");
    assert.equal(first.warnings().filter((warning) => /duplicate global keyframes/.test(warning.text)).length, 1);

    const resolved = await process(fileA, "@keyframes slide { from { opacity: 0; } to { opacity: 1; } }");
    assert.equal(resolved.warnings().filter((warning) => /duplicate global keyframes/.test(warning.text)).length, 0);

    const reintroduced = await process(fileA, "@keyframes fade { from { opacity: 0; } to { opacity: 1; } }");
    assert.equal(reintroduced.warnings().filter((warning) => /duplicate global keyframes/.test(warning.text)).length, 1);

    const unowned = await postcss([plugin]).process(".root {}", { from: fileA });
    assert.equal(unowned.warnings().filter((warning) => /duplicate global keyframes/.test(warning.text)).length, 0);
  });
});

test("Vite companionはBEM PostCSS pluginの明示登録がない起動を拒否する", async () => {
  await withTempRoot(async (root) => {
    await fs.writeFile(path.join(root, "main.js"), "import './Card.module.css';\n", "utf8");
    await fs.writeFile(path.join(root, "Card.module.css"), "/* @block p-card */\n.root {}\n", "utf8");

    await assert.rejects(
      build({
        root,
        configFile: false,
        logLevel: "silent",
        plugins: [bemModules({ types: false })],
        build: { outDir: "dist", emptyOutDir: true, write: false },
      }),
      /BEM010.*PostCSS plugin/i,
    );
  });
});

test("Vite companionはPostCSS plugin配列のnested wrapperを暗黙展開しない", async () => {
  await withTempRoot(async (root) => {
    await fs.writeFile(path.join(root, "main.js"), "import './Card.module.css';\n", "utf8");
    await fs.writeFile(path.join(root, "Card.module.css"), "/* @block p-card */\n.root {}\n", "utf8");

    await assert.rejects(
      build({
        root,
        configFile: false,
        logLevel: "silent",
        plugins: [bemModules({ types: false })],
        css: {
          postcss: {
            plugins: [[createBemPostcssPlugin()]] as never,
          },
        },
        build: { outDir: "dist", emptyOutDir: true, write: false },
      }),
      /BEM010.*PostCSS plugin/i,
    );
  });
});
