import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertGeneratedDtsWritable,
  GENERATED_DTS_HEADER,
  isPluginGeneratedDts,
  removeGeneratedDts,
  writeGeneratedDts,
} from "../src/dts.js";

test("CRLFの生成型を所有物として更新・削除し、手書きファイルは保護する", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bem-modules-dts-crlf-"));
  const generated = path.join(root, "Card.module.css.d.ts");
  const handwritten = path.join(root, "Handwritten.module.css.d.ts");
  try {
    await fs.writeFile(generated, `${GENERATED_DTS_HEADER}export const old = true;\n`.replaceAll("\n", "\r\n"));
    assert.equal(await isPluginGeneratedDts(generated), true);
    await assertGeneratedDtsWritable(generated);
    await writeGeneratedDts(generated, `${GENERATED_DTS_HEADER}export const current = true;\n`);
    assert.match(await fs.readFile(generated, "utf8"), /current/);

    await fs.writeFile(generated, `${GENERATED_DTS_HEADER}export const current = true;\n`.replaceAll("\n", "\r\n"));
    await removeGeneratedDts(generated);
    await assert.rejects(fs.access(generated), { code: "ENOENT" });

    await fs.writeFile(handwritten, "// Hand-written declaration\r\nexport const keep = true;\r\n");
    assert.equal(await isPluginGeneratedDts(handwritten), false);
    await assert.rejects(assertGeneratedDtsWritable(handwritten), /BEM006/);
    await assert.rejects(writeGeneratedDts(handwritten, GENERATED_DTS_HEADER), /BEM006/);
    await removeGeneratedDts(handwritten);
    assert.match(await fs.readFile(handwritten, "utf8"), /keep/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
