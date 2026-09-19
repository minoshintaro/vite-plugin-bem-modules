import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import postcss from "postcss";
import { compile } from "sass-embedded";
import { createBemPostcssPlugin } from "./parser-plugin.mjs";

const spikeRoot = path.dirname(new URL(import.meta.url).pathname);
const fixtureRoot = path.join(spikeRoot, "fixture");

async function syncModule(sourcePath) {
  const source = sourcePath.endsWith(".scss")
    ? compile(sourcePath, { style: "expanded" }).css
    : await readFile(sourcePath, "utf8");
  await postcss([createBemPostcssPlugin({ dts: true })]).process(source, { from: sourcePath });
}

const tempRoot = await mkdtemp(path.join(os.tmpdir(), "bem-explicit-dts-sync-"));
try {
  const sourceRoot = path.join(tempRoot, "src");
  await cp(path.join(fixtureRoot, "src"), sourceRoot, { recursive: true });
  const unimportedPath = path.join(sourceRoot, "Unimported.module.scss");
  await writeFile(unimportedPath, `/* @block p-unimported */
@use "./mixins" as mixins;
.root { color: black; }
@include mixins.card-parts;
`);

  const sourceFiles = (await readdir(sourceRoot))
    .filter((file) => /\.module\.(?:css|scss)$/.test(file))
    .map((file) => path.join(sourceRoot, file));
  for (const sourcePath of sourceFiles) await syncModule(sourcePath);

  const declaration = await readFile(`${unimportedPath}.d.ts`, "utf8");
  assert.match(declaration, /readonly root: string;/);
  assert.match(declaration, /readonly fromMixin: string;/);
  assert.match(declaration, /readonly fromMixinActive: string;/);
  assert.equal(sourceFiles.length, 5);
  console.log(JSON.stringify({
    mode: "explicit-sync",
    sourceFiles: sourceFiles.map((file) => path.basename(file)).sort(),
    unimported: "Unimported.module.scss",
    declaration: path.basename(`${unimportedPath}.d.ts`),
    classKeys: [...declaration.matchAll(/readonly ([A-Za-z0-9_$]+): string;/g)].map((match) => match[1]),
    sassExpandedBeforePostcss: true,
  }));
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
