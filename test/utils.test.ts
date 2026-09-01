import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { isInNodeModules } from "../src/vite-utils.js";
import { normalizeFilePath } from "../src/utils.js";

test("Node-only path helperはqueryを解釈せず、Vite helper側でstripQueryする", () => {
  const queriedPath = path.join("/tmp", "Card.module.css?raw");
  assert.match(normalizeFilePath(queriedPath), /\/tmp\/Card\.module\.css\?raw$/);
  assert.equal(isInNodeModules("/tmp/node_modules/Card.module.css?raw"), true);
});
