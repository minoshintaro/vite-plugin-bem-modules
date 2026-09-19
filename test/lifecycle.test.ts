import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("programmatic Vite buildはSass workerを残さず自然終了する", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bem-modules-lifecycle-"));
  try {
    await fs.writeFile(path.join(root, "Card.module.scss"), "/* @block p-card */\n.root { color: red; }\n", "utf8");
    await fs.writeFile(path.join(root, "main.ts"), "import './Card.module.scss';\n", "utf8");
    const sourceModule = pathToFileURL(path.join(repositoryRoot, "src", "index.ts")).href;
    const script = [
      'import { build } from "vite";',
      `import bemModules, { createBemPostcssPlugin } from ${JSON.stringify(sourceModule)};`,
      "const root = process.argv[1];",
      "await build({",
      "  root,",
      "  configFile: false,",
      "  logLevel: 'silent',",
      "  plugins: [",
      "    ...bemModules({ types: false }),",
      "    { name: 'test-register-bem-postcss', config: () => ({ css: { postcss: { plugins: [createBemPostcssPlugin({ types: false })] } } }) },",
      "  ],",
      "  build: { outDir: 'dist', emptyOutDir: true, lib: { entry: 'main.ts', formats: ['es'], fileName: 'index' } },",
      "});",
    ].join("\n");

    assert.doesNotThrow(() => execFileSync(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "-e", script, root],
      { cwd: repositoryRoot, stdio: "pipe", timeout: 10000 },
    ));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
