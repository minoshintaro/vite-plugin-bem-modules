import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import postcss from "postcss";
import selectorParser from "postcss-selector-parser";
import ts from "typescript";
import { build, type Plugin } from "vite";
import bemModules from "../src/index.js";

type HookFunction = (...args: never[]) => unknown;

function testBemModules(options: Parameters<typeof bemModules>[0] = {}) {
  return bemModules(options);
}

function unwrapHook<T extends HookFunction>(hook: T | { handler: T }): T {
  return typeof hook === "function" ? hook : hook.handler;
}

function getCssPlugin(options: Parameters<typeof bemModules>[0] = {}): Plugin {
  const plugins = testBemModules(options);
  assert.ok(Array.isArray(plugins));
  const plugin = plugins.find(
    (candidate): candidate is Plugin =>
      typeof candidate === "object"
      && candidate !== null
      && !Array.isArray(candidate)
      && "name" in candidate
      && candidate.name === "vite-plugin-bem-modules:css",
  );
  assert.ok(plugin);
  return plugin;
}

async function createFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bem-modules-"));
  await fs.writeFile(
    path.join(root, "Card.module.css"),
    `/* @block p-card */\n.root { color: red; }\n.root--compact { gap: 4px; }\n.root--small { font-size: 12px; }\n.profileImage { width: 40px; }\n.profileImage--rounded { border-radius: 50%; }\n`,
    "utf8",
  );
  await fs.writeFile(
    path.join(root, "main.ts"),
    `import styles from './Card.module.css';\nexport const classes = [styles.rootCompact, styles.profileImageRounded].join(' ');\nexport const smallClass = styles.rootSmall;\n`,
    "utf8",
  );
  return root;
}

async function createGlobalClassFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bem-modules-global-"));
  await fs.writeFile(
    path.join(root, "Card.module.css"),
    `/* @block p-card */\n.root { color: red; }\n.is-active { opacity: 1; }\n.has-error { color: red; }\n.active { display: block; }\n.active-state { visibility: visible; }\n`,
    "utf8",
  );
  await fs.writeFile(
    path.join(root, "main.ts"),
    `import styles from './Card.module.css';\nexport const classes = [styles.root, styles.isActive, styles.hasError, styles.active, styles.activeState].join(' ');\n`,
    "utf8",
  );
  return root;
}

test("Vite build が BEM class、flat API、d.ts を一つの schema から生成する", async () => {
  const root = await createFixture();
  try {
    await build({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [testBemModules({ types: true })],
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

    const dts = await fs.readFile(path.join(root, "Card.module.css.d.ts"), "utf8");
    assert.match(dts, /readonly "profileImage": string/);
    assert.match(dts, /readonly "root": string/);
    assert.match(dts, /readonly "rootCompact": string/);
    assert.match(dts, /readonly "rootSmall": string/);
    assert.match(dts, /readonly "profileImageRounded": string/);

    const typecheckFile = path.join(root, "typecheck.ts");
    await fs.writeFile(
      typecheckFile,
      `import styles from './Card.module.css';\nconst valid = styles.profileImageRounded;\nconst invalid = styles.profileImageSquare;\nvoid valid;\nvoid invalid;\n`,
      "utf8",
    );
    const compilerConfigurations = [
      {
        name: "nodenext",
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
      },
      {
        name: "bundler",
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
      },
    ] as const;
    for (const compilerConfiguration of compilerConfigurations) {
      const program = ts.createProgram([typecheckFile], {
        noEmit: true,
        strict: true,
        skipLibCheck: true,
        module: compilerConfiguration.module,
        moduleResolution: compilerConfiguration.moduleResolution,
      });
      const diagnostics = ts.getPreEmitDiagnostics(program).filter(
        (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
      );
      assert.equal(
        diagnostics.length,
        1,
        `${compilerConfiguration.name}: ${diagnostics.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")).join("\n")}`,
      );
      const diagnostic = diagnostics[0];
      assert.ok(diagnostic);
      const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
        assert.match(message, /Property 'profileImageSquare' does not exist/);
      const line = diagnostic.file && diagnostic.start !== undefined
        ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1
        : null;
      assert.equal(line, 3, `${compilerConfiguration.name}: ${message}`);
    }

    const distFiles = await fs.readdir(path.join(root, "dist"));
    const jsFile = distFiles.find((file) => file.endsWith(".js") || file.endsWith(".mjs"));
    assert.ok(jsFile);
    const js = await fs.readFile(path.join(root, "dist", jsFile), "utf8");
    assert.match(js, /p-card--compact/);
    assert.match(js, /p-card--small/);
    assert.match(js, /p-card__profileImage--rounded/);
    const built = await import(`${pathToFileURL(path.join(root, "dist", jsFile)).href}?test=${Date.now()}`);
    assert.equal(
      built.classes,
      "p-card--compact p-card__profileImage--rounded",
    );
    assert.equal(built.smallClass, "p-card--small");

    const cssFile = distFiles.find((file) => file.endsWith(".css"));
    assert.ok(cssFile);
    const css = await fs.readFile(path.join(root, "dist", cssFile), "utf8");
    assert.match(css, /\.p-card\s*\{/);
    assert.match(css, /\.p-card__profileImage--rounded\s*\{/);
    assert.doesNotMatch(css, /@block/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("flat CSS Module keyだけを公開し、source transformを提供しない", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bem-modules-flat-api-"));
  try {
    await fs.writeFile(
      path.join(root, "Card.module.css"),
      "/* @block p-card */\n.root {}\n.root--compact {}\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(root, "main.ts"),
      "import styles from './Card.module.css';\nexport const className = styles.rootCompact;\n",
      "utf8",
    );

    await build({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [bemModules({ types: true })],
      build: {
        outDir: "dist",
        emptyOutDir: true,
        minify: false,
        lib: { entry: "main.ts", formats: ["es"], fileName: "index" },
      },
    });

    const dts = await fs.readFile(path.join(root, "Card.module.css.d.ts"), "utf8");
    assert.match(dts, /readonly "rootCompact": string/);
    assert.doesNotMatch(dts, /BemClass/);
    const jsFile = (await fs.readdir(path.join(root, "dist"))).find((file) => file.endsWith(".js") || file.endsWith(".mjs"));
    assert.ok(jsFile);
    const built = await import(`${pathToFileURL(path.join(root, "dist", jsFile)).href}?test=${Date.now()}`);
    assert.equal(built.className, "p-card--compact");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("modifierOutput: withBaseはflat Modifier exportへBaseを併記し、CSS selectorは変えない", async () => {
  const root = await createFixture();
  try {
    await build({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [testBemModules({ types: false, modifierOutput: "withBase" })],
      build: {
        outDir: "dist",
        emptyOutDir: true,
        minify: false,
        lib: { entry: "main.ts", formats: ["es"], fileName: "index" },
      },
    });

    const distFiles = await fs.readdir(path.join(root, "dist"));
    const jsFile = distFiles.find((file) => file.endsWith(".js") || file.endsWith(".mjs"));
    assert.ok(jsFile);
    const built = await import(`${pathToFileURL(path.join(root, "dist", jsFile)).href}?test=${Date.now()}`);
    assert.equal(
      built.classes,
      "p-card p-card--compact p-card__profileImage p-card__profileImage--rounded",
    );
    assert.equal(built.smallClass, "p-card p-card--small");

    const cssFile = distFiles.find((file) => file.endsWith(".css"));
    assert.ok(cssFile);
    const css = await fs.readFile(path.join(root, "dist", cssFile), "utf8");
    assert.match(css, /\.p-card--compact\s*\{/);
    assert.match(css, /\.p-card__profileImage--rounded\s*\{/);
    assert.doesNotMatch(css, /p-card p-card--compact/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("types未指定のbuildは隣接d.tsを生成も削除もしない", async () => {
  const root = await createFixture();
  const dtsFile = path.join(root, "Card.module.css.d.ts");
  const existing = "// Generated by vite-plugin-bem-modules. Do not edit.\n// keep during build\n";
  try {
    await fs.writeFile(dtsFile, existing, "utf8");
    await build({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [testBemModules()],
      build: {
        outDir: "dist",
        emptyOutDir: true,
        lib: { entry: "main.ts", formats: ["es"], fileName: "index" },
      },
    });
    assert.equal(await fs.readFile(dtsFile, "utf8"), existing);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("types:trueのbuildは隣接d.tsを生成する", async () => {
  const root = await createFixture();
  try {
    await build({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [testBemModules({ types: true })],
      build: {
        outDir: "dist",
        emptyOutDir: true,
        lib: { entry: "main.ts", formats: ["es"], fileName: "index" },
      },
    });
    assert.match(await fs.readFile(path.join(root, "Card.module.css.d.ts"), "utf8"), /readonly "rootCompact": string/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Project excludeは未importのBEM Moduleを検査対象から除外する", async () => {
  const root = await createFixture();
  try {
    await fs.mkdir(path.join(root, "fixtures"));
    await fs.writeFile(
      path.join(root, "fixtures", "Legacy.module.css"),
      "/* @block p-card */ .root {}",
      "utf8",
    );
    await build({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [testBemModules({ types: false, project: { exclude: ["fixtures"] } })],
      build: {
        outDir: "dist",
        emptyOutDir: true,
        lib: { entry: "main.ts", formats: ["es"], fileName: "index" },
      },
    });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("無視directoryからのimportは明示includeしたときだけProjectの一意性検査と型生成へ参加する", async () => {
  const root = await createFixture();
  const ignoredFile = path.join(root, "dist", "Other.module.css");
  try {
    await fs.mkdir(path.dirname(ignoredFile));
    await fs.writeFile(ignoredFile, "/* @block p-card */ .root { color: blue; }", "utf8");
    await fs.appendFile(path.join(root, "main.ts"), "import './dist/Other.module.css';\n");
    const buildFixture = (include?: string[]) => build({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [bemModules({ types: true, project: { include } })],
      build: {
        outDir: "out",
        emptyOutDir: true,
        lib: { entry: "main.ts", formats: ["es"], fileName: "index" },
      },
    });

    await buildFixture();
    assert.match(await fs.readFile(path.join(root, "Card.module.css.d.ts"), "utf8"), /readonly "rootCompact": string/);
    await assert.rejects(() => fs.access(`${ignoredFile}.d.ts`), { code: "ENOENT" });
    await assert.rejects(() => buildFixture([".", "dist"]), /vite-plugin-bem-modules:BEM003/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("既定のProject範囲は未importのBEM Moduleも検査する", async () => {
  const root = await createFixture();
  try {
    await fs.writeFile(
      path.join(root, "Unused.module.css"),
      "/* @block p-card */ .root {}",
      "utf8",
    );
    await assert.rejects(
      () => build({
        root,
        configFile: false,
        logLevel: "silent",
        plugins: [bemModules({ types: false })],
        build: {
          outDir: "dist",
          emptyOutDir: true,
          lib: { entry: "main.ts", formats: ["es"], fileName: "index" },
        },
      }),
      /Block names must be unique across CSS Modules/,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Project範囲内の未importModuleもHMR更新でschemaを再解析する", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bem-modules-project-hmr-"));
  const cssFile = path.join(root, "Unused.module.css");
  try {
    await fs.writeFile(cssFile, "/* @block p-unused */ .root {}", "utf8");
    await fs.writeFile(path.join(root, "main.ts"), "export const value = 1;", "utf8");
    const plugins = bemModules({ types: false });
    assert.ok(Array.isArray(plugins));
    const cssPlugin = plugins.find(
      (candidate): candidate is Plugin => typeof candidate === "object"
        && candidate !== null
        && !Array.isArray(candidate)
        && "name" in candidate
        && candidate.name === "vite-plugin-bem-modules:css",
    );
    assert.ok(cssPlugin);

    await build({
      root,
      configFile: false,
      logLevel: "silent",
      plugins,
      build: {
        outDir: "dist",
        emptyOutDir: true,
        minify: false,
        lib: { entry: "main.ts", formats: ["es"], fileName: "index" },
      },
    });

    const cssNode = { file: cssFile, id: cssFile, importers: new Set() };
    const hotUpdate = unwrapHook(cssPlugin.hotUpdate!);
    const result = await hotUpdate.call(
      { warn() {} } as never,
      {
        type: "update" as const,
        file: cssFile,
        timestamp: Date.now(),
        modules: [cssNode] as never,
        server: {} as never,
        read: async () => "/* @block p-unused */ .root {} .root--compact {}",
      },
    );
    assert.deepEqual(result, [cssNode]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Project scope外のBEM ModuleもVite Adapterのtransform対象になる", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bem-modules-project-transform-outside-"));
  const excludedFile = path.join(root, "fixtures", "Legacy.module.css");
  const cssSource = "/* @block p-legacy */ .root {}";
  const cssPlugin = getCssPlugin({ types: false, project: { exclude: ["fixtures"] } });
  try {
    await fs.mkdir(path.dirname(excludedFile), { recursive: true });
    await fs.writeFile(excludedFile, cssSource, "utf8");
    await fs.writeFile(path.join(root, "main.ts"), "export const value = 1;", "utf8");

    await build({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [cssPlugin],
      build: {
        outDir: "dist",
        emptyOutDir: true,
        minify: false,
        lib: { entry: "main.ts", formats: ["es"], fileName: "index" },
      },
    });

    const transformed = await unwrapHook(cssPlugin.transform!).call(
      { warn() {} } as never,
      cssSource,
      excludedFile,
    );
    assert.ok(transformed && typeof transformed === "object" && "code" in transformed);
    assert.match((transformed as { code: string }).code, /p-legacy/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("HMRはCSS export projectionが不変ならCSS importerをinvalidateしない", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bem-modules-hmr-projection-"));
  const cssFile = path.join(root, "Card.module.css");
  const mainFile = path.join(root, "main.ts");
  const plugins = testBemModules({ types: false, modifierOutput: "withBase" });
  assert.ok(Array.isArray(plugins));
  const cssPlugin = plugins.find(
    (candidate): candidate is Plugin => typeof candidate === "object"
      && candidate !== null
      && !Array.isArray(candidate)
      && "name" in candidate
      && candidate.name === "vite-plugin-bem-modules:css",
  );
  assert.ok(cssPlugin);
  try {
    await fs.writeFile(cssFile, "/* @block p-card */ .root {} .root--compact { color: red; }", "utf8");
    await fs.writeFile(mainFile, "import styles from './Card.module.css'; export const value = styles.root;", "utf8");
    await build({
      root,
      configFile: false,
      logLevel: "silent",
      plugins,
      build: {
        outDir: "dist",
        emptyOutDir: true,
        lib: { entry: "main.ts", formats: ["es"], fileName: "index" },
      },
    });
    const mainNode = { file: mainFile, id: mainFile, importers: new Set() };
    const cssNode = { file: cssFile, id: cssFile, importers: new Set([mainNode]) };
    const context = {
      type: "update" as const,
      file: cssFile,
      timestamp: Date.now(),
      modules: [cssNode] as never,
      server: {} as never,
    };
    const hotUpdate = unwrapHook(cssPlugin.hotUpdate!);
    const styleOnly = await hotUpdate.call(
      { warn() {} } as never,
      { ...context, read: async () => "/* @block p-card */ .root {} .root--compact { color: blue; }" },
    );
    assert.equal(styleOnly, undefined);

    const schemaChanged = await hotUpdate.call(
      { warn() {} } as never,
      { ...context, read: async () => "/* @block p-card */ .root {} .root--large {}" },
    );
    assert.deepEqual(schemaChanged, [cssNode, mainNode]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("types:trueは手書きの隣接 d.ts をBEM006で拒否する", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bem-modules-dts-owned-"));
  try {
    await fs.writeFile(path.join(root, "Card.module.css"), "/* @block p-card */ .root {}", "utf8");
    await fs.writeFile(path.join(root, "Card.module.css.d.ts"), "export default {} as Record<string, string>;\n", "utf8");
    await fs.writeFile(path.join(root, "main.ts"), "import styles from './Card.module.css'; export const className = styles.root;", "utf8");

    await assert.rejects(
      () => build({
        root,
        configFile: false,
        logLevel: "silent",
        plugins: [testBemModules({ types: true })],
        build: {
          outDir: "dist",
          emptyOutDir: true,
          minify: false,
          lib: { entry: "main.ts", formats: ["es"], fileName: "index" },
        },
      }),
      /vite-plugin-bem-modules:BEM006/,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("@block のない CSS Module はViteのCSS Modules設定へ委譲する", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bem-modules-vite-css-"));
  try {
    await fs.writeFile(path.join(root, "Plain.module.css"), ".root { color: red; }", "utf8");
    await fs.writeFile(
      path.join(root, "main.ts"),
      "import styles from './Plain.module.css'; export const className = styles.root;",
      "utf8",
    );

    await build({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [testBemModules({ types: false })],
      css: {
        modules: {
          generateScopedName: "CUSTOM_[local]",
        },
      },
      build: {
        outDir: "dist",
        emptyOutDir: true,
        minify: false,
        lib: { entry: "main.ts", formats: ["es"], fileName: "index" },
      },
    });

    const distFiles = await fs.readdir(path.join(root, "dist"));
    const jsFile = distFiles.find((file) => file.endsWith(".js") || file.endsWith(".mjs"));
    const cssFile = distFiles.find((file) => file.endsWith(".css"));
    assert.ok(jsFile);
    assert.ok(cssFile);
    const built = await import(`${pathToFileURL(path.join(root, "dist", jsFile)).href}?test=${Date.now()}`);
    assert.equal(built.className, "CUSTOM_root");
    const css = await fs.readFile(path.join(root, "dist", cssFile), "utf8");
    assert.match(css, /\.CUSTOM_root\s*\{/);
    await assert.rejects(fs.access(path.join(root, "Plain.module.css.d.ts")), { code: "ENOENT" });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("inline PostCSS plugin と既存の getJSON は config hook で二重化しない", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bem-modules-postcss-config-"));
  let getJSONCalls = 0;
  const postcssPlugin = {
    postcssPlugin: "vite-plugin-bem-modules-test-postcss",
    Once(rootNode: { append(node: { type: string; text: string }): void }) {
      rootNode.append({ type: "comment", text: "postcss-once" });
    },
  };
  try {
    await fs.writeFile(
      path.join(root, "Card.module.css"),
      "/* @block p-card */ .root { color: red; } .root--compact { gap: 4px; }",
      "utf8",
    );
    await fs.writeFile(
      path.join(root, "main.ts"),
      "import styles from './Card.module.css'; export const className = styles.rootCompact;",
      "utf8",
    );

    await build({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [testBemModules()],
      css: {
        postcss: { plugins: [postcssPlugin] },
        modules: {
          localsConvention: "camelCase",
          getJSON: () => {
            getJSONCalls += 1;
          },
        },
      },
      build: {
        outDir: "dist",
        emptyOutDir: true,
        minify: false,
        lib: { entry: "main.ts", formats: ["es"], fileName: "index" },
      },
    });

    const distFiles = await fs.readdir(path.join(root, "dist"));
    const cssFile = distFiles.find((file) => file.endsWith(".css"));
    assert.ok(cssFile);
    const css = await fs.readFile(path.join(root, "dist", cssFile), "utf8");
    assert.equal((css.match(/postcss-once/g) ?? []).length, 1, css);
    assert.equal(getJSONCalls, 1);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("後続pluginのgetJSON設定でもBEM009観測を失わない", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bem-modules-late-get-json-"));
  try {
    await fs.writeFile(path.join(root, "_mixins.scss"), "@mixin badge { .badge { color: red; } }", "utf8");
    await fs.writeFile(
      path.join(root, "Card.module.scss"),
      `/* @block p-card */
@use "./mixins" as *;
.root { @include badge; }
`,
      "utf8",
    );
    await fs.writeFile(
      path.join(root, "main.ts"),
      "import styles from './Card.module.scss'; export const className = styles.root;",
      "utf8",
    );

    await assert.rejects(
      () => build({
        root,
        configFile: false,
        logLevel: "silent",
        plugins: [
          testBemModules({ types: false }),
          {
            name: "late-get-json-plugin",
            config() {
              return { css: { modules: { getJSON() {} } } };
            },
          },
        ],
        build: {
          outDir: "dist",
          emptyOutDir: true,
          minify: false,
          lib: { entry: "main.ts", formats: ["es"], fileName: "index" },
        },
      }),
      /vite-plugin-bem-modules:BEM009.*unexpected keys: badge/s,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("BEM schemaのaliasを削るlocalsConventionは出力不一致として拒否する", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bem-modules-convention-"));
  try {
    await fs.writeFile(
      path.join(root, "Card.module.css"),
      "/* @block p-card */ .root {} .profile-image {} .profile-image--rounded {}",
      "utf8",
    );
    await fs.writeFile(
      path.join(root, "main.ts"),
      "import styles from './Card.module.css'; export const className = styles.profileImageRounded;",
      "utf8",
    );

    await assert.rejects(
      () => build({
        root,
        configFile: false,
        logLevel: "silent",
        plugins: [testBemModules({ types: false, naming: { wordCase: "kebab" } })],
        css: { modules: { localsConvention: "camelCaseOnly" } },
        build: {
          outDir: "dist",
          emptyOutDir: true,
          minify: false,
          lib: { entry: "main.ts", formats: ["es"], fileName: "index" },
        },
      }),
      /vite-plugin-bem-modules:BEM009/,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("CSS ModuleのkeyframesとICSS valueを含むBEM moduleをbuildできる", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bem-modules-exports-"));
  try {
    await fs.writeFile(
      path.join(root, "Card.module.css"),
      `/* @block p-card */
@value primary: #f00;
@keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
.root { color: primary; animation: fade-in 1s; }
`,
      "utf8",
    );
    await fs.writeFile(
      path.join(root, "main.ts"),
      "import styles from './Card.module.css'; export const className = styles.root;",
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
        lib: { entry: "main.ts", formats: ["es"], fileName: "index" },
      },
    });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("括弧付きICSS @value importをBEM009にしない", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bem-modules-parenthesized-values-"));
  try {
    await fs.writeFile(
      path.join(root, "tokens.css"),
      ":export { primary: #f00; secondary: #0f0; }\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(root, "Card.module.css"),
      `/* @block p-card */
@value (primary, secondary) from "./tokens.css";
@value (primary as brand) from "./tokens.css";
.root { color: primary; background: secondary; border-color: brand; }
`,
      "utf8",
    );
    await fs.writeFile(
      path.join(root, "main.ts"),
      "import styles from './Card.module.css'; export const className = styles.root;",
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
        lib: { entry: "main.ts", formats: ["es"], fileName: "index" },
      },
    });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("localsConvention camelCaseの追加aliasはBEM schemaと両立する", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bem-modules-camel-alias-"));
  try {
    await fs.writeFile(
      path.join(root, "Card.module.css"),
      "/* @block p-card */ .root {} .item-2col {} .item-2col--wide {}",
      "utf8",
    );
    await fs.writeFile(
      path.join(root, "main.ts"),
      "import styles from './Card.module.css'; export const className = styles.item2colWide; export const sourceClassName = styles[\"item-2col--wide\"];",
      "utf8",
    );

    await build({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [testBemModules({ types: false, modifierOutput: "withBase", naming: { wordCase: "kebab" } })],
      css: { modules: { localsConvention: "camelCase" } },
      build: {
        outDir: "dist",
        emptyOutDir: true,
        minify: false,
        lib: { entry: "main.ts", formats: ["es"], fileName: "index" },
      },
    });

    const jsFile = (await fs.readdir(path.join(root, "dist"))).find((file) => file.endsWith(".js") || file.endsWith(".mjs"));
    assert.ok(jsFile);
    const built = await import(`${pathToFileURL(path.join(root, "dist", jsFile)).href}?test=${Date.now()}`);
    assert.equal(built.className, "p-card__item-2col p-card__item-2col--wide");
    assert.equal(built.sourceClassName, "p-card__item-2col p-card__item-2col--wide");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("最終CSS Module exportにschema外classがあればBEM009で拒否する", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bem-modules-mixin-output-"));
  try {
    await fs.writeFile(path.join(root, "_mixins.scss"), "@mixin badge { .badge { color: red; } }", "utf8");
    await fs.writeFile(
      path.join(root, "Card.module.scss"),
      `/* @block p-card */
@use "./mixins" as *;
.root { @include badge; }
`,
      "utf8",
    );
    await fs.writeFile(
      path.join(root, "main.ts"),
      "import styles from './Card.module.scss'; export const className = styles.root;",
      "utf8",
    );

    await assert.rejects(
      () => build({
        root,
        configFile: false,
        logLevel: "silent",
        plugins: [testBemModules({ types: false })],
        build: {
          outDir: "dist",
          emptyOutDir: true,
          minify: false,
          lib: { entry: "main.ts", formats: ["es"], fileName: "index" },
        },
      }),
      /vite-plugin-bem-modules:BEM009.*unexpected keys: badge/s,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("未知classが既知classと同じexport値なら由来をaliasと断定しない", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bem-modules-output-alias-"));
  try {
    await fs.writeFile(path.join(root, "_mixins.scss"), "@mixin badge { .badge { color: red; } }", "utf8");
    await fs.writeFile(
      path.join(root, "Card.module.scss"),
      `/* @block p-card */
@use "./mixins" as *;
.root { @include badge; }
`,
      "utf8",
    );
    await fs.writeFile(
      path.join(root, "main.ts"),
      "import styles from './Card.module.scss'; export const className = styles.root;",
      "utf8",
    );

    await build({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [testBemModules({ types: false })],
      css: {
        modules: {
          generateScopedName: () => "p-card",
        },
      },
      build: {
        outDir: "dist",
        emptyOutDir: true,
        minify: false,
        lib: { entry: "main.ts", formats: ["es"], fileName: "index" },
      },
    });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("BEM対象の raw / inline / url query はBEM008で拒否する", async () => {
  for (const query of ["raw", "inline", "url"] as const) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), `bem-modules-${query}-`));
    try {
      await fs.writeFile(path.join(root, "Card.module.css"), "/* @block p-card */ .root {}", "utf8");
      await fs.writeFile(
        path.join(root, "main.ts"),
        `import css from './Card.module.css?${query}'; export const value = css;`,
        "utf8",
      );

      await assert.rejects(
        () => build({
          root,
          configFile: false,
          logLevel: "silent",
          plugins: [testBemModules({ types: false })],
          build: {
            outDir: "dist",
            emptyOutDir: true,
            minify: false,
            lib: { entry: "main.ts", formats: ["es"], fileName: "index" },
          },
        }),
        new RegExp(`vite-plugin-bem-modules:BEM008[\\s\\S]*CSS Module query[\\s\\S]*\\?${query}`),
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }
});

test("css.modules:falseではquery判定をViteへ委譲し生成型にも触れない", async () => {
  for (const query of ["raw", "inline", "url"] as const) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), `bem-modules-disabled-${query}-`));
    const dtsFile = path.join(root, "Card.module.css.d.ts");
    const existing = "// Generated by vite-plugin-bem-modules. Do not edit.\n// keep while disabled\n";
    try {
      await fs.writeFile(path.join(root, "Card.module.css"), "/* @block p-card */ .root { color: red; }", "utf8");
      await fs.writeFile(dtsFile, existing, "utf8");
      await fs.writeFile(path.join(root, "main.ts"), `import css from './Card.module.css?${query}'; export const value = css;`, "utf8");
      const buildFixture = (withPlugin = true) => build({
        root,
        configFile: false,
        logLevel: "silent",
        plugins: withPlugin ? [bemModules({ types: true })] : [],
        css: { modules: false },
        build: {
          outDir: "dist",
          emptyOutDir: true,
          minify: false,
          lib: { entry: "main.ts", formats: ["es"], fileName: "index" },
        },
      });
      if (query === "url") {
        // Vite rejects this query even when CSS Modules are disabled. The
        // adapter must preserve the same result as a build without it.
        for (const withPlugin of [false, true]) {
          await assert.rejects(() => buildFixture(withPlugin), (error: unknown) => {
            assert.doesNotMatch(String(error), /vite-plugin-bem-modules:BEM008/);
            assert.match(String(error), /\?url is not supported with CSS modules/);
            return true;
          });
        }
      } else {
        await buildFixture();
        const jsFile = (await fs.readdir(path.join(root, "dist"))).find((file) => /\.m?js$/.test(file));
        assert.ok(jsFile);
        const built = await import(pathToFileURL(path.join(root, "dist", jsFile)).href);
        assert.equal(typeof built.value, "string");
      }
      assert.equal(await fs.readFile(dtsFile, "utf8"), existing);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }
});

test("query付きの通常 CSS Module はViteへ委譲する", async () => {
  for (const query of ["raw", "inline"] as const) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), `bem-modules-plain-${query}-`));
    try {
      await fs.writeFile(path.join(root, "Plain.module.css"), ".root { color: red; }", "utf8");
      await fs.writeFile(
        path.join(root, "main.ts"),
        `import css from './Plain.module.css?${query}'; export const value = css;`,
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
          lib: { entry: "main.ts", formats: ["es"], fileName: "index" },
        },
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }

  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bem-modules-plain-url-"));
  try {
    await fs.writeFile(path.join(root, "Plain.module.css"), ".root { color: red; }", "utf8");
    await fs.writeFile(
      path.join(root, "main.ts"),
      "import css from './Plain.module.css?url'; export const value = css;",
      "utf8",
    );
    await assert.rejects(
      () => build({
        root,
        configFile: false,
        logLevel: "silent",
        plugins: [testBemModules({ types: false })],
        build: {
          outDir: "dist",
          emptyOutDir: true,
          minify: false,
          lib: { entry: "main.ts", formats: ["es"], fileName: "index" },
        },
      }),
      (error: unknown) => {
        assert.doesNotMatch(String(error), /vite-plugin-bem-modules:BEM008/);
        assert.match(String(error), /\\?url is not supported with CSS modules/);
        return true;
      },
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("SCSSの行コメント内のアポストロフィがBEM所有判定を壊さない", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bem-modules-scss-line-comment-"));
  try {
    await fs.writeFile(
      path.join(root, "Card.module.scss"),
      `// don't remove this
/* @block p-card */
.root { color: red; }
.root--compact { gap: 4px; }
`,
      "utf8",
    );
    await fs.writeFile(
      path.join(root, "main.ts"),
      "import styles from './Card.module.scss'; export const className = styles.rootCompact;",
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
        lib: { entry: "main.ts", formats: ["es"], fileName: "index" },
      },
    });

    const distFiles = await fs.readdir(path.join(root, "dist"));
    const jsFile = distFiles.find((file) => file.endsWith(".js") || file.endsWith(".mjs"));
    const cssFile = distFiles.find((file) => file.endsWith(".css"));
    assert.ok(jsFile);
    assert.ok(cssFile);
    const built = await import(`${pathToFileURL(path.join(root, "dist", jsFile)).href}?test=${Date.now()}`);
    assert.equal(built.className, "p-card--compact");
    const css = await fs.readFile(path.join(root, "dist", cssFile), "utf8");
    assert.match(css, /\.p-card\s*\{/);
    assert.match(css, /\.p-card--compact\s*\{/);
    assert.doesNotMatch(css, /\._root/);
    assert.doesNotMatch(css, /@block/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("SCSSの非引用URL内の//でもBEM所有判定を維持する", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bem-modules-scss-url-comment-"));
  try {
    await fs.writeFile(
      path.join(root, "Card.module.scss"),
      `$asset: url(http://example.com/a.png); /* @block p-card */
.root { background: $asset; }
.root--compact { gap: 4px; }
`,
      "utf8",
    );
    await fs.writeFile(
      path.join(root, "main.ts"),
      "import styles from './Card.module.scss'; export const className = styles.rootCompact;",
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
        lib: { entry: "main.ts", formats: ["es"], fileName: "index" },
      },
    });

    const distFiles = await fs.readdir(path.join(root, "dist"));
    const jsFile = distFiles.find((file) => file.endsWith(".js") || file.endsWith(".mjs"));
    const cssFile = distFiles.find((file) => file.endsWith(".css"));
    assert.ok(jsFile);
    assert.ok(cssFile);
    const built = await import(`${pathToFileURL(path.join(root, "dist", jsFile)).href}?test=${Date.now()}`);
    assert.equal(built.className, "p-card--compact");
    const css = await fs.readFile(path.join(root, "dist", cssFile), "utf8");
    assert.match(css, /\.p-card\s*\{/);
    assert.match(css, /url\(http:\/\/example\.com\/a\.png\)/);
    assert.doesNotMatch(css, /\._root/);
    assert.doesNotMatch(css, /@block/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Sass nestingはViteに実コンパイルを委ね、明示的なlocal classをBEM schemaへ取り込む", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bem-modules-sass-"));

  try {
    await fs.writeFile(
      path.join(root, "Card.module.scss"),
      `/* @block p-card */
.root {
  color: red;

  .label {
    font-weight: 700;
  }
}
`,
      "utf8",
    );
    await fs.writeFile(
      path.join(root, "main.ts"),
      `import styles from "./Card.module.scss";
export const classes = [styles.root, styles.label].join(" ");
`,
      "utf8",
    );

    await build({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [testBemModules({ types: true })],
      build: {
        outDir: "dist",
        emptyOutDir: true,
        minify: false,
        lib: { entry: "main.ts", formats: ["es"], fileName: "index" },
      },
    });

    const dts = await fs.readFile(path.join(root, "Card.module.scss.d.ts"), "utf8");
    assert.match(dts, /readonly "label": string/);
    assert.doesNotMatch(dts, /compact/);

    const distFiles = await fs.readdir(path.join(root, "dist"));
    const jsFile = distFiles.find((file) => file.endsWith(".js") || file.endsWith(".mjs"));
    const cssFile = distFiles.find((file) => file.endsWith(".css"));
    assert.ok(jsFile);
    assert.ok(cssFile);

    const built = await import(`${pathToFileURL(path.join(root, "dist", jsFile)).href}?test=${Date.now()}`);
    assert.equal(built.classes, "p-card p-card__label");

    const css = await fs.readFile(path.join(root, "dist", cssFile), "utf8");
    assert.match(css, /\.p-card\s*\{/);
    assert.match(css, /\.p-card\s+\.p-card__label\s*\{/);
    assert.doesNotMatch(css, /\.p-card--compact\b/);
    assert.doesNotMatch(css, /@block/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Sassでlocal class配下にネストしたglobal classをschemaとVite出力で揃える", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bem-modules-sass-global-"));

  try {
    await fs.writeFile(
      path.join(root, "Header.module.scss"),
      `/* @block siteHeader */
.root {
  :global(.wp-block-navigation) {
    font-weight: 700;
  }
}
`,
      "utf8",
    );
    await fs.writeFile(
      path.join(root, "main.ts"),
      `import styles from "./Header.module.scss";
export const className = styles.root;
`,
      "utf8",
    );

    await build({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [testBemModules({
        types: false,
        naming: { wordCase: "camel", elementSeparator: "_", modifierSeparator: "-" },
        globalScope: { prefix: ["wp-"] },
      })],
      css: {
        modules: {
          exportGlobals: true,
          localsConvention: "camelCase",
        },
      },
      build: {
        outDir: "dist",
        emptyOutDir: true,
        minify: false,
        lib: { entry: "main.ts", formats: ["es"], fileName: "index" },
      },
    });

    const distFiles = await fs.readdir(path.join(root, "dist"));
    const jsFile = distFiles.find((file) => file.endsWith(".js") || file.endsWith(".mjs"));
    const cssFile = distFiles.find((file) => file.endsWith(".css"));
    assert.ok(jsFile);
    assert.ok(cssFile);

    const built = await import(`${pathToFileURL(path.join(root, "dist", jsFile)).href}?test=${Date.now()}`);
    assert.equal(built.className, "siteHeader");
    const css = await fs.readFile(path.join(root, "dist", cssFile), "utf8");
    assert.match(css, /\.siteHeader\s+\.wp-block-navigation\s*\{/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Sass @extend !optionalはBEMではBEM005で拒否し、通常Moduleでは継承を維持する", async () => {
  for (const owned of [true, false]) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "bem-modules-sass-extend-"));
    try {
      const source = `${owned ? "/* @block p-card */" : ""}\n.root { padding: 11px; }\n.title { @extend .root !optional; color: blue; }`;
      await fs.writeFile(path.join(root, "Card.module.scss"), source, "utf8");
      await fs.writeFile(path.join(root, "main.ts"), "import styles from './Card.module.scss'; export { styles };", "utf8");
      const buildFixture = () => build({
        root,
        configFile: false,
        logLevel: "silent",
        plugins: [bemModules({ types: true })],
        css: { modules: { generateScopedName: "plain_[local]" } },
        build: {
          outDir: "dist",
          emptyOutDir: true,
          minify: false,
          cssMinify: false,
          lib: { entry: "main.ts", formats: ["es"], fileName: "index" },
        },
      });
      if (owned) {
        await assert.rejects(buildFixture, /vite-plugin-bem-modules:BEM005[\s\S]*@extend/);
      } else {
        await buildFixture();
        const cssFile = (await fs.readdir(path.join(root, "dist"))).find((file) => file.endsWith(".css"));
        assert.ok(cssFile);
        const css = postcss.parse(await fs.readFile(path.join(root, "dist", cssFile), "utf8"));
        let inheritedPadding = false;
        css.walkDecls("padding", (declaration) => {
          const rule = declaration.parent;
          if (rule?.type !== "rule") return;
          selectorParser((selectors) => {
            selectors.walkClasses((node) => {
              if (node.value === "plain_title" && declaration.value === "11px") inheritedPadding = true;
            });
          }).processSync(rule.selector);
        });
        assert.equal(inheritedPadding, true);
      }
      await assert.rejects(() => fs.access(path.join(root, "Card.module.scss.d.ts")), { code: "ENOENT" });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }
});

test("implicit BEM nestingはSassの生エラーではなくBEM005で拒否する", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bem-modules-sass-invalid-"));
  try {
    await fs.writeFile(
      path.join(root, "Card.module.scss"),
      "/* @block p-card */ .root { &--compact { gap: 4px; } }",
      "utf8",
    );
    await fs.writeFile(path.join(root, "main.ts"), "import './Card.module.scss';", "utf8");

    await assert.rejects(
      () => build({
        root,
        configFile: false,
        logLevel: "silent",
        plugins: [testBemModules()],
        build: {
          outDir: "dist",
          emptyOutDir: true,
          minify: false,
          lib: { entry: "main.ts", formats: ["es"], fileName: "index" },
        },
      }),
      /vite-plugin-bem-modules:BEM005/,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("宣言値のSass補間はimplicit BEM nestingとして診断しない", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bem-modules-sass-interpolation-"));
  try {
    await fs.writeFile(
      path.join(root, "Card.module.scss"),
      `/* @block p-card */
$space: 4px;
.root { margin: #{$space}; }
`,
      "utf8",
    );
    await fs.writeFile(path.join(root, "main.ts"), "import './Card.module.scss';", "utf8");

    await build({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [testBemModules({ types: false })],
      build: {
        outDir: "dist",
        emptyOutDir: true,
        minify: false,
        lib: { entry: "main.ts", formats: ["es"], fileName: "index" },
      },
    });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("生成済みd.tsのhotUpdateはCompiler / Project処理へ再流入しない", async () => {
  const root = await createFixture();
  const plugin = getCssPlugin({ types: true });
  const dtsFile = path.join(root, "Card.module.css.d.ts");
  try {
    await build({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [plugin],
      build: {
        outDir: "dist",
        emptyOutDir: true,
        minify: false,
        lib: { entry: "main.ts", formats: ["es"], fileName: "index" },
      },
    });
    await fs.access(dtsFile);

    const hotUpdate = unwrapHook(plugin.hotUpdate!);
    await hotUpdate.call(
      { warn() {} } as never,
      {
        type: "update",
        file: dtsFile,
        timestamp: Date.now(),
        modules: [],
        read: async () => "",
        server: {} as never,
      },
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("CSS Modules の local / global scope 切り替えをschemaと生成物で揃える", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bem-modules-scope-"));
  try {
    await fs.writeFile(
      path.join(root, "Card.module.css"),
      `/* @block p-card */
:global .vendor :local(.child, .local-list) { color: red; }
.root:not(:global .another-vendor) .descendant { color: blue; }
.root:is(.local, :global .third-party) .after { color: green; }
`,
      "utf8",
    );
    await fs.writeFile(
      path.join(root, "main.ts"),
      `import styles from "./Card.module.css";
export const classes = [styles.child, styles.localList, styles.descendant, styles.local, styles.after].join(" ");
`,
      "utf8",
    );

    await build({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [testBemModules({ types: false, naming: { wordCase: "kebab" } })],
      build: {
        outDir: "dist",
        emptyOutDir: true,
        minify: false,
        lib: { entry: "main.ts", formats: ["es"], fileName: "index" },
      },
    });

    const distFiles = await fs.readdir(path.join(root, "dist"));
    const jsFile = distFiles.find((file) => file.endsWith(".js") || file.endsWith(".mjs"));
    const cssFile = distFiles.find((file) => file.endsWith(".css"));
    assert.ok(jsFile);
    assert.ok(cssFile);

    const built = await import(`${pathToFileURL(path.join(root, "dist", jsFile)).href}?test=${Date.now()}`);
    assert.equal(
      built.classes,
      "p-card__child p-card__local-list p-card__descendant p-card__local p-card__after",
    );

    const css = await fs.readFile(path.join(root, "dist", cssFile), "utf8");
    assert.match(css, /\.vendor[^{}]*\.p-card__child[^{}]*\{/);
    assert.match(css, /\.p-card:not\(\.another-vendor\)[^{}]*\.p-card__descendant[^{}]*\{/);
    assert.match(css, /\.p-card:is\(\.p-card__local,\s*\.third-party\)[^{}]*\.p-card__after[^{}]*\{/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("globalScope の class は CSS・実行時値・d.ts で元の名前を維持する", async () => {
  const root = await createGlobalClassFixture();
  try {
    await build({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [testBemModules({ types: true, naming: { wordCase: "kebab" }, globalScope: { exact: ["active"], prefix: ["is-", "has-"] } })],
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

    const dts = await fs.readFile(path.join(root, "Card.module.css.d.ts"), "utf8");
    assert.match(dts, /readonly "is-active": string/);
    assert.match(dts, /readonly "isActive": string/);
    assert.match(dts, /readonly "has-error": string/);
    assert.match(dts, /readonly "hasError": string/);
    assert.match(dts, /readonly "active": string/);
    assert.match(dts, /readonly "active-state": string/);
    assert.match(dts, /readonly "activeState": string/);

    const distFiles = await fs.readdir(path.join(root, "dist"));
    const jsFile = distFiles.find((file) => file.endsWith(".js") || file.endsWith(".mjs"));
    assert.ok(jsFile);
    const built = await import(`${pathToFileURL(path.join(root, "dist", jsFile)).href}?test=${Date.now()}`);
    assert.equal(built.classes, "p-card is-active has-error active p-card__active-state");

    const cssFile = distFiles.find((file) => file.endsWith(".css"));
    assert.ok(cssFile);
    const css = await fs.readFile(path.join(root, "dist", cssFile), "utf8");
    assert.match(css, /\.p-card\s*\{/);
    assert.match(css, /\.is-active\s*\{/);
    assert.match(css, /\.has-error\s*\{/);
    assert.match(css, /\.active\s*\{/);
    assert.match(css, /\.p-card__active-state\s*\{/);
    assert.doesNotMatch(css, /\.p-card__is-active\b/);
    assert.doesNotMatch(css, /\.p-card__has-error\b/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("escapeを必要とするglobal classの同一性を最終CSS・export・型で維持する", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bem-modules-escaped-global-"));
  try {
    await fs.writeFile(path.join(root, "Card.module.css"), "/* @block p-card */ .root { color: red; } .foo\\.bar { padding: 11px; }", "utf8");
    await fs.writeFile(path.join(root, "main.ts"), "import styles from './Card.module.css'; export { styles };", "utf8");
    await build({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [bemModules({ types: true, globalScope: { exact: ["foo.bar"] } })],
      build: {
        outDir: "dist",
        emptyOutDir: true,
        minify: false,
        lib: { entry: "main.ts", formats: ["es"], fileName: "index" },
      },
    });
    const outputFiles = await fs.readdir(path.join(root, "dist"));
    const cssFile = outputFiles.find((file) => file.endsWith(".css"));
    const jsFile = outputFiles.find((file) => /\.m?js$/.test(file));
    assert.ok(cssFile);
    assert.ok(jsFile);
    const names: string[] = [];
    postcss.parse(await fs.readFile(path.join(root, "dist", cssFile), "utf8")).walkRules((rule) => {
      selectorParser((selectors) => {
        selectors.walkClasses((node) => { names.push(node.value); });
      }).processSync(rule.selector);
    });
    assert.deepEqual(names.sort(), ["foo.bar", "p-card"]);
    const built = await import(pathToFileURL(path.join(root, "dist", jsFile)).href);
    assert.equal(built.styles["foo.bar"], "foo.bar");
    assert.match(await fs.readFile(path.join(root, "Card.module.css.d.ts"), "utf8"), /readonly "foo\.bar": string/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Project scope内の重複Block名をbuildで拒否する", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bem-modules-duplicate-"));
  try {
    await fs.writeFile(path.join(root, "A.module.css"), "/* @block card */ .root {}", "utf8");
    await fs.writeFile(path.join(root, "B.module.css"), "/* @block card */ .root {}", "utf8");
    await fs.writeFile(path.join(root, "main.ts"), "import './A.module.css';", "utf8");

    await assert.rejects(
      () => build({
        root,
        configFile: false,
        logLevel: "silent",
        plugins: [testBemModules()],
        build: {
          outDir: "dist",
          emptyOutDir: true,
          lib: { entry: "main.ts", formats: ["es"], fileName: "index" },
        },
      }),
      /Block names must be unique across CSS Modules/,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("project.startup: deferは起動時の全体走査を延期し、到達Moduleを変換する", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bem-modules-deferred-project-"));
  try {
    await fs.writeFile(path.join(root, "A.module.css"), "/* @block card */ .root {}", "utf8");
    await fs.writeFile(path.join(root, "B.module.css"), "/* @block card */ .root {}", "utf8");
    await fs.writeFile(
      path.join(root, "main.ts"),
      "import styles from './A.module.css'; export const className = styles.root;",
      "utf8",
    );

    await assert.doesNotReject(() => build({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [testBemModules({ types: false, project: { startup: "defer" } })],
      build: {
        outDir: "dist",
        emptyOutDir: true,
        minify: false,
        lib: { entry: "main.ts", formats: ["es"], fileName: "index" },
      },
    }));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Project scope内の生成class名衝突をbuildで拒否する", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bem-modules-output-duplicate-"));
  try {
    await fs.writeFile(path.join(root, "A.module.css"), "/* @block card */ .title {}", "utf8");
    await fs.writeFile(path.join(root, "B.module.css"), "/* @block card__title */ .root {}", "utf8");
    await fs.writeFile(path.join(root, "main.ts"), "import './A.module.css'; import './B.module.css';", "utf8");

    await assert.rejects(
      () => build({
        root,
        configFile: false,
        logLevel: "silent",
        plugins: [testBemModules()],
        build: {
          outDir: "dist",
          emptyOutDir: true,
          lib: { entry: "main.ts", formats: ["es"], fileName: "index" },
        },
      }),
      /Generated class names must be unique across CSS Modules/,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("root外のBEM ModuleはProjectへ明示includeしたときだけ一意性検査へ参加する", async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "bem-modules-external-duplicate-"));
  const root = path.join(parent, "app");
  try {
    await fs.mkdir(root);
    await fs.writeFile(path.join(root, "Inside.module.css"), "/* @block same */ .root {}", "utf8");
    await fs.writeFile(path.join(parent, "Outside.module.css"), "/* @block same */ .root {}", "utf8");
    await fs.writeFile(
      path.join(root, "main.ts"),
      "import './Inside.module.css'; import '../Outside.module.css';",
      "utf8",
    );

    await assert.rejects(
      () => build({
        root,
        configFile: false,
        logLevel: "silent",
        plugins: [testBemModules({ project: { include: [".", parent] } })],
        build: {
          outDir: "dist",
          emptyOutDir: true,
          lib: { entry: "main.ts", formats: ["es"], fileName: "index" },
        },
      }),
      /Block names must be unique across CSS Modules/,
    );
  } finally {
    await fs.rm(parent, { recursive: true, force: true });
  }
});

test("root外のBEM ModuleはProjectへ明示includeしたとき隣接d.tsを生成する", async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "bem-modules-external-types-"));
  const root = path.join(parent, "app");
  const externalCss = path.join(parent, "Shared.module.css");
  try {
    await fs.mkdir(root);
    await fs.writeFile(externalCss, "/* @block shared */ .root {} .root--compact {}", "utf8");
    await fs.writeFile(
      path.join(root, "main.ts"),
      "import '../Shared.module.css';",
      "utf8",
    );

    await build({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [testBemModules({ types: true, project: { include: [".", parent] } })],
      build: {
        outDir: "dist",
        emptyOutDir: true,
        minify: false,
        lib: { entry: "main.ts", formats: ["es"], fileName: "index" },
      },
    });

    const dts = await fs.readFile(`${externalCss}.d.ts`, "utf8");
    assert.match(dts, /readonly "rootCompact": string/);
  } finally {
    await fs.rm(parent, { recursive: true, force: true });
  }
});

test("HMRはProject scope外のroot外BEM ModuleをProjectへ登録しない", async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "bem-modules-external-hmr-out-of-scope-"));
  const root = path.join(parent, "app");
  const externalCss = path.join(parent, "Shared.module.css");
  const mainFile = path.join(root, "main.ts");
  try {
    await fs.mkdir(root);
    await fs.writeFile(externalCss, "/* @block shared */ .root {}", "utf8");
    await fs.writeFile(mainFile, "export const classes = \"\";", "utf8");

    const plugins = testBemModules({ types: true });
    assert.ok(Array.isArray(plugins));
    const cssPlugin = plugins.find(
      (candidate): candidate is Plugin =>
        typeof candidate === "object"
        && candidate !== null
        && !Array.isArray(candidate)
        && "name" in candidate
        && candidate.name === "vite-plugin-bem-modules:css",
    );
    assert.ok(cssPlugin);
    await build({
      root,
      configFile: false,
      logLevel: "silent",
      plugins,
      build: {
        outDir: "dist",
        emptyOutDir: true,
        minify: false,
        lib: { entry: "main.ts", formats: ["es"], fileName: "index" },
      },
    });

    const externalNode = { file: externalCss, id: externalCss, importers: new Set() };
    const graph = {
      getModulesByFile(filePath: string) {
        return filePath === externalCss ? new Set([externalNode]) : undefined;
      },
    };
    await unwrapHook(cssPlugin.hotUpdate!).call(
      { warn() {}, environment: { moduleGraph: graph } } as never,
      {
        type: "update",
        file: externalCss,
        timestamp: Date.now(),
        modules: [externalNode] as never,
        read: async () => "/* @block shared */ .root {} .root--compact {}",
        server: {} as never,
      },
    );

    await assert.rejects(() => fs.stat(`${externalCss}.d.ts`), { code: "ENOENT" });
  } finally {
    await fs.rm(parent, { recursive: true, force: true });
  }
});

test("HMRでProject scope外になったroot外BEM Moduleの生成d.tsを削除しない", async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "bem-modules-external-hmr-reconcile-"));
  const root = path.join(parent, "app");
  const externalCss = path.join(parent, "Shared.module.css");
  const mainFile = path.join(root, "main.ts");
  try {
    await fs.mkdir(root);
    await fs.writeFile(externalCss, "/* @block shared */ .root {}", "utf8");
    await fs.writeFile(mainFile, "import '../Shared.module.css';", "utf8");

    const plugins = testBemModules({ types: true, project: { include: [".", parent] } });
    assert.ok(Array.isArray(plugins));
    const cssPlugin = plugins.find(
      (candidate): candidate is Plugin =>
        typeof candidate === "object"
        && candidate !== null
        && !Array.isArray(candidate)
        && "name" in candidate
        && candidate.name === "vite-plugin-bem-modules:css",
    );
    assert.ok(cssPlugin);
    await build({
      root,
      configFile: false,
      logLevel: "silent",
      plugins,
      build: {
        outDir: "dist",
        emptyOutDir: true,
        minify: false,
        lib: { entry: "main.ts", formats: ["es"], fileName: "index" },
      },
    });
    assert.ok(await fs.stat(`${externalCss}.d.ts`));

    const rootNode = { file: mainFile, id: mainFile, importers: new Set() };
    const externalNode = { file: externalCss, id: externalCss, importers: new Set([rootNode]) };
    const graph = {
      getModulesByFile(filePath: string) {
        if (filePath === externalCss) return new Set([externalNode]);
        if (filePath === mainFile) return new Set([rootNode]);
        return undefined;
      },
    };

    await unwrapHook(cssPlugin.hotUpdate!).call(
      { warn() {}, environment: { moduleGraph: graph } } as never,
      {
        type: "update",
        file: externalCss,
        timestamp: Date.now(),
        modules: [externalNode] as never,
        read: async () => "/* @block shared */ .root {} .root--compact {}",
        server: {} as never,
      },
    );
    const updatedDts = await fs.readFile(`${externalCss}.d.ts`, "utf8");
    assert.match(updatedDts, /readonly \"rootCompact\": string/);

    externalNode.importers.clear();
    await unwrapHook(cssPlugin.hotUpdate!).call(
      { warn() {}, environment: { moduleGraph: graph } } as never,
      {
        type: "update",
        file: externalCss,
        timestamp: Date.now(),
        modules: [externalNode] as never,
        read: async () => "/* @block shared */ .root {} .root--compact {}",
        server: {} as never,
      },
    );

    await assert.doesNotReject(() => fs.stat(`${externalCss}.d.ts`));
  } finally {
    await fs.rm(parent, { recursive: true, force: true });
  }
});

test("再ビルドでもProject範囲内のroot外BEM Moduleの生成d.tsを削除しない", async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "bem-modules-external-reconcile-"));
  const root = path.join(parent, "app");
  const externalCss = path.join(parent, "Shared.module.css");
  const plugin = testBemModules({ types: true, project: { include: [".", parent] } });
  const buildOptions = {
    root,
    configFile: false as const,
    logLevel: "silent" as const,
    plugins: [plugin],
    build: {
      outDir: "dist",
      emptyOutDir: true,
      minify: false,
      lib: { entry: "main.ts", formats: ["es" as const], fileName: "index" },
    },
  };
  try {
    await fs.mkdir(root);
    await fs.writeFile(externalCss, "/* @block shared */ .root {}", "utf8");
    await fs.writeFile(path.join(root, "main.ts"), "import '../Shared.module.css';", "utf8");
    await build(buildOptions);
    assert.ok(await fs.stat(`${externalCss}.d.ts`));

    await fs.writeFile(path.join(root, "main.ts"), "export const classes = \"\";", "utf8");
    await build(buildOptions);
    await assert.doesNotReject(() => fs.stat(`${externalCss}.d.ts`));
  } finally {
    await fs.rm(parent, { recursive: true, force: true });
  }
});

test("Vite 8 hotUpdate が削除されたCSS Moduleの隣接d.tsを掃除する", async () => {
  const root = await createFixture();
  const plugin = getCssPlugin({ types: true });
  try {
    await build({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [plugin],
      build: {
        outDir: "dist",
        emptyOutDir: true,
        minify: false,
        lib: { entry: "main.ts", formats: ["es"], fileName: "index" },
      },
    });

    const cssFile = path.join(root, "Card.module.css");
    const dtsFile = `${cssFile}.d.ts`;
    assert.ok(await fs.stat(dtsFile));
    await fs.rm(cssFile);

    const hotUpdate = unwrapHook(plugin.hotUpdate!);
    await hotUpdate.call(
      { warn() {} } as never,
      {
        type: "delete",
        file: cssFile,
        timestamp: Date.now(),
        modules: [],
        read: async () => "",
        server: {} as never,
      },
    );

    await assert.rejects(() => fs.stat(dtsFile), { code: "ENOENT" });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("types:false の hotUpdate でも生成済みd.tsを掃除する", async () => {
  const root = await createFixture();
  const plugin = getCssPlugin({ types: false });
  const generatedHeader = "// Generated by vite-plugin-bem-modules. Do not edit.\n";
  try {
    await build({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [plugin],
      build: {
        outDir: "dist",
        emptyOutDir: true,
        lib: { entry: "main.ts", formats: ["es"], fileName: "index" },
      },
    });

    const cssFile = path.join(root, "Card.module.css");
    const dtsFile = `${cssFile}.d.ts`;
    await fs.writeFile(dtsFile, generatedHeader, "utf8");
    const hotUpdate = unwrapHook(plugin.hotUpdate!);

    await hotUpdate.call(
      { warn() {} } as never,
      {
        type: "update",
        file: cssFile,
        timestamp: Date.now(),
        modules: [],
        read: async () => ".root {}",
        server: {} as never,
      },
    );
    await assert.rejects(() => fs.stat(dtsFile), { code: "ENOENT" });

    await fs.writeFile(dtsFile, generatedHeader, "utf8");
    await fs.rm(cssFile);
    await hotUpdate.call(
      { warn() {} } as never,
      {
        type: "delete",
        file: cssFile,
        timestamp: Date.now(),
        modules: [],
        read: async () => "",
        server: {} as never,
      },
    );
    await assert.rejects(() => fs.stat(dtsFile), { code: "ENOENT" });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("再起動後のbuildでも削除済みCSS Moduleの生成d.tsをreconcileする", async () => {
  const root = await createFixture();
  try {
    const buildOptions = {
      root,
      configFile: false as const,
      logLevel: "silent" as const,
      build: {
        outDir: "dist",
        emptyOutDir: true,
        minify: false,
        lib: { entry: "main.ts", formats: ["es" as const], fileName: "index" },
      },
    };
    await build({ ...buildOptions, plugins: [testBemModules({ types: true })] });

    const cssFile = path.join(root, "Card.module.css");
    const dtsFile = `${cssFile}.d.ts`;
    assert.ok(await fs.stat(dtsFile));
    await fs.rm(cssFile);
    await fs.writeFile(path.join(root, "main.ts"), "export const classes = \"\";", "utf8");

    await build({ ...buildOptions, plugins: [testBemModules({ types: true })] });
    await assert.rejects(() => fs.stat(dtsFile), { code: "ENOENT" });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Vite 8 hotUpdate でも重複Block名をエラーにする", async () => {
  const root = await createFixture();
  const plugin = getCssPlugin();
  try {
    await build({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [plugin],
      build: {
        outDir: "dist",
        emptyOutDir: true,
        minify: false,
        lib: { entry: "main.ts", formats: ["es"], fileName: "index" },
      },
    });

    const duplicateFile = path.join(root, "Other.module.css");
    await fs.writeFile(duplicateFile, "/* @block p-card */ .root {}", "utf8");
    const hotUpdate = unwrapHook(plugin.hotUpdate!);
    await assert.rejects(
      () => Promise.resolve(hotUpdate.call(
        { warn() {} } as never,
        {
          type: "create",
          file: duplicateFile,
          timestamp: Date.now(),
          modules: [],
          read: async () => "/* @block p-card */ .root {}",
          server: {} as never,
        },
      )),
      /Block names must be unique across CSS Modules/,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("symlink rootのhotUpdateでも同じCSS Moduleを重複登録しない", async () => {
  const actualRoot = await createFixture();
  const linkRoot = `${actualRoot}-link`;
  await fs.symlink(actualRoot, linkRoot, "dir");
  const plugin = getCssPlugin();
  try {
    await build({
      root: linkRoot,
      configFile: false,
      logLevel: "silent",
      plugins: [plugin],
      build: {
        outDir: "dist",
        emptyOutDir: true,
        minify: false,
        lib: { entry: "main.ts", formats: ["es"], fileName: "index" },
      },
    });

    const cssFile = path.join(linkRoot, "Card.module.css");
    const hotUpdate = unwrapHook(plugin.hotUpdate!);
    await hotUpdate.call(
      { warn() {} } as never,
      {
        type: "update",
        file: cssFile,
        timestamp: Date.now(),
        modules: [],
        read: async () => "/* @block p-card */ .root {} .root--compact {}",
        server: {} as never,
      },
    );
  } finally {
    await fs.rm(linkRoot, { recursive: true, force: true });
    await fs.rm(actualRoot, { recursive: true, force: true });
  }
});

test("types:false は既存の生成d.tsもreconcileする", async () => {
  const root = await createFixture();
  try {
    const buildOptions = {
      root,
      configFile: false as const,
      logLevel: "silent" as const,
      build: {
        outDir: "dist",
        emptyOutDir: true,
        minify: false,
        lib: { entry: "main.ts", formats: ["es" as const], fileName: "index" },
      },
    };
    await build({ ...buildOptions, plugins: [testBemModules({ types: true })] });
    const dtsFile = path.join(root, "Card.module.css.d.ts");
    assert.ok(await fs.stat(dtsFile));

    await build({ ...buildOptions, plugins: [testBemModules({ types: false })] });
    await assert.rejects(() => fs.stat(dtsFile), { code: "ENOENT" });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("node_modulesのCSS ModuleはBEM schemaの対象外にする", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bem-modules-external-"));
  try {
    await fs.mkdir(path.join(root, "node_modules", "vendor"), { recursive: true });
    await fs.writeFile(path.join(root, "node_modules", "vendor", "Vendor.module.css"), ".vendor { color: red; }", "utf8");
    await fs.writeFile(path.join(root, "main.ts"), "import styles from './node_modules/vendor/Vendor.module.css'; export const className = styles.vendor;", "utf8");

    await build({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [testBemModules()],
      css: {
        modules: {
          generateScopedName: "CUSTOM_[local]",
        },
      },
      build: {
        outDir: "dist",
        emptyOutDir: true,
        minify: false,
        lib: { entry: "main.ts", formats: ["es"], fileName: "index" },
      },
    });

    const distFiles = await fs.readdir(path.join(root, "dist"));
    const cssFile = distFiles.find((file) => file.endsWith(".css"));
    assert.ok(cssFile);
    const css = await fs.readFile(path.join(root, "dist", cssFile), "utf8");
    assert.match(css, /\.CUSTOM_vendor\s*\{/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("virtual CSS ModuleはBEM schemaの所有外としてクラッシュせず委譲する", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bem-modules-virtual-css-"));
  const virtualId = "\0virtual:theme.module.css";
  try {
    await fs.writeFile(
      path.join(root, "main.ts"),
      "import styles from \"virtual:theme.module.css\"; export const className = styles.root;",
      "utf8",
    );

    await assert.doesNotReject(() => build({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [
        {
          name: "virtual-css-module",
          resolveId(id) {
            if (id === "virtual:theme.module.css") return virtualId;
          },
          load(id) {
            if (id === virtualId) return "/* @block p-card */ .root { color: red; }";
          },
        },
        ...testBemModules({ types: false }),
      ],
      build: {
        outDir: "dist",
        emptyOutDir: true,
        minify: false,
        lib: { entry: "main.ts", formats: ["es"], fileName: "index" },
      },
    }));
    const distFiles = await fs.readdir(path.join(root, "dist"));
    const cssFile = distFiles.find((file) => file.endsWith(".css"));
    assert.ok(cssFile);
    const css = await fs.readFile(path.join(root, "dist", cssFile), "utf8");
    assert.doesNotMatch(css, /\.p-card\s*\{/);
    assert.match(css, /_root/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("path風virtual CSS ModuleもBEM schemaの所有外として委譲する", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bem-modules-path-virtual-css-"));
  const virtualId = path.join(root, "Generated.module.css");
  try {
    await fs.writeFile(
      path.join(root, "main.ts"),
      "import styles from \"virtual:path-theme.module.css\"; export const className = styles.root;",
      "utf8",
    );

    await assert.doesNotReject(() => build({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [
        {
          name: "path-virtual-css-module",
          resolveId(id) {
            if (id === "virtual:path-theme.module.css") return virtualId;
          },
          load(id) {
            if (id === virtualId) return "/* @block p-card */ .root { color: red; }";
          },
        },
        ...testBemModules({ types: false }),
      ],
      build: {
        outDir: "dist",
        emptyOutDir: true,
        minify: false,
        lib: { entry: "main.ts", formats: ["es"], fileName: "index" },
      },
    }));
    const distFiles = await fs.readdir(path.join(root, "dist"));
    const cssFile = distFiles.find((file) => file.endsWith(".css"));
    assert.ok(cssFile);
    const css = await fs.readFile(path.join(root, "dist", cssFile), "utf8");
    assert.doesNotMatch(css, /\.p-card\s*\{/);
    assert.match(css, /_root/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Lightning CSS transformerは明示的に拒否する", () => {
  const plugin = getCssPlugin();
  assert.throws(
    () => unwrapHook(plugin.configResolved!).call(
      undefined as never,
      {
        css: { transformer: "lightningcss", modules: {} },
      } as never,
    ),
    /lightningcss.*not supported/,
  );
});
