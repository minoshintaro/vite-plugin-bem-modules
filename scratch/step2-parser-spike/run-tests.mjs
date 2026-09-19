import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import postcss from "postcss";
import { build } from "vite";
import { createBemPostcssPlugin } from "./parser-plugin.mjs";

const spikeRoot = path.dirname(new URL(import.meta.url).pathname);
const fixtureRoot = path.join(spikeRoot, "fixture");
const distRoot = path.join(fixtureRoot, "dist");

test("構文解析でBEM class、ID、keyframes、animation参照を別々にglobal化する", async () => {
  const source = `/* @block p-card */
.root { animation: 200ms ease fade; animation-name: slide, fade; }
.fade { color: red; }
:global(.utility) .child { display: block; }
#fade { color: blue; }
@keyframes fade { from { opacity: 0; } to { opacity: 1; } }
`;

  const result = await postcss([createBemPostcssPlugin()]).process(source, {
    from: path.join(fixtureRoot, "synthetic.module.css"),
  });

  assert.match(result.css, /:global\(\.p-card\)/);
  assert.match(result.css, /:global\(\.p-card__fade\)/);
  assert.match(result.css, /:global\(\.utility\) :global\(\.p-card__child\)/);
  assert.match(result.css, /:global\(#fade\)/);
  assert.match(result.css, /@keyframes :global\(fade\)/);
  assert.match(result.css, /animation: 200ms ease global\(fade\)/);
  assert.match(result.css, /animation-name: global\(slide\), global\(fade\)/);
  assert.match(result.css, /root: p-card/);
  assert.match(result.css, /fade: p-card__fade/);
  assert.doesNotMatch(result.css, /utility: p-card/);
});

test("@blockなしのmoduleはpluginが変更しない", async () => {
  const source = ".root { animation: fade 1s; }";
  const result = await postcss([createBemPostcssPlugin()]).process(source, {
    from: path.join(fixtureRoot, "plain.module.css"),
  });
  assert.equal(result.css, source);
});

test("PostCSS配列順で後段pluginが変換後のASTを観測する", async () => {
  const source = "/* @block p-order */ .root {}";
  const seen = [];
  const observer = {
    postcssPlugin: "order-observer",
    Once(root) {
      seen.push(root.toString().includes(":global(.p-order)") ? "bem" : "source");
    },
  };

  await postcss([createBemPostcssPlugin(), observer]).process(source, {
    from: path.join(fixtureRoot, "order.module.css"),
  });
  await postcss([observer, createBemPostcssPlugin()]).process(source, {
    from: path.join(fixtureRoot, "order-reversed.module.css"),
  });

  assert.deepEqual(seen, ["bem", "source"]);
});

test("ViteのSass/PostCSS/CSS Modulesに委譲したfixtureでCSSとJS exportが一致する", async () => {
  await rm(distRoot, { recursive: true, force: true });
  await build({ root: fixtureRoot, configFile: path.join(fixtureRoot, "vite.config.mjs") });

  const cssFiles = (await readdir(distRoot)).filter((file) => file.endsWith(".css"));
  const jsFiles = (await readdir(distRoot)).filter((file) => file.endsWith(".js"));
  assert.equal(cssFiles.length, 1);
  assert.equal(jsFiles.length, 1);

  const css = await readFile(path.join(distRoot, cssFiles[0]), "utf8");
  const jsPath = path.join(distRoot, jsFiles[0]);
  const js = await readFile(jsPath, "utf8");
  const runtimeOutput = execFileSync(process.execPath, [jsPath], { encoding: "utf8" });
  const exportsLine = runtimeOutput.trim().split("\n").find((line) => line.startsWith("EXPORTS "));
  assert.ok(exportsLine, runtimeOutput);
  const exports = JSON.parse(exportsLine.slice("EXPORTS ".length));

  assert.match(css, /\.p-card\b/);
  assert.match(css, /\.p-card__from-mixin\b/);
  assert.match(css, /\.p-card--compact\b/);
  assert.match(css, /\.utility\b/);
  assert.match(css, /#fade\b/);
  assert.match(css, /@keyframes fade/);
  assert.match(css, /animation(?:-name)?:[^;]*fade/);
  assert.doesNotMatch(css, /@block/);
  assert.match(js, /p-card/);

  assert.equal(exports.card.root, "p-card");
  assert.equal(exports.card.rootCompact, "p-card--compact");
  assert.equal(exports.card.fade, "p-card__fade");
  assert.equal(exports.card.child, "p-card__child");
  assert.equal(exports.card.dialog, "p-card__dialog");
  assert.equal(exports.scss.fromMixin, "p-card__from-mixin");
  assert.equal(exports.scss.fromMixinActive, "p-card__from-mixin--active");
  assert.notEqual(exports.plain.root, "root");
  assert.equal(exports.plain.root.includes("p-card"), false);
  assert.equal(exports.card.utility, undefined);
  assert.equal(exports.card.fadeAnimation, undefined);
});
