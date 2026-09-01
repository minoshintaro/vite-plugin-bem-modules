import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "vite";
import bemModules, { defineBemModulesConfig, isBemGlobalClassName } from "vite-plugin-bem-modules";

function testBemModules(options: Parameters<typeof bemModules>[0] = {}) {
  return bemModules(options);
}

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("package rootはfactory・共有判定・設定用型を公開し、source mapの参照元を配布する", async () => {
  const packageJson = JSON.parse(
    await fs.readFile(new URL("../package.json", import.meta.url), "utf8"),
  ) as { files?: string[]; main?: string; types?: string; bin?: Record<string, string>; scripts?: Record<string, string> };
  assert.deepEqual(packageJson.files, ["CHANGELOG.md", "dist", "src"]);
  assert.equal(packageJson.main, "./dist/index.js");
  assert.equal(packageJson.types, "./dist/index.d.ts");
  assert.equal(packageJson.scripts?.["pack:tgz"], "pnpm pack --pack-destination .");
  assert.equal(packageJson.bin?.["bem-modules"], "./dist/cli.js");

  const declaration = await fs.readFile(new URL("../dist/index.d.ts", import.meta.url), "utf8");
  assert.match(declaration, /export default function bemModules/);
  assert.match(declaration, /isBemGlobalClassName/);
  assert.equal(isBemGlobalClassName("root", { exact: ["root"] }), false);
  assert.equal(isBemGlobalClassName("is-active", { prefix: ["is-"] }), true);
  const sharedConfig = defineBemModulesConfig({ project: { include: ["src"] } });
  assert.deepEqual(sharedConfig.project?.include, ["src"]);
  for (const publicType of [
    "BemGlobalScopeOptions",
    "BemModulesOptions",
    "BemNamingOptions",
    "BemOutputSeparator",
    "BemProjectOptions",
    "ModifierOutput",
    "WordCase",
  ]) {
    assert.match(declaration, new RegExp(`\\b${publicType}\\b`));
  }
  for (const internalType of ["BemModuleSchema", "BemBase", "BemClass", "BemModifier"]) {
    assert.doesNotMatch(declaration, new RegExp(`\\b${internalType}\\b`));
  }

  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");
  const mapFiles = (await fs.readdir(dist)).filter((file) => file.endsWith(".map"));
  for (const mapFile of mapFiles) {
    const mapPath = path.join(dist, mapFile);
    const map = JSON.parse(await fs.readFile(mapPath, "utf8")) as {
      sourceRoot?: string;
      sources?: string[];
    };
    for (const source of map.sources ?? []) {
      const sourcePath = path.resolve(path.dirname(mapPath), map.sourceRoot ?? "", source);
      await assert.doesNotReject(fs.access(sourcePath), `${mapFile}: ${source}`);
    }
  }
});

test("package tarballは実行可能なbem-modules CLIを含む", async () => {
  const cliSource = await fs.readFile(path.join(repositoryRoot, "dist", "cli.js"), "utf8");
  assert.match(cliSource, /^#!\/usr\/bin\/env node\n/);

  const packageManagerCli = process.env.npm_execpath;
  assert.ok(packageManagerCli, "run package tests through the declared package manager");
  const listing = execFileSync(process.execPath, [packageManagerCli, "pack", "--dry-run", "--json"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  assert.match(listing, /dist[\\/]cli\.js/);
});

test("package root export はconsumerのVite buildで利用できる", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bem-modules-package-"));
  try {
    await fs.writeFile(
      path.join(root, "Card.module.css"),
      "/* @block p-card */\n.root { color: red; }\n.root--compact { gap: 4px; }\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(root, "main.ts"),
      "import styles from './Card.module.css';\nexport const classes = styles.rootCompact;\n",
      "utf8",
    );

    await build({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [testBemModules({ modifierOutput: "withBase" })],
      build: {
        outDir: "dist",
        emptyOutDir: true,
        minify: false,
        lib: {
          entry: "main.ts",
          formats: ["es"],
          fileName: "index",
        },
      },
    });

    const distFiles = await fs.readdir(path.join(root, "dist"));
    const jsFile = distFiles.find((file) => file.endsWith(".js") || file.endsWith(".mjs"));
    assert.ok(jsFile);
    const built = await import(`${pathToFileURL(path.join(root, "dist", jsFile)).href}?test=${Date.now()}`);
    assert.equal(built.classes, "p-card p-card--compact");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("JavaScript consumer は TypeScript 設定なしで利用できる", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bem-modules-package-js-"));
  try {
    await fs.writeFile(
      path.join(root, "Card.module.css"),
      "/* @block p-card */\n.root { color: red; }\n.root--compact { gap: 4px; }\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(root, "main.js"),
      "import styles from './Card.module.css';\nexport const classes = styles.rootCompact;\n",
      "utf8",
    );

    await build({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [testBemModules({ types: false })],
      build: {
        outDir: "dist",
        emptyOutDir: true,
        minify: false,
        lib: {
          entry: "main.js",
          formats: ["es"],
          fileName: "index",
        },
      },
    });

    const distFiles = await fs.readdir(path.join(root, "dist"));
    const jsFile = distFiles.find((file) => file.endsWith(".js") || file.endsWith(".mjs"));
    assert.ok(jsFile);
    const built = await import(`${pathToFileURL(path.join(root, "dist", jsFile)).href}?test=${Date.now()}`);
    assert.equal(built.classes, "p-card--compact");
    await assert.rejects(fs.access(path.join(root, "Card.module.css.d.ts")), { code: "ENOENT" });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
