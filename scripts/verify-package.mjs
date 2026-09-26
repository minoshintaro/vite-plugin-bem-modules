import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageManager = process.env.npm_execpath;
assert.ok(packageManager, "run verification through the repository's pnpm script");

function run(cwd, ...args) {
  const result = spawnSync(process.execPath, [packageManager, ...args], {
    cwd,
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `pnpm ${args.join(" ")} failed`);
}

const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bem-modules-consumer-"));
try {
  const packageJson = JSON.parse(await fs.readFile(path.join(repositoryRoot, "package.json"), "utf8"));
  run(repositoryRoot, "pack", "--pack-destination", temporaryRoot);
  const archive = (await fs.readdir(temporaryRoot)).find((name) => name.endsWith(".tgz"));
  assert.ok(archive, "pnpm pack must produce a tarball");
  const consumerRoot = path.join(temporaryRoot, "consumer");
  await fs.mkdir(consumerRoot);
  await fs.writeFile(path.join(consumerRoot, "package.json"), JSON.stringify({
    private: true,
    type: "module",
    packageManager: packageJson.packageManager,
    dependencies: {
      "vite-plugin-bem-modules": `file:../${archive}`,
      vite: packageJson.devDependencies.vite,
      "sass-embedded": packageJson.devDependencies["sass-embedded"],
      typescript: packageJson.devDependencies.typescript,
    },
  }, null, 2));
  await fs.writeFile(path.join(consumerRoot, "vite.config.mjs"), `
import { defineConfig } from "vite";
import bemModules, { createBemPostcssPlugin } from "vite-plugin-bem-modules";

export default defineConfig({
  plugins: [...bemModules({ types: true })],
  css: { postcss: { plugins: [createBemPostcssPlugin()] } },
  build: { lib: { entry: "main.ts", formats: ["es"], fileName: "index" } },
});
`);
  await fs.writeFile(path.join(consumerRoot, "Card.module.css"), "/* @block p-card */\n.root { color: red; }\n.root--compact { gap: 4px; }\n");
  await fs.writeFile(path.join(consumerRoot, "Button.module.scss"), "/* @block p-button */\n$color: blue;\n.root { color: $color; }\n.root--active { color: red; }\n");
  await fs.writeFile(path.join(consumerRoot, "main.ts"), `
import card from "./Card.module.css";
import button from "./Button.module.scss";
export const classes: string[] = [card.rootCompact, button.rootActive];
`);
  await fs.writeFile(path.join(consumerRoot, "tsconfig.json"), JSON.stringify({
    compilerOptions: {
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "Bundler",
      strict: true,
      noEmit: true,
    },
    include: ["main.ts", "*.d.ts"],
  }, null, 2));

  run(consumerRoot, "install");
  run(consumerRoot, "exec", "bem-modules", "check");
  run(consumerRoot, "exec", "bem-modules", "sync");
  for (const name of ["Card.module.css.d.ts", "Button.module.scss.d.ts"]) {
    assert.match(await fs.readFile(path.join(consumerRoot, name), "utf8"), /readonly "root"/);
  }
  run(consumerRoot, "exec", "tsc", "--noEmit");
  run(consumerRoot, "exec", "vite", "build");
  const outputName = (await fs.readdir(path.join(consumerRoot, "dist")))
    .find((name) => name.endsWith(".js") || name.endsWith(".mjs"));
  assert.ok(outputName, "Vite build must emit a JavaScript entry");
  const output = await fs.readFile(path.join(consumerRoot, "dist", outputName), "utf8");
  assert.match(output, /p-card--compact/);
  assert.match(output, /p-button--active/);
  console.log("verified installed tarball: CLI check/sync, CSS, SCSS, types, Vite build");
} finally {
  await fs.rm(temporaryRoot, { recursive: true, force: true });
}
