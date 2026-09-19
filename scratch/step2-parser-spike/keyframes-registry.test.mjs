import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import postcss from "postcss";
import { createBemPostcssPlugin } from "./parser-plugin.mjs";

const fileA = path.resolve("scratch/step2-parser-spike/fixture/src/A.module.css");
const fileB = path.resolve("scratch/step2-parser-spike/fixture/src/B.module.css");

async function process(plugin, from, source) {
  return postcss([plugin]).process(`/* @block p-test */\n${source}`, { from });
}

test("同一fileの再処理でkeyframes集合を置換し、旧名の衝突を撤回する", async () => {
  const plugin = createBemPostcssPlugin({ keyframes: { registry: true } });
  await process(plugin, fileA, "@keyframes fade { from { opacity: 0; } to { opacity: 1; } }");
  await process(plugin, fileA, "@keyframes slide { from { opacity: 0; } to { opacity: 1; } }");
  const result = await process(plugin, fileB, "@keyframes fade { from { opacity: 0; } to { opacity: 1; } }");
  assert.equal(result.warnings().filter((warning) => /duplicate global keyframes/.test(warning.text)).length, 0);
});

test("複数定義、衝突、警告deduplicate、解消後の再登録を扱う", async () => {
  const plugin = createBemPostcssPlugin({ keyframes: { registry: true } });
  await process(plugin, fileA, `
@keyframes fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes fade { from { opacity: 1; } to { opacity: 0; } }
`);
  const first = await process(plugin, fileB, "@keyframes fade { from { opacity: 0; } to { opacity: 1; } }");
  assert.equal(first.warnings().filter((warning) => /duplicate global keyframes/.test(warning.text)).length, 1);
  const second = await process(plugin, fileB, "@keyframes fade { from { opacity: 0; } to { opacity: 1; } }");
  assert.equal(second.warnings().filter((warning) => /duplicate global keyframes/.test(warning.text)).length, 0);
  await process(plugin, fileA, "@keyframes slide { from { opacity: 0; } to { opacity: 1; } }");
  const resolved = await process(plugin, fileB, "@keyframes fade { from { opacity: 0; } to { opacity: 1; } }");
  assert.equal(resolved.warnings().filter((warning) => /duplicate global keyframes/.test(warning.text)).length, 0);
  const reRegistered = await process(plugin, fileA, "@keyframes fade { from { opacity: 0; } to { opacity: 1; } }");
  assert.equal(reRegistered.warnings().filter((warning) => /duplicate global keyframes/.test(warning.text)).length, 1);
  const reprocessed = await process(plugin, fileA, "@keyframes fade { from { opacity: 0; } to { opacity: 1; } }");
  assert.equal(reprocessed.warnings().filter((warning) => /duplicate global keyframes/.test(warning.text)).length, 0);
});
