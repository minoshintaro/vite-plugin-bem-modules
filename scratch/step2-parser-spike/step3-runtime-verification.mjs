import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import postcss from "postcss";
import { build, createServer } from "vite";
import { declarationExists } from "./class-map-dts.mjs";
import { createBemCompanionPlugin, createBemPostcssPlugin } from "./parser-plugin.mjs";

const execFileAsync = promisify(execFile);
const spikeRoot = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = path.join(spikeRoot, "fixture");
const tempRoot = path.join(spikeRoot, ".tmp-step3-runtime");
const resultsPath = path.join(spikeRoot, "step3-results.json");

function makeLogger() {
  const records = [];
  let hasWarned = false;
  const logger = {
    info() {},
    warn(message) {
      hasWarned = true;
      records.push(String(message));
    },
    warnOnce(message) {
      hasWarned = true;
      records.push(String(message));
    },
    error(message) {
      records.push(`ERROR ${String(message)}`);
    },
    clearScreen() {},
  };
  Object.defineProperty(logger, "hasWarned", { get: () => hasWarned });
  return { logger, records };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForEventOrNull(emitter, eventName, predicate, timeoutMs = 5000) {
  return new Promise((resolve) => {
    let timer;
    const onEvent = (...args) => {
      if (!predicate(...args)) return;
      clearTimeout(timer);
      emitter.off(eventName, onEvent);
      resolve(args);
    };
    timer = setTimeout(() => {
      emitter.off(eventName, onEvent);
      resolve(null);
    }, timeoutMs);
    emitter.on(eventName, onEvent);
  });
}

function waitForWebSocketOpen(socket, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    socket.addEventListener("open", () => {
      clearTimeout(timer);
      resolve(true);
    }, { once: true });
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      resolve(false);
    }, { once: true });
  });
}

function sourceFile(tempFixtureRoot, name) {
  return path.join(tempFixtureRoot, "src", name);
}

async function createTempFixture() {
  await rm(tempRoot, { recursive: true, force: true });
  await mkdir(path.join(tempRoot, "src"), { recursive: true });
  await cp(path.join(fixtureRoot, "src"), path.join(tempRoot, "src"), { recursive: true });
  await cp(path.join(fixtureRoot, "index.html"), path.join(tempRoot, "index.html"));

  const cardPath = sourceFile(tempRoot, "Card.module.css");
  const card = await readFile(cardPath, "utf8");
  await writeFile(cardPath, `${card}
.dynamic {
  animation: var(--runtime-animation) 1s;
  animation-name: var(--runtime-animation);
}

.static {
  animation: 150ms linear static-spin;
  animation-name: static-spin;
}

@keyframes static-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(1turn); }
}
`);

  const protectedPath = sourceFile(tempRoot, "Protected.module.css");
  await writeFile(protectedPath, "/* @block p-protected */\n.root { color: teal; }\n");
  await writeFile(`${protectedPath}.d.ts`, "// hand-written declaration\nexport default {};\n");
  const mainPath = sourceFile(tempRoot, "main.js");
  const mainSource = await readFile(mainPath, "utf8");
  await writeFile(mainPath, `${mainSource}import protectedStyles from "./Protected.module.css";\nconsole.log("PROTECTED " + JSON.stringify(protectedStyles));\n`);

  const parserPath = pathToFileURL(path.join(spikeRoot, "parser-plugin.mjs")).href;
  const configPath = path.join(tempRoot, "vite.config.mjs");
  const config = `
import { defineConfig } from "vite";
import { createBemCompanionPlugin, createBemPostcssPlugin } from ${JSON.stringify(parserPath)};

const bemParser = createBemPostcssPlugin({ dts: true });
globalThis.__step3BemParser = bemParser;

const hmrProbe = {
  name: "step3-hmr-probe",
  handleHotUpdate(context) {
    globalThis.__step3HmrEvents ??= [];
    globalThis.__step3HmrEvents.push({
      file: context.file,
      modules: context.modules.map((module) => module.url),
    });
  },
};

const postcssOrderProbe = {
  postcssPlugin: "postcss-order-probe",
  Once(root) {
    if (root.toString().includes(":global(.p-card)")) {
      root.append({
        selector: ":root",
        nodes: [{ type: "decl", prop: "--postcss-order-probe", value: "after-bem" }],
      });
    }
  },
};

export default defineConfig({
  root: ${JSON.stringify(tempRoot)},
  plugins: [hmrProbe, createBemCompanionPlugin({ keyframesRegistry: bemParser.keyframesRegistry })],
  build: {
    outDir: "dist",
    lib: {
      entry: "src/main.js",
      formats: ["es"],
      fileName: "bundle",
    },
  },
  css: {
    modules: { exportGlobals: false },
    postcss: {
      plugins: [bemParser, postcssOrderProbe],
    },
  },
});
`;
  await writeFile(configPath, config);
  return { configPath, cardPath };
}

async function readBuildOutput() {
  const files = await readdir(path.join(tempRoot, "dist"));
  const cssFile = files.find((file) => file.endsWith(".css"));
  const jsFile = files.find((file) => file.endsWith(".js"));
  assert.ok(cssFile, `build CSS output missing: ${files.join(", ")}`);
  assert.ok(jsFile, `build JS output missing: ${files.join(", ")}`);
  const css = await readFile(path.join(tempRoot, "dist", cssFile), "utf8");
  const jsPath = path.join(tempRoot, "dist", jsFile);
  const js = await readFile(jsPath, "utf8");
  const runtime = await execFileAsync(process.execPath, [jsPath], { encoding: "utf8" });
  const exportsLine = runtime.stdout.trim().split("\n").find((line) => line.startsWith("EXPORTS "));
  assert.ok(exportsLine, runtime.stdout);
  return {
    css,
    js,
    exports: JSON.parse(exportsLine.slice("EXPORTS ".length)),
    files: { css: cssFile, js: jsFile },
  };
}

function adjacentDeclarationPaths(sourcePath) {
  return [
    `${sourcePath}.d.ts`,
    sourcePath.replace(/\.(?:css|scss)$/, ".d.ts"),
  ];
}

async function inspectAdjacentDeclarations(tempSourceRoot, runtimeExports) {
  const modules = {
    card: "Card.module.css",
    scss: "Card.module.scss",
    plain: "Plain.module.css",
    modal: "Modal.module.css",
    protected: "Protected.module.css",
  };
  const inspection = {};
  for (const [key, file] of Object.entries(modules)) {
    const sourcePath = path.join(tempSourceRoot, "src", file);
    const candidates = adjacentDeclarationPaths(sourcePath);
    const found = [];
    for (const candidate of candidates) {
      try {
        await readFile(candidate, "utf8");
        found.push(candidate);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    let contents = null;
    if (found.length > 0) contents = await readFile(found[0], "utf8");
    inspection[key] = {
      source: file,
      declarations: found,
      status: found.length === 0 ? "missing" : "present",
      contents,
      classKeys: contents ? [...contents.matchAll(/readonly ([A-Za-z0-9_$]+): string;/g)].map((match) => match[1]) : [],
      runtimeClassKeys: Object.keys(runtimeExports[key] ?? {}).sort(),
    };
  }
  return inspection;
}

function projectClassOnlyDeclaration(styles) {
  const lines = ["declare const styles: {"];
  for (const key of Object.keys(styles).sort()) {
    lines.push(`  readonly ${key}: ${JSON.stringify(styles[key])};`);
  }
  lines.push("};", "export default styles;", "");
  return lines.join("\n");
}

async function observeMutation({ label, watcher, target, write, messages, hmrEvents, loggerRecords }) {
  const beforeMessages = messages.length;
  const beforeHmrEvents = hmrEvents.length;
  const beforeWarnings = loggerRecords.length;
  const normalizedTarget = path.resolve(target);
  const eventPromise = waitForEventOrNull(
    watcher,
    "all",
    (event, file) => ["add", "change", "unlink"].includes(event) && path.resolve(file) === normalizedTarget,
  );
  await write();
  const event = await eventPromise;
  await wait(500);
  const hmrMessages = messages.slice(beforeMessages);
  const warnings = loggerRecords.slice(beforeWarnings);
  return {
    label,
    watcherEvent: event?.[0] ?? null,
    hmr: hmrMessages.map((message) => ({
      type: message.type,
      paths: message.updates?.map((update) => update.path) ?? [],
    })),
    handleHotUpdate: hmrEvents.slice(beforeHmrEvents),
    warnings,
  };
}

async function loadStyles(server, url) {
  const module = await server.ssrLoadModule(url);
  return module.default;
}

test("step3: Vite build/runtime/dev/HMR evidence for the parser spike", async () => {
  const evidence = {
    runtime: {
      node: process.version,
      vite: "8.2.1",
      packageManager: "pnpm 11.9.0",
    },
    build: {},
    dts: {},
    dev: {
      mutations: [],
      hmrConnection: "unverified",
      warnings: [],
    },
    animationValues: {},
    limitations: [
      "This runner does not create production files; all runtime edits are under scratch/.tmp-step3-runtime.",
      "A browser connector is not available in this task, so visual rendering and browser-side HMR are not verified.",
      "Vite 6/7 matrix is not run because only the repository-declared Vite 8.2.1 is installed; changing dependencies would exceed this isolated check.",
    ],
  };
  let server;
  let socket;
  try {
    const { configPath, cardPath } = await createTempFixture();
    const buildLogger = makeLogger();
    await rm(path.join(tempRoot, "dist"), { recursive: true, force: true });
    await build({
      root: tempRoot,
      configFile: configPath,
      logLevel: "silent",
      customLogger: buildLogger.logger,
    });
    const buildOutput = await readBuildOutput();
    evidence.build = {
      outputFiles: buildOutput.files,
      cssHas: {
        bemRoot: /\.p-card\b/.test(buildOutput.css),
        mixinClass: /\.p-card__from-mixin\b/.test(buildOutput.css),
        modifier: /\.p-card--compact\b/.test(buildOutput.css),
        globalClass: /\.utility\b/.test(buildOutput.css),
        globalId: /#fade\b/.test(buildOutput.css),
        globalKeyframes: /@keyframes fade/.test(buildOutput.css),
        staticAnimationName: /static-spin/.test(buildOutput.css),
        dynamicVarPreserved: /var\(--runtime-animation\)/.test(buildOutput.css),
        postcssOrderProbeAfterBem: /--postcss-order-probe\s*:\s*after-bem/.test(buildOutput.css),
        sourceBlockRemoved: !/@block/.test(buildOutput.css),
      },
      exports: buildOutput.exports,
      warnings: buildLogger.records,
    };
    assert.equal(buildOutput.exports.card.root, "p-card");
    assert.equal(buildOutput.exports.card.rootCompact, "p-card--compact");
    assert.equal(buildOutput.exports.card.fromMixin, undefined);
    assert.equal(buildOutput.exports.scss.fromMixin, "p-card__from-mixin");
    assert.equal(buildOutput.exports.plain.root.includes("p-card"), false);
    assert.equal(buildOutput.exports.card.utility, undefined);
    assert.equal(/--postcss-order-probe\s*:\s*after-bem/.test(buildOutput.css), true);
    assert.equal(/var\(--runtime-animation\)/.test(buildOutput.css), true);
    assert.equal(/global\(static-spin\)/.test(buildOutput.css), false, "Vite should lower global() marker in final CSS");
    assert.equal(/static-spin/.test(buildOutput.css), true);

    evidence.dts = await inspectAdjacentDeclarations(tempRoot, buildOutput.exports);
    assert.deepEqual(evidence.dts.card.classKeys, ["child", "dialog", "dynamic", "fade", "root", "rootCompact", "static"]);
    assert.deepEqual(evidence.dts.scss.classKeys, ["fromMixin", "fromMixinActive", "root"]);
    assert.deepEqual(evidence.dts.modal.classKeys, ["root"]);
    assert.equal(evidence.dts.plain.status, "missing");
    assert.equal(evidence.dts.protected.contents, "// hand-written declaration\nexport default {};\n");
    assert.doesNotMatch(evidence.dts.card.contents, /utility|animation|fadeAnimation/);
    for (const key of ["card", "scss", "modal"]) {
      assert.deepEqual(evidence.dts[key].classKeys, evidence.dts[key].runtimeClassKeys);
    }
    const projectedDts = {};
    for (const [key, styles] of Object.entries(buildOutput.exports)) {
      projectedDts[key] = projectClassOnlyDeclaration(styles);
    }
    evidence.dts.minimumProjection = {
      scope: "verification-only, not product implementation",
      classKeysAndValues: projectedDts,
      status: "runtime-to-class-only-projection-matches-by-construction",
    };

    const animationSource = `/* @block p-values */
.root {
  animation: 1s ease static-spin, 200ms var(--runtime-animation);
  animation-name: static-spin, var(--runtime-animation);
}
@keyframes static-spin { from { opacity: 0; } to { opacity: 1; } }
`;
    const animationResult = await postcss([createBemPostcssPlugin()]).process(animationSource, {
      from: path.join(tempRoot, "src", "animation-values.module.css"),
    });
    evidence.animationValues = {
      css: animationResult.css,
      staticIdentifierGlobalMarker: /global\(static-spin\)/.test(animationResult.css),
      dynamicFunctionUntouched: /var\(--runtime-animation\)/.test(animationResult.css),
      notes: [
        "Static identifiers are wrapped as global(name) for Vite CSS Modules value lowering.",
        "var(--runtime-animation) remains a function token and is not guessed as an animation name.",
      ],
    };
    assert.match(animationResult.css, /global\(static-spin\)/);
    assert.match(animationResult.css, /var\(--runtime-animation\)/);

    const serverLogger = makeLogger();
    globalThis.__step3HmrEvents = [];
    server = await createServer({
      root: tempRoot,
      configFile: configPath,
      logLevel: "silent",
      customLogger: serverLogger.logger,
      server: { port: 0, strictPort: false, hmr: true },
    });
    await server.listen();
    const bemParser = globalThis.__step3BemParser;
    const baseUrl = server.resolvedUrls?.local?.[0];
    assert.ok(baseUrl, "Vite dev server did not expose a local URL");
    const htmlResponse = await fetch(baseUrl);
    const html = await htmlResponse.text();
    assert.equal(htmlResponse.status, 200);
    assert.match(html, /src="\/src\/main\.js"/);

    const messages = [];
    try {
      const websocketUrl = baseUrl.replace(/^http/, "ws");
      socket = new WebSocket(websocketUrl);
      socket.addEventListener("message", (event) => {
        try {
          messages.push(JSON.parse(String(event.data)));
        } catch {
          messages.push({ type: "unparseable", data: String(event.data) });
        }
      });
      const connected = await waitForWebSocketOpen(socket);
      evidence.dev.hmrConnection = connected ? "connected" : "unverified: WebSocket did not open";
      if (!connected) socket.close();
    } catch (error) {
      evidence.dev.hmrConnection = `unverified: ${error.message}`;
    }

    const [cardStyles, scssStyles, plainStyles, modalStyles] = await Promise.all([
      loadStyles(server, "/src/Card.module.css"),
      loadStyles(server, "/src/Card.module.scss"),
      loadStyles(server, "/src/Plain.module.css"),
      loadStyles(server, "/src/Modal.module.css"),
    ]);
    const cardTransform = await server.transformRequest("/src/Card.module.css");
    assert.ok(cardTransform?.code);
    evidence.dev.initial = {
      cardStyles,
      scssStyles,
      plainStyles,
      modalStyles,
      cssTransformHasBem: /p-card/.test(cardTransform.code),
      plainModuleKeepsDefaultHash: plainStyles.root !== "root" && !plainStyles.root.includes("p-card"),
      globalClassNotExported: cardStyles.utility === undefined,
      warnings: [...serverLogger.records],
    };
    assert.equal(evidence.dev.initial.plainModuleKeepsDefaultHash, true);
    assert.equal(evidence.dev.initial.globalClassNotExported, true);

    const mixinPath = sourceFile(tempRoot, "mixins.scss");
    const mixinBefore = await readFile(mixinPath, "utf8");
    evidence.dev.mutations.push(await observeMutation({
      label: "Sass partial change updates transformed CSS and HMR",
      watcher: server.watcher,
      target: mixinPath,
      messages,
      hmrEvents: globalThis.__step3HmrEvents,
      loggerRecords: serverLogger.records,
      write: () => writeFile(mixinPath, mixinBefore.replace("padding: 4px", "padding: 12px")),
    }));
    const scssAfterPartial = await server.transformRequest("/src/Card.module.scss");
    const scssStylesAfterPartial = await loadStyles(server, "/src/Card.module.scss");
    evidence.dev.afterPartial = {
      cssTransformHasNewPadding: /padding:\s*12px/.test(scssAfterPartial?.code ?? ""),
      styles: scssStylesAfterPartial,
    };

    const cardBefore = await readFile(cardPath, "utf8");
    const cardWithNewElement = `${cardBefore}
.added-later {
  color: hotpink;
}
`;
    evidence.dev.mutations.push(await observeMutation({
      label: "CSS Module change updates CSS and JS import value",
      watcher: server.watcher,
      target: cardPath,
      messages,
      hmrEvents: globalThis.__step3HmrEvents,
      loggerRecords: serverLogger.records,
      write: () => writeFile(cardPath, cardWithNewElement),
    }));
    const cardAfterChange = await loadStyles(server, "/src/Card.module.css");
    const cardCssAfterChange = await server.transformRequest("/src/Card.module.css");
    evidence.dev.afterCardChange = {
      styles: cardAfterChange,
      cssHasNewElement: /p-card__added-later/.test(cardCssAfterChange?.code ?? ""),
      jsExportHasNewElement: cardAfterChange.addedLater === "p-card__added-later",
      dts: await readFile(`${cardPath}.d.ts`, "utf8"),
    };
    assert.equal(evidence.dev.afterCardChange.jsExportHasNewElement, true);
    assert.match(evidence.dev.afterCardChange.dts, /readonly addedLater: string;/);

    const modalPath = sourceFile(tempRoot, "Modal.module.css");
    const modalBefore = await readFile(modalPath, "utf8");
    const modalRenamed = modalBefore
      .replaceAll("animation-name: fade", "animation-name: modal-fade")
      .replaceAll("@keyframes fade", "@keyframes modal-fade");
    serverLogger.records.length = 0;
    const modalRenameObservation = await observeMutation({
      label: "Renaming a keyframes definition updates the dev warning state",
      watcher: server.watcher,
      target: modalPath,
      messages,
      hmrEvents: globalThis.__step3HmrEvents,
      loggerRecords: serverLogger.records,
      write: () => writeFile(modalPath, modalRenamed),
    });
    await server.transformRequest("/src/Modal.module.css");
    modalRenameObservation.warnings = [...serverLogger.records];
    evidence.dev.mutations.push(modalRenameObservation);
    evidence.dev.warnings.push({
      phase: "after-modal-rename",
      messages: [...serverLogger.records],
    });

    const addedPath = sourceFile(tempRoot, "Added.module.css");
    const mainPath = sourceFile(tempRoot, "main.js");
    const mainBefore = await readFile(mainPath, "utf8");
    const addedSource = `/* @block p-added */
.root { animation-name: modal-fade; }
@keyframes modal-fade { from { opacity: 0; } to { opacity: 1; } }
`;
    const mainWithAdded = mainBefore
      .replace('import modal from "./Modal.module.css";', 'import modal from "./Modal.module.css";\nimport added from "./Added.module.css";')
      .replace("modal }));", "modal, added }));");
    serverLogger.records.length = 0;
    const addFileObservation = await observeMutation({
      label: "Adding a CSS Module and importing it emits HMR",
      watcher: server.watcher,
      target: mainPath,
      messages,
      hmrEvents: globalThis.__step3HmrEvents,
      loggerRecords: serverLogger.records,
      write: async () => {
        await writeFile(addedPath, addedSource);
        await writeFile(mainPath, mainWithAdded);
      },
    });
    evidence.dev.mutations.push(addFileObservation);
    const addedStyles = await loadStyles(server, "/src/Added.module.css");
    evidence.dev.afterAdd = {
      styles: addedStyles,
      warningMessages: [...serverLogger.records],
      importedClassIsBEM: addedStyles.root === "p-added",
    };
    assert.equal(evidence.dev.afterAdd.importedClassIsBEM, true);

    const mainWithoutAdded = mainBefore;
    serverLogger.records.length = 0;
    evidence.dev.mutations.push(await observeMutation({
      label: "Removing the import then deleting the CSS Module emits invalidation",
      watcher: server.watcher,
      target: mainPath,
      messages,
      hmrEvents: globalThis.__step3HmrEvents,
      loggerRecords: serverLogger.records,
      write: () => writeFile(mainPath, mainWithoutAdded),
    }));
    evidence.dev.afterImportRemoval = {
      generatedDtsStillPresentUntilSourceUnlink: await declarationExists(addedPath),
    };
    const addedUnlinkObservation = await observeMutation({
      label: "Deleting the CSS Module removes the file from the watched graph",
      watcher: server.watcher,
      target: addedPath,
      messages,
      hmrEvents: globalThis.__step3HmrEvents,
      loggerRecords: serverLogger.records,
      write: () => rm(addedPath, { force: true }),
    });
    evidence.dev.mutations.push(addedUnlinkObservation);
    evidence.dev.afterSourceUnlink = {
      dtsExists: await declarationExists(addedPath),
      registryFilesForRemovedName: [...bemParser.keyframesRegistry.nameToFiles.values()].some((files) => files.has(addedPath)),
    };
    assert.equal(evidence.dev.afterImportRemoval.generatedDtsStillPresentUntilSourceUnlink, true);
    assert.equal(evidence.dev.afterSourceUnlink.dtsExists, false);
    assert.equal(evidence.dev.afterSourceUnlink.registryFilesForRemovedName, false);

    const modalRemoved = modalRenamed
      .replace("animation-name: modal-fade", "animation-name: modal-replacement")
      .replace(
        /\n@keyframes modal-fade \{\n  from \{ opacity: 1; \}\n  to \{ opacity: 0; \}\n\}\n?/,
        "\n",
      );
    serverLogger.records.length = 0;
    const modalRemovalObservation = await observeMutation({
      label: "Removing a keyframes name tests warning retraction",
      watcher: server.watcher,
      target: modalPath,
      messages,
      hmrEvents: globalThis.__step3HmrEvents,
      loggerRecords: serverLogger.records,
      write: () => writeFile(modalPath, modalRemoved),
    });
    const modalAfterRemoval = await server.transformRequest("/src/Modal.module.css");
    modalRemovalObservation.warnings = [...serverLogger.records];
    evidence.dev.mutations.push(modalRemovalObservation);
    evidence.dev.warnings.push({
      phase: "after-modal-keyframes-removal",
      messages: modalRemovalObservation.warnings,
      interpretation: "The bidirectional registry replaces the Modal.module.css set, so the removed name has no stale registration.",
    });
    evidence.dev.afterKeyframesRemoval = {
      cssNoLongerContainsRemovedName: !/modal-fade/.test(modalAfterRemoval?.code ?? ""),
      cssTransform: modalAfterRemoval?.code ?? null,
    };
    const cardWithFormerModalName = `${await readFile(cardPath, "utf8")}
@keyframes modal-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}
`;
    serverLogger.records.length = 0;
    const staleRegistrationObservation = await observeMutation({
      label: "Reprocessing a former keyframes name confirms stale registration is gone",
      watcher: server.watcher,
      target: cardPath,
      messages,
      hmrEvents: globalThis.__step3HmrEvents,
      loggerRecords: serverLogger.records,
      write: () => writeFile(cardPath, cardWithFormerModalName),
    });
    await loadStyles(server, "/src/Card.module.css");
    staleRegistrationObservation.warnings = [...serverLogger.records];
    evidence.dev.mutations.push(staleRegistrationObservation);
    evidence.dev.warnings.push({
      phase: "after-reprocess-using-removed-name",
      messages: staleRegistrationObservation.warnings,
      interpretation: "No stale duplicate warning is expected after Modal.module.css replacement; registry state is file-scoped and replaceable.",
    });
    const modalWithoutBlock = modalRemoved.replace("/* @block p-modal */\n", "");
    evidence.dev.mutations.push(await observeMutation({
      label: "Removing @block removes an owned declaration",
      watcher: server.watcher,
      target: modalPath,
      messages,
      hmrEvents: globalThis.__step3HmrEvents,
      loggerRecords: serverLogger.records,
      write: () => writeFile(modalPath, modalWithoutBlock),
    }));
    await server.transformRequest("/src/Modal.module.css");
    evidence.dev.afterBlockRemoval = {
      dtsExists: await declarationExists(modalPath),
    };
    assert.equal(evidence.dev.afterBlockRemoval.dtsExists, false);
    evidence.dev.hmrMessages = messages;
    evidence.dev.warnings.push({
      phase: "all-server-warnings",
      messages: [...serverLogger.records],
    });
  } finally {
    if (socket) socket.close();
    if (server) await server.close();
    await writeFile(resultsPath, `${JSON.stringify(evidence, null, 2)}\n`);
    await rm(tempRoot, { recursive: true, force: true });
  }
});
