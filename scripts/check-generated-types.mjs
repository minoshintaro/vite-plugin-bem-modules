import { spawnSync } from "node:child_process";

const result = spawnSync(
  "git",
  [
    "status",
    "--short",
    "--untracked-files=all",
    "--",
    ":(glob)examples/typegen/**/*.module.*.d.ts",
  ],
  { encoding: "utf8" },
);

if (result.error) throw result.error;
if (result.status !== 0) {
  throw new Error(`git status failed with exit code ${result.status}`);
}

const changes = result.stdout.trim();
if (changes) {
  console.error("Generated CSS declarations are out of date:");
  console.error(changes);
  process.exitCode = 1;
}
