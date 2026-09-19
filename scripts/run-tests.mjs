import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const testDirectory = path.resolve(scriptDirectory, "../test");
const testFiles = readdirSync(testDirectory)
  .filter((fileName) => fileName.endsWith(".test.ts"))
  .sort()
  .map((fileName) => path.join(testDirectory, fileName));

if (testFiles.length === 0) {
  throw new Error(`No test files found in ${testDirectory}.`);
}

const result = spawnSync(
  process.execPath,
  ["--import", "tsx", "--test", ...testFiles],
  { stdio: "inherit" },
);

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
