import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import {
  createBemCompanionPlugin,
  createBemPostcssPlugin,
} from "./parser-plugin.mjs";
import { KeyframesRegistry } from "./keyframes-registry.mjs";

const spikeRoot = path.dirname(fileURLToPath(import.meta.url));
const sourceFixtureRoot = path.join(spikeRoot, "fixture");
const hmrVariant = process.env.BEM_HMR_VARIANT || "full";
const acceptMode = process.env.BEM_HMR_ACCEPT || "literal";
const useBem = hmrVariant !== "plain";
const useDts = useBem && hmrVariant !== "no-dts";
const useCompanion = useBem && hmrVariant !== "no-companion";
const useKeyframesRegistry = useBem && hmrVariant !== "no-registry";
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "bem-browser-hmr-"));
const sourceRoot = path.join(tempRoot, "src");
const cardCssPath = path.join(sourceRoot, "Card.module.css");
const modalCssPath = path.join(sourceRoot, "Modal.module.css");
const mixinsPath = path.join(sourceRoot, "mixins.scss");
const warningHistory = [];
const keyframesRegistry = new KeyframesRegistry();
let observedKeyframesRegistry = keyframesRegistry;
const hmrEvents = [];

const browserEntry = `
import cardInitial from "./Card.module.css";
import scssInitial from "./Card.module.scss";
import plainInitial from "./Plain.module.css";
import modalInitial from "./Modal.module.css";

const storageKey = "bem-browser-runtime";
const stored = JSON.parse(sessionStorage.getItem(storageKey) || "{}");
const documentNonce = window.__bemDocumentNonce || (window.__bemDocumentNonce = crypto.randomUUID());
const evaluationCount = (window.__bemEntryEvaluationCount || 0) + 1;
window.__bemEntryEvaluationCount = evaluationCount;
const navigation = performance.getEntriesByType("navigation")[0];
const lifecycle = {
  ...(stored.lifecycle || {}),
  beforeunload: stored.lifecycle?.beforeunload || 0,
  pagehide: stored.lifecycle?.pagehide || 0,
};
const runtime = {
  variant: "${hmrVariant}",
  acceptMode: "${acceptMode}",
  loadCount: (stored.loadCount || 0) + 1,
  documentNonce,
  previousDocumentNonce: stored.documentNonce || null,
  timeOrigin: performance.timeOrigin,
  navigation: navigation ? {
    type: navigation.type,
    startTime: navigation.startTime,
    activationStart: navigation.activationStart,
    redirectCount: navigation.redirectCount,
  } : null,
  evaluationCount,
  lifecycle,
  hmrPayloads: stored.hmrPayloads || [],
  acceptCallbacks: stored.acceptCallbacks || [],
  hmrUpdates: stored.hmrUpdates || [],
  fullReloadEvents: stored.fullReloadEvents || [],
};
const domNodes = {};

function persist() {
  const { domNodes: _domNodes, ...persisted } = runtime;
  sessionStorage.setItem(storageKey, JSON.stringify(persisted));
}

function recordLifecycle(name) {
  runtime.lifecycle[name] += 1;
  persist();
}

window.addEventListener("beforeunload", () => recordLifecycle("beforeunload"));
window.addEventListener("pagehide", () => recordLifecycle("pagehide"));

let card = cardInitial;
let scss = scssInitial;
let plain = plainInitial;
let modal = modalInitial;

function compactPayload(payload) {
  if (!payload || typeof payload !== "object") return payload;
  return {
    type: payload.type,
    path: payload.path,
    paths: payload.paths,
    acceptedPath: payload.acceptedPath,
    updates: payload.updates?.map((update) => ({
      type: update.type,
      path: update.path,
      acceptedPath: update.acceptedPath,
      timestamp: update.timestamp,
    })),
    err: payload.err ? { message: payload.err.message, stack: payload.err.stack } : undefined,
  };
}

function recordHmrPayload(type, payload) {
  runtime.hmrPayloads.push({ type, payload: compactPayload(payload), documentNonce, evaluationCount });
  runtime.hmrPayloads = runtime.hmrPayloads.slice(-100);
  persist();
}

function mapSnapshot(value) {
  return Object.fromEntries(Object.entries(value || {}).sort(([a], [b]) => a.localeCompare(b)));
}

function snapshot() {
  return {
    loadCount: runtime.loadCount,
    documentNonce: runtime.documentNonce,
    previousDocumentNonce: runtime.previousDocumentNonce,
    timeOrigin: runtime.timeOrigin,
    navigation: runtime.navigation,
    evaluationCount: runtime.evaluationCount,
    lifecycle: { ...runtime.lifecycle },
    hmrPayloads: [...runtime.hmrPayloads],
    acceptCallbacks: [...runtime.acceptCallbacks],
    hmrUpdates: [...runtime.hmrUpdates],
    fullReloadEvents: [...runtime.fullReloadEvents],
    domIdentity: Object.fromEntries(Object.entries(domNodes).map(([id, node]) => [
      id,
      node === document.getElementById(id),
    ])),
    exports: {
      card: mapSnapshot(card),
      scss: mapSnapshot(scss),
      plain: mapSnapshot(plain),
      modal: mapSnapshot(modal),
    },
  };
}

function setClass(id, value) {
  document.getElementById(id).className = value || "";
}

function render() {
  if (Object.keys(domNodes).length === 0) {
    Object.assign(domNodes, Object.fromEntries(
      ["card-root", "card-dialog", "card-badge", "scss-root", "scss-from-mixin", "scss-from-mixin-hot", "modal-root", "plain-root"]
        .map((id) => [id, document.getElementById(id)]),
    ));
  }
  setClass("card-root", card.root);
  setClass("card-dialog", card.panel || card.dialog);
  setClass("card-badge", card.badge);
  setClass("scss-root", scss.root);
  setClass("scss-from-mixin", scss.fromMixin || scss["from-mixin"]);
  setClass("scss-from-mixin-hot", scss.fromMixinHot || scss["from-mixin--hot"]);
  setClass("modal-root", modal.root);
  setClass("plain-root", plain.root);
  const state = snapshot();
  document.body.dataset.loadCount = String(state.loadCount);
  document.body.dataset.hmrCount = String(state.hmrUpdates.length);
  document.getElementById("runtime-state").textContent = JSON.stringify(state);
  window.__fixture = { snapshot };
  persist();
}

function handleAccepted(name, assign, module) {
  if (!module) return;
  assign(module.default || module);
  runtime.acceptCallbacks.push({
    name,
    keys: Object.keys(module.default || module).sort(),
    documentNonce,
    evaluationCount,
  });
  runtime.acceptCallbacks = runtime.acceptCallbacks.slice(-100);
  runtime.hmrUpdates.push(name);
  render();
  persist();
}

function accept(name, assign) {
  if (!import.meta.hot || "${acceptMode}" === "none" || "${acceptMode}" === "self" || "${acceptMode}" === "literal") return;
  import.meta.hot.accept(name, (module) => handleAccepted(name, assign, module));
}

if (import.meta.hot) {
  if ("${acceptMode}" === "self") {
    import.meta.hot.accept(() => {
      runtime.acceptCallbacks.push({ name: "<self>", documentNonce, evaluationCount });
      runtime.hmrUpdates.push("<self>");
      render();
      persist();
    });
  }
  for (const eventName of ["vite:beforeUpdate", "vite:afterUpdate", "vite:beforeFullReload", "vite:error", "vite:invalidate"]) {
    import.meta.hot.on(eventName, (event) => {
      recordHmrPayload(eventName, event);
      if (eventName === "vite:beforeFullReload") {
        runtime.fullReloadEvents.push(event?.path || "<unknown>");
        persist();
      }
    });
  }
  if ("${acceptMode}" === "literal") {
    import.meta.hot.accept("./Card.module.css", (module) => handleAccepted("./Card.module.css", (value) => { card = value; }, module));
    import.meta.hot.accept("./Card.module.scss", (module) => handleAccepted("./Card.module.scss", (value) => { scss = value; }, module));
    import.meta.hot.accept("./Plain.module.css", (module) => handleAccepted("./Plain.module.css", (value) => { plain = value; }, module));
    import.meta.hot.accept("./Modal.module.css", (module) => handleAccepted("./Modal.module.css", (value) => { modal = value; }, module));
  }
}

accept("./Card.module.css", (value) => { card = value; });
accept("./Card.module.scss", (value) => { scss = value; });
accept("./Plain.module.css", (value) => { plain = value; });
accept("./Modal.module.css", (value) => { modal = value; });
  render();
`;

const initialHtml = `<!doctype html>
<html>
  <body>
    <main id="fixture">
      <div id="card-root"><span id="card-dialog"></span><span id="card-badge"></span></div>
      <div id="scss-root"><span id="scss-from-mixin"></span><span id="scss-from-mixin-hot"></span></div>
      <div id="modal-root"></div>
      <div id="plain-root"></div>
      <pre id="runtime-state"></pre>
    </main>
    <script type="module" src="/src/main.js"></script>
  </body>
</html>
`;

const classPhaseCss = `/* @block p-card */
.root {
  color: rgb(12, 34, 56);
  animation: 200ms ease fade;
  animation-name: slide, fade;
}

.root--compact { color: red; }
.badge { background-color: rgb(40, 50, 60); }
.panel { color: rgb(10, 20, 30); }
.fade { color: purple; }
:global(.utility) .child { display: block; }
#fade { color: blue; }
@keyframes fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes slide { from { transform: translateX(0); } to { transform: translateX(1px); } }
`;

const initialModalCss = `/* @block p-modal */
.root {
  animation-name: fade;
  animation-duration: 0s;
}

@keyframes fade {
  from { opacity: 1; }
  to { opacity: 0; }
}
`;

const renamedModalCss = `/* @block p-modal */
.root {
  animation-name: modal-fade;
  animation-duration: 0s;
}

@keyframes modal-fade {
  from { opacity: 1; }
  to { opacity: 0; }
}
`;

const changedModalCss = `/* @block p-modal */
.root {
  animation-name: modal-fade;
  animation-duration: 0s;
}

@keyframes modal-fade {
  from { opacity: 0.25; }
  to { opacity: 0.75; }
}
`;

const deletedModalCss = `/* @block p-modal */
.root {
  animation-name: modal-fade;
  animation-duration: 0s;
}
`;

const deletedBlockModalCss = `.root {
  animation-name: modal-fade;
  animation-duration: 0s;
}
`;

const updatedMixinsScss = `@mixin card-parts {
  .from-mixin {
    padding: 24px;
  }

  .from-mixin--hot {
    padding: 16px;
  }
}
`;

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function waitFor(predicate, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

function json(res, status, value) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(value));
}

async function readOrNull(file) {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function declarationSnapshot() {
  const files = [
    "Card.module.css",
    "Card.module.scss",
    "Modal.module.css",
    "Plain.module.css",
    "Disposable.module.css",
    "Manual.module.css",
  ];
  return Object.fromEntries(await Promise.all(files.map(async (file) => [
    file,
    await readOrNull(path.join(sourceRoot, `${file}.d.ts`)),
  ])));
}

function registrySnapshot() {
  if (!observedKeyframesRegistry) {
    return { fileToNames: {}, nameToFiles: {}, conflicts: [] };
  }
  return {
    fileToNames: Object.fromEntries(
      [...observedKeyframesRegistry.fileToNames.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([file, names]) => [path.relative(sourceRoot, file), [...names].sort()]),
    ),
    nameToFiles: Object.fromEntries(
      [...observedKeyframesRegistry.nameToFiles.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, files]) => [name, [...files].map((file) => path.relative(sourceRoot, file)).sort()]),
    ),
    conflicts: observedKeyframesRegistry.conflicts().map(({ name, files }) => ({
      name,
      files: files.map((file) => path.relative(sourceRoot, file)).sort(),
    })),
  };
}

async function stateSnapshot() {
  return {
    variant: hmrVariant,
    acceptMode,
    hmrEvents: [...hmrEvents],
    registry: registrySnapshot(),
    warnings: warningHistory.slice(-20),
    declarations: await declarationSnapshot(),
  };
}

async function processDevModule(server, file) {
  await server.transformRequest(`/src/${file}`);
  await waitFor(async () => (await exists(path.join(sourceRoot, `${file}.d.ts`))) || file === "Plain.module.css");
}

let server;
let shuttingDown = false;

const bemPlugin = useBem
  ? createBemPostcssPlugin({
    dts: useDts,
    keyframes: useKeyframesRegistry ? { registry: keyframesRegistry } : false,
  })
  : null;
if (bemPlugin) observedKeyframesRegistry = bemPlugin.keyframesRegistry;

const warningProbe = {
  postcssPlugin: "browser-warning-probe",
  OnceExit(_root, { result }) {
    const from = result.opts.from || "<unknown>";
    const messages = result.warnings()
      .filter((warning) => /duplicate global keyframes/.test(warning.text))
      .map((warning) => warning.text);
    warningHistory.push({ file: path.relative(sourceRoot, from), messages });
  },
};

const hmrProbe = {
  name: "browser-hmr-probe",
  handleHotUpdate(context) {
    hmrEvents.push({
      file: path.relative(sourceRoot, context.file),
      modules: context.modules.map((module) => ({
        url: module.url,
        id: module.id,
        type: module.type,
      })),
    });
  },
};

const harnessPlugin = {
  name: "browser-hmr-harness",
  configureServer(devServer) {
    devServer.middlewares.use(async (req, res, next) => {
      const requestUrl = new URL(req.url || "/", "http://127.0.0.1");
      if (!requestUrl.pathname.startsWith("/__harness__/")) {
        next();
        return;
      }

      try {
        switch (requestUrl.pathname) {
          case "/__harness__/state":
            json(res, 200, await stateSnapshot());
            return;
          case "/__harness__/phase/class":
            await writeFile(cardCssPath, classPhaseCss);
            json(res, 200, { phase: "class", state: await stateSnapshot() });
            return;
          case "/__harness__/phase/sass":
            await writeFile(mixinsPath, updatedMixinsScss);
            json(res, 200, { phase: "sass", state: await stateSnapshot() });
            return;
          case "/__harness__/phase/keyframes-rename":
            await writeFile(modalCssPath, renamedModalCss);
            json(res, 200, { phase: "keyframes-rename", state: await stateSnapshot() });
            return;
          case "/__harness__/phase/keyframes-content":
            await writeFile(modalCssPath, changedModalCss);
            json(res, 200, { phase: "keyframes-content", state: await stateSnapshot() });
            return;
          case "/__harness__/phase/keyframes-delete":
            await writeFile(cardCssPath, `${classPhaseCss}\n@keyframes modal-fade { from { opacity: 0.4; } to { opacity: 0.6; } }\n`);
            await writeFile(modalCssPath, deletedModalCss);
            json(res, 200, { phase: "keyframes-delete", state: await stateSnapshot() });
            return;
          case "/__harness__/phase/dts-block-delete":
            await writeFile(modalCssPath, deletedBlockModalCss);
            json(res, 200, { phase: "dts-block-delete", state: await stateSnapshot() });
            return;
          case "/__harness__/phase/dts-unlink": {
            await writeFile(modalCssPath, initialModalCss);
            await processDevModule(devServer, "Modal.module.css");
            const beforeUnlink = await readOrNull(`${modalCssPath}.d.ts`);
            await unlink(modalCssPath);
            const removed = await waitFor(async () => !(await exists(`${modalCssPath}.d.ts`)), 4000);
            json(res, 200, {
              phase: "dts-unlink",
              beforeUnlink,
              removed,
              state: await stateSnapshot(),
            });
            return;
          }
          case "/__harness__/phase/dts-manual": {
            const manualPath = path.join(sourceRoot, "Manual.module.css");
            const manualDeclaration = "// hand-written declaration\nexport default { manual: \"manual\" };\n";
            await writeFile(manualPath, "/* @block p-manual */\n.manual { color: red; }\n");
            await writeFile(`${manualPath}.d.ts`, manualDeclaration);
            await processDevModule(devServer, "Manual.module.css");
            json(res, 200, {
              phase: "dts-manual",
              declaration: await readOrNull(`${manualPath}.d.ts`),
              state: await stateSnapshot(),
            });
            return;
          }
          default:
            json(res, 404, { error: "unknown harness endpoint" });
        }
      } catch (error) {
        json(res, 500, { error: error instanceof Error ? error.stack : String(error) });
      }
    });
  },
};

try {
  await cp(sourceFixtureRoot, tempRoot, { recursive: true });
  await mkdir(sourceRoot, { recursive: true });
  for (const file of await readdir(sourceRoot)) {
    if (file.endsWith(".d.ts")) await unlink(path.join(sourceRoot, file));
  }
  await writeFile(path.join(tempRoot, "index.html"), initialHtml);
  await writeFile(path.join(sourceRoot, "main.js"), browserEntry);
  await writeFile(modalCssPath, initialModalCss);

  server = await createServer({
    root: tempRoot,
    configFile: false,
    plugins: [
      hmrProbe,
      ...(useCompanion ? [createBemCompanionPlugin({ keyframesRegistry: observedKeyframesRegistry, dts: useDts })] : []),
      harnessPlugin,
    ],
    css: {
      modules: { exportGlobals: false },
      postcss: { plugins: [bemPlugin, warningProbe].filter(Boolean) },
    },
    server: { host: "127.0.0.1", port: 0, strictPort: false },
    logLevel: "warn",
  });
  await server.listen();
  const address = server.httpServer.address();
  const port = typeof address === "object" && address ? address.port : null;
  if (!port) throw new Error("Vite server did not expose a port");
  console.log(JSON.stringify({
    url: `http://127.0.0.1:${port}/`,
    root: tempRoot,
    control: `http://127.0.0.1:${port}/__harness__/state`,
  }));

  const stop = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    await server.close();
    await rm(tempRoot, { recursive: true, force: true });
  };
  process.once("SIGINT", () => { void stop().finally(() => process.exit(0)); });
  process.once("SIGTERM", () => { void stop().finally(() => process.exit(0)); });
} catch (error) {
  await rm(tempRoot, { recursive: true, force: true });
  throw error;
}
