#!/usr/bin/env node
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer } from "vite";
import bemModules, { createBemPostcssPlugin } from "../dist/index.js";

const root = await mkdtemp(path.join(os.tmpdir(), "vite-plugin-bem-browser-hmr-"));
const sourceRoot = path.join(root, "src");
const files = {
  card: path.join(sourceRoot, "Card.module.css"),
  scss: path.join(sourceRoot, "Card.module.scss"),
  mixins: path.join(sourceRoot, "_mixins.scss"),
  animation: path.join(sourceRoot, "Animation.module.css"),
};

const entry = `
import cardInitial from "./Card.module.css";
import scssInitial from "./Card.module.scss";
import animationInitial from "./Animation.module.css";

const storageKey = "vite-plugin-bem-browser-hmr";
const previous = JSON.parse(sessionStorage.getItem(storageKey) || "{}");
const runtime = {
  loadCount: (previous.loadCount || 0) + 1,
  documentNonce: previous.documentNonce || crypto.randomUUID(),
  hmrUpdates: previous.hmrUpdates || [],
};
let card = cardInitial;
let scss = scssInitial;
let animation = animationInitial;
const nodes = Object.fromEntries([
  "card-root", "card-panel", "scss-root", "scss-badge", "animation-root", "state",
].map((id) => [id, document.getElementById(id)]));

function snapshot() {
  return {
    loadCount: runtime.loadCount,
    documentNonce: runtime.documentNonce,
    hmrUpdates: [...runtime.hmrUpdates],
    exports: {
      card: { ...card },
      scss: { ...scss },
      animation: { ...animation },
    },
    dom: Object.fromEntries(Object.entries(nodes).map(([id, node]) => [id, node?.className || ""])),
  };
}

function render() {
  nodes["card-root"].className = card.root || "";
  nodes["card-panel"].className = card.panel || card.dialog || "";
  nodes["scss-root"].className = scss.root || "";
  nodes["scss-badge"].className = scss.badge || scss.fromMixin || "";
  nodes["animation-root"].className = animation.root || "";
  const current = snapshot();
  document.body.dataset.loadCount = String(current.loadCount);
  nodes.state.textContent = JSON.stringify(current);
  window.__bemHmr = { snapshot };
  sessionStorage.setItem(storageKey, JSON.stringify({
    loadCount: current.loadCount,
    documentNonce: current.documentNonce,
    hmrUpdates: current.hmrUpdates,
  }));
}

function update(name, assign, module) {
  assign(module.default || module);
  runtime.hmrUpdates.push(name);
  render();
}

if (import.meta.hot) {
  import.meta.hot.accept("./Card.module.css", (module) => {
    update("./Card.module.css", (value) => { card = value; }, module);
  });
  import.meta.hot.accept("./Card.module.scss", (module) => {
    update("./Card.module.scss", (value) => { scss = value; }, module);
  });
  import.meta.hot.accept("./Animation.module.css", (module) => {
    update("./Animation.module.css", (value) => { animation = value; }, module);
  });
}
render();
`;

const html = `<!doctype html>
<html><body>
  <main>
    <button id="class-phase">class update</button>
    <button id="sass-phase">Sass partial update</button>
    <button id="keyframes-phase">keyframes update</button>
    <div id="card-root"><span id="card-panel"></span></div>
    <div id="scss-root"><span id="scss-badge"></span></div>
    <div id="animation-root"></div>
    <pre id="state"></pre>
  </main>
  <script>
    for (const [id, phase] of [["class-phase", "class"], ["sass-phase", "sass"], ["keyframes-phase", "keyframes"]]) {
      document.getElementById(id).addEventListener("click", () => fetch("/__hmr__/" + phase));
    }
  </script>
  <script type="module" src="/src/main.js"></script>
</body></html>`;

const classPhase = `/* @block p-card */
.root { color: rgb(12, 34, 56); }
.panel { color: rgb(10, 20, 30); }
`;
const initialCard = `/* @block p-card */
.root { color: red; }
.dialog { color: blue; }
`;
const initialScss = `/* @block p-scss */
@use "./mixins" as *;
.root { padding: 4px; }
@include badge;
`;
const initialMixins = `@mixin badge { .badge { color: rgb(1, 2, 3); } }\n`;
const sassPhase = `@mixin badge {
  .badge { color: rgb(4, 5, 6); }
  .hot { color: rgb(7, 8, 9); }
}
`;
const initialAnimation = `/* @block p-animation */
.root { animation: fade 1s linear; }
@keyframes fade { from { opacity: 0; } to { opacity: 1; } }
`;
const keyframesPhase = `/* @block p-animation */
.root { animation: fade-next 1s linear; }
@keyframes fade-next { from { opacity: .2; } to { opacity: .8; } }
`;

async function waitForDts(filePath, expected, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await readFile(filePath, "utf8")).includes(expected)) return true;
    } catch {
      // The first browser request may not have processed the module yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

let server;
let stopping = false;
const harness = {
  name: "vite-plugin-bem-browser-hmr-harness",
  configureServer(devServer) {
    devServer.middlewares.use(async (req, res, next) => {
      const pathname = new URL(req.url || "/", "http://127.0.0.1").pathname;
      const respond = (value) => {
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify(value));
      };
      try {
        if (pathname === "/__hmr__/class") {
          await writeFile(files.card, classPhase);
          respond({ phase: "class", css: await readFile(files.card, "utf8") });
          return;
        }
        if (pathname === "/__hmr__/sass") {
          await writeFile(files.mixins, sassPhase);
          respond({ phase: "sass", processed: await waitForDts(`${files.scss}.d.ts`, '"hot"') });
          return;
        }
        if (pathname === "/__hmr__/keyframes") {
          await writeFile(files.animation, keyframesPhase);
          respond({ phase: "keyframes", css: await readFile(files.animation, "utf8") });
          return;
        }
        if (pathname === "/__hmr__/state") {
          respond({
            declarations: Object.fromEntries(await Promise.all(Object.entries(files).map(async ([name, file]) => {
              const declaration = `${file}.d.ts`;
              try { return [name, await readFile(declaration, "utf8")]; }
              catch { return [name, null]; }
            }))),
          });
          return;
        }
        next();
      } catch (error) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: error instanceof Error ? error.stack : String(error) }));
      }
    });
  },
};

try {
  await mkdir(sourceRoot, { recursive: true });
  await writeFile(path.join(root, "index.html"), html);
  await writeFile(path.join(sourceRoot, "main.js"), entry);
  await writeFile(files.card, initialCard);
  await writeFile(files.scss, initialScss);
  await writeFile(files.mixins, initialMixins);
  await writeFile(files.animation, initialAnimation);

  server = await createServer({
    root,
    configFile: false,
    logLevel: "warn",
    plugins: [bemModules({ types: true }), harness],
    css: { postcss: { plugins: [createBemPostcssPlugin({ types: true })] } },
    server: { host: "127.0.0.1", port: 0, strictPort: false },
  });
  await server.listen();
  const address = server.httpServer.address();
  const port = typeof address === "object" && address ? address.port : null;
  if (!port) throw new Error("Vite server did not expose a port");
  console.log(JSON.stringify({
    url: `http://127.0.0.1:${port}/`,
    viewport: { width: 1280, height: 800 },
    phases: ["class", "sass", "keyframes"].map((phase) => `http://127.0.0.1:${port}/__hmr__/${phase}`),
    state: `http://127.0.0.1:${port}/__hmr__/state`,
    root,
  }));
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await server.close();
    await rm(root, { recursive: true, force: true });
  };
  process.once("SIGINT", () => void stop().finally(() => process.exit(0)));
  process.once("SIGTERM", () => void stop().finally(() => process.exit(0)));
} catch (error) {
  await rm(root, { recursive: true, force: true });
  throw error;
}
