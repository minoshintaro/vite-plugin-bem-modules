import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(repositoryRoot, "dist", "cli.js");
const packageEntry = pathToFileURL(path.join(repositoryRoot, "dist", "index.js")).href;

type ViteConfigOptions = {
  imports?: string[];
  configLines?: string[];
  cssLines?: string[];
};

async function writeStandardCliViteConfig(root: string, options: ViteConfigOptions = {}): Promise<void> {
  const bemConfigPath = path.join(root, "bem-modules.config.mjs");
  const hasBemConfig = await fs.stat(bemConfigPath).then((stats) => stats.isFile()).catch(() => false);
  if (!hasBemConfig) await fs.writeFile(bemConfigPath, "export default {};\n", "utf8");
  const factory = "createBemPostcssPlugin(bemConfig)";
  const imports = [
    `import bemModules, { createBemPostcssPlugin } from ${JSON.stringify(packageEntry)};`,
    'import bemConfig from "./bem-modules.config.mjs";',
    ...(options.imports ?? []),
  ];
  await fs.writeFile(
    path.join(root, "vite.config.mjs"),
    [
      ...imports,
      "export default {",
      ...(options.configLines ?? []),
      "  plugins: [...bemModules(bemConfig)],",
      "  css: {",
      ...(options.cssLines ?? []),
      `    postcss: { plugins: [${factory}] },`,
      "  },",
      "};",
      "",
    ].join("\n"),
    "utf8",
  );
}

function runCli(root: string, command: "check" | "sync", ...args: string[]): string {
  return execFileSync(process.execPath, [cliPath, command, "--root", root, ...args], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
}

function runCliResult(root: string, command: "check" | "sync", ...args: string[]) {
  return spawnSync(process.execPath, [cliPath, command, "--root", root, ...args], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
}

test("CLIはhelpとpackage.jsonのversionを標準出力へ表示する", async () => {
  const packageJson = JSON.parse(
    await fs.readFile(path.join(repositoryRoot, "package.json"), "utf8"),
  ) as { version: string };
  const help = execFileSync(process.execPath, [cliPath, "--help"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  const version = execFileSync(process.execPath, [cliPath, "--version"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });

  assert.match(help, /^Usage: bem-modules <check\|sync>/);
  assert.match(help, /--help/);
  assert.match(help, /--vite-config/);
  assert.equal(version, `${packageJson.version}\n`);
  assert.throws(
    () => execFileSync(process.execPath, [cliPath, "sync", "-v"], {
      cwd: repositoryRoot,
      encoding: "utf8",
      stdio: "pipe",
    }),
    /Unknown option: -v/,
  );
});

test("CLIはVite configなしと外部PostCSS設定だけの構成をBEM010で停止する", async () => {
  for (const withExternalPostcss of [false, true]) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "bem-modules-cli-config-boundary-"));
    try {
      await fs.writeFile(path.join(root, "Card.module.css"), "/* @block card */ .root {}", "utf8");
      const externalConfig = [
        "export default {",
        "  plugins: [{ postcssPlugin: 'external-probe', Once() {} }],",
        "};",
        "",
      ].join("\n");
      if (withExternalPostcss) {
        await fs.writeFile(path.join(root, "postcss.config.mjs"), externalConfig, "utf8");
      }

      assert.throws(() => runCli(root, "check"), /BEM010/);
      if (withExternalPostcss) {
        assert.equal(await fs.readFile(path.join(root, "postcss.config.mjs"), "utf8"), externalConfig);
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }
});

test("CLIはPostCSS factoryだけでcompanionがない構成をBEM010で停止する", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bem-modules-cli-companion-boundary-"));
  try {
    await fs.writeFile(path.join(root, "Card.module.css"), "/* @block card */ .root {}", "utf8");
    await fs.writeFile(
      path.join(root, "vite.config.mjs"),
      [
        `import { createBemPostcssPlugin } from ${JSON.stringify(packageEntry)};`,
        "export default {",
        "  plugins: [{ name: 'vite-plugin-bem-modules:css' }],",
        "  css: { postcss: { plugins: [createBemPostcssPlugin()] } },",
        "};",
        "",
      ].join("\n"),
      "utf8",
    );

    assert.throws(() => runCli(root, "check"), /BEM010/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("CLIはPostCSS objectをVite plugin配列へ追加しない", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bem-modules-cli-postcss-boundary-"));
  try {
    await fs.writeFile(path.join(root, "Card.module.css"), "/* @block card */ .root {}", "utf8");
    await fs.writeFile(
      path.join(root, "vite.config.mjs"),
      [
        "export default {",
        "  plugins: [{",
        "    name: 'inspect-vite-plugin-list',",
        "    configResolved(config) {",
        "      if (config.plugins.some((plugin) => typeof plugin === 'object' && plugin !== null && 'postcssPlugin' in plugin)) {",
        "        throw new Error('PostCSS plugin leaked into Vite plugins');",
        "      }",
        "      if (config.plugins.some((plugin) => typeof plugin === 'object' && plugin !== null && plugin.name === 'vite-plugin-bem-modules:css')) {",
        "        throw new Error('CLI injected the Vite companion');",
        "      }",
        "    },",
        "  }],",
        "};",
        "",
      ].join("\n"),
      "utf8",
    );

    assert.throws(() => runCli(root, "check"), /BEM010/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("CLIはshared configのnamingと明示Project scopeをそのまま使う", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bem-modules-cli-"));
  try {
    await fs.mkdir(path.join(root, "src"));
    await fs.writeFile(
      path.join(root, "bem-modules.config.mjs"),
      [
        "export default {",
        '  naming: { wordCase: "kebab" },',
        '  project: { include: ["src"] },',
        "  types: true,",
        "};",
        "",
      ].join("\n"),
      "utf8",
    );
    await writeStandardCliViteConfig(root);
    await fs.writeFile(
      path.join(root, "src", "Card.module.css"),
      "/* @block p-card */ .root {} .profile-image {} .profile-image--rounded {}\n",
      "utf8",
    );
    // This duplicate is outside the configured scope. If the CLI ignored the
    // shared project.include, check would incorrectly report BEM003.
    await fs.writeFile(
      path.join(root, "Ignored.module.css"),
      "/* @block p-card */ .root {}\n",
      "utf8",
    );

    assert.match(runCli(root, "check"), /^check: 1 BEM CSS Module\(s\)\n$/);
    assert.match(runCli(root, "sync"), /^sync: 1 BEM CSS Module\(s\)\n$/);
    const dts = await fs.readFile(path.join(root, "src", "Card.module.css.d.ts"), "utf8");
    assert.match(dts, /readonly "profileImageRounded": string/);
    await assert.rejects(() => fs.access(path.join(root, "Ignored.module.css.d.ts")), { code: "ENOENT" });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("CLI checkとbuild失敗時のsyncは生成型へ書き込まない", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bem-modules-cli-deferred-"));
  try {
    await fs.mkdir(path.join(root, "src"));
    const first = path.join(root, "src", "A.module.css");
    const later = path.join(root, "src", "B.module.css");
    await fs.writeFile(first, "/* @block p-card */\n.root {}\n", "utf8");
    await fs.writeFile(later, "/* @block p-card */\n.root--invalid {}\n", "utf8");
    const original = "// Generated by vite-plugin-bem-modules. Do not edit.\nexport const keep = true;\n";
    await fs.writeFile(`${first}.d.ts`, original, "utf8");
    await writeStandardCliViteConfig(root);

    assert.throws(() => runCli(root, "check"), /BEM003/);
    assert.equal(await fs.readFile(`${first}.d.ts`, "utf8"), original);
    assert.throws(() => runCli(root, "sync"), /BEM003/);
    assert.equal(await fs.readFile(`${first}.d.ts`, "utf8"), original);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("CLI captureはtypes設定やbuild結果にかかわらず既存型へ触れない", async () => {
  for (const types of [true, false]) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), `bem-modules-cli-readonly-${types}-`));
    try {
      await fs.writeFile(
        path.join(root, "bem-modules.config.mjs"),
        `export default { types: ${types} };\n`,
        "utf8",
      );
      await writeStandardCliViteConfig(root);
      const good = path.join(root, "Good.module.css");
      const plain = path.join(root, "Plain.module.css");
      const invalid = path.join(root, "Invalid.module.css");
      await fs.writeFile(good, "/* @block p-good */\n.root {}\n", "utf8");
      await fs.writeFile(plain, ".root {}\n", "utf8");
      const originals = new Map([
        [`${good}.d.ts`, "// Generated by vite-plugin-bem-modules. Do not edit.\nexport const good = true;\n"],
        [`${plain}.d.ts`, "// Generated by vite-plugin-bem-modules. Do not edit.\nexport const plain = true;\n"],
      ]);
      for (const [filePath, content] of originals) await fs.writeFile(filePath, content, "utf8");

      assert.match(runCli(root, "check"), /^check: 1 BEM CSS Module\(s\)\n$/);
      for (const [filePath, content] of originals) {
        assert.equal(await fs.readFile(filePath, "utf8"), content, `${path.basename(filePath)} types:${types}`);
      }

      await fs.writeFile(invalid, "/* @block p-invalid */\n.root--missing {}\n", "utf8");
      const invalidDts = "// Generated by vite-plugin-bem-modules. Do not edit.\nexport const invalid = true;\n";
      originals.set(`${invalid}.d.ts`, invalidDts);
      await fs.writeFile(`${invalid}.d.ts`, invalidDts, "utf8");

      assert.throws(() => runCli(root, "check"), /BEM003/);
      assert.throws(() => runCli(root, "sync"), /BEM003/);
      for (const [filePath, content] of originals) {
        assert.equal(await fs.readFile(filePath, "utf8"), content, `${path.basename(filePath)} types:${types}`);
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }
});

test("CLI checkはscope内の重複keyframes警告を表示する", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bem-modules-cli-keyframes-warning-"));
  try {
    await writeStandardCliViteConfig(root);
    await fs.writeFile(
      path.join(root, "Card.module.css"),
      "/* @block p-card */\n.root {}\n@keyframes fade { from { opacity: 0; } to { opacity: 1; } }\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(root, "Modal.module.css"),
      "/* @block p-modal */\n.root {}\n@keyframes fade { from { opacity: 1; } to { opacity: 0; } }\n",
      "utf8",
    );

    const result = runCliResult(root, "check");
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^check: 2 BEM CSS Module\(s\)\n$/);
    assert.match(result.stderr, /duplicate global keyframes "fade"/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("CLIはcss.modules:falseによる無効化を0件の検査と区別して通知する", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bem-modules-cli-disabled-"));
  try {
    await writeStandardCliViteConfig(root, { cssLines: ["    modules: false,"] });
    await fs.writeFile(path.join(root, "Card.module.css"), "/* @block p-card */\n.root {}\n", "utf8");

    const result = runCliResult(root, "check");
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "check: 0 BEM CSS Module(s)\n");
    assert.match(result.stderr, /disabled because css\.modules is false/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("CLI syncは内容不変の型のmtimeを維持し、@blockなしの孤立型を掃除する", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bem-modules-cli-reconcile-"));
  try {
    const source = path.join(root, "Card.module.css");
    const orphan = path.join(root, "Plain.module.css");
    await fs.writeFile(source, "/* @block p-card */\n.root {}\n", "utf8");
    await fs.writeFile(orphan, ".root {}\n", "utf8");
    await fs.writeFile(`${orphan}.d.ts`, "// Generated by vite-plugin-bem-modules. Do not edit.\n", "utf8");
    await writeStandardCliViteConfig(root);

    runCli(root, "sync");
    const declaration = `${source}.d.ts`;
    const before = await fs.stat(declaration);
    runCli(root, "check");
    const checked = await fs.stat(declaration);
    assert.equal(checked.mtimeNs, before.mtimeNs);
    runCli(root, "sync");
    const after = await fs.stat(declaration);
    assert.equal(after.mtimeNs, before.mtimeNs);
    await assert.rejects(() => fs.access(`${orphan}.d.ts`), { code: "ENOENT" });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("CLIはVite configのSass additionalDataとaliasを通ったSCSS schemaを同期する", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bem-modules-cli-sass-"));
  try {
    await fs.mkdir(path.join(root, "styles"));
    await fs.writeFile(
      path.join(root, "styles", "_tokens.scss"),
      "$card-color: rgb(1, 2, 3);\n@mixin aliased-class { .aliased { color: blue; } }\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(root, "bem-modules.config.mjs"),
      "export default { project: { include: [\"src\"] } };\n",
      "utf8",
    );
    await fs.mkdir(path.join(root, "src"));
    await writeStandardCliViteConfig(root, {
      imports: [`const tokens = ${JSON.stringify(path.join(root, "styles"))};`],
      configLines: ["  resolve: { alias: { '@styles': tokens } },"],
      cssLines: [
        "    preprocessorOptions: { scss: { additionalData: '@use \\\"@styles/tokens\\\" as tokens;\\n@mixin additional-class { .additional { color: red; } }\\n' } },",
      ],
    });
    await fs.writeFile(
      path.join(root, "src", "Card.module.scss"),
      "/* @block p-card */\n@include additional-class;\n@include tokens.aliased-class;\n.root { color: tokens.$card-color; }\n",
      "utf8",
    );
    assert.match(runCli(root, "check", "--vite-config", "vite.config.mjs"), /^check: 1 BEM CSS Module\(s\)\n$/);
    assert.match(runCli(root, "sync", "--vite-config", "vite.config.mjs"), /^sync: 1 BEM CSS Module\(s\)\n$/);
    const dts = await fs.readFile(path.join(root, "src", "Card.module.scss.d.ts"), "utf8");
    assert.match(dts, /readonly "root": string/);
    assert.match(dts, /readonly "additional": string/);
    assert.match(dts, /readonly "aliased": string/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("CLIの標準構成はSCSSのsource-level BEM005をcompanion経由で診断する", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bem-modules-cli-sass-diagnostic-"));
  try {
    await fs.mkdir(path.join(root, "src"));
    await fs.writeFile(
      path.join(root, "bem-modules.config.mjs"),
      "export default { project: { include: [\"src\"] } };\n",
      "utf8",
    );
    await writeStandardCliViteConfig(root);
    await fs.writeFile(
      path.join(root, "src", "Card.module.scss"),
      "/* @block p-card */\n.root { &--compact { gap: 4px; } }\n",
      "utf8",
    );

    assert.throws(() => runCli(root, "check"), /BEM005[\s\S]*selector nesting/);
    assert.throws(() => runCli(root, "sync"), /BEM005[\s\S]*selector nesting/);
    await assert.rejects(() => fs.access(path.join(root, "src", "Card.module.scss.d.ts")), { code: "ENOENT" });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("CLI syncは隣接型のsymlinkを生成時に拒否し、掃除でも参照先に触れない", async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "bem-modules-cli-link-"));
  try {
    const root = path.join(parent, "app");
    await fs.mkdir(root);
    const source = path.join(root, "Card.module.css");
    const target = path.join(parent, "External.module.css.d.ts");
    const original = "// Generated by vite-plugin-bem-modules. Do not edit.\nexport const external = true;\n";
    await fs.writeFile(source, "/* @block card */ .root {}");
    await fs.writeFile(target, original);
    await fs.symlink(target, `${source}.d.ts`, "file");
    await writeStandardCliViteConfig(root);
    assert.throws(() => runCli(root, "sync"), /BEM006/);
    assert.equal(await fs.readFile(target, "utf8"), original);

    await fs.writeFile(source, ".root {}");
    assert.match(runCli(root, "sync", "--include", "Card.module.css"), /sync: 0/);
    assert.equal(await fs.readFile(target, "utf8"), original);
    assert.ok((await fs.lstat(`${source}.d.ts`)).isSymbolicLink());

    await fs.unlink(source);
    runCli(root, "sync", "--include", "Card.module.css");
    assert.equal(await fs.readFile(target, "utf8"), original);
    assert.ok((await fs.lstat(`${source}.d.ts`)).isSymbolicLink());

    await fs.writeFile(source, "/* @block card */ .root {}");
    await fs.unlink(target);
    assert.throws(() => runCli(root, "sync"), /BEM006/);
    await assert.rejects(() => fs.access(target), { code: "ENOENT" });
    assert.ok((await fs.lstat(`${source}.d.ts`)).isSymbolicLink());
  } finally {
    await fs.rm(parent, { recursive: true, force: true });
  }
});

test("CLI syncは全expected型をpreflightしてから書き込む", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bem-modules-cli-preflight-"));
  try {
    const first = path.join(root, "A.module.css");
    const second = path.join(root, "B.module.css");
    await fs.writeFile(first, "/* @block p-card */\n.root {}\n", "utf8");
    await fs.writeFile(second, "/* @block p-modal */\n.root {}\n", "utf8");
    const original = "// hand-written declaration\n";
    await fs.writeFile(`${second}.d.ts`, original, "utf8");
    await writeStandardCliViteConfig(root);

    assert.throws(() => runCli(root, "sync"), /BEM006/);
    await assert.rejects(() => fs.access(`${first}.d.ts`), { code: "ENOENT" });
    assert.equal(await fs.readFile(`${second}.d.ts`, "utf8"), original);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("CLI syncは疑問符を含む実ファイルの隣へ型を生成する", {
  skip: process.platform === "win32" ? "Windowsのファイル名には疑問符を使用できない" : false,
}, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bem-modules-cli-question-"));
  try {
    const name = "Question?.module.css";
    await fs.writeFile(path.join(root, name), "/* @block card */ .root {}");
    await writeStandardCliViteConfig(root);
    runCli(root, "sync");
    assert.match(await fs.readFile(path.join(root, `${name}.d.ts`), "utf8"), /readonly "root": string/);
    assert.deepEqual(
      (await fs.readdir(root)).sort(),
      [name, `${name}.d.ts`, "bem-modules.config.mjs", "vite.config.mjs"].sort(),
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
