import path from "node:path";
import postcss from "postcss";
import selectorParser from "postcss-selector-parser";
import { globalizeAnimationValue } from "./animation-value-parser.mjs";
import {
  isCssModulePath,
  removeOwnedDeclaration,
  writeClassDeclaration,
} from "./class-map-dts.mjs";
import { KeyframesRegistry } from "./keyframes-registry.mjs";

const BLOCK_COMMENT = /^\s*@block\s+(.+?)\s*$/;
const KEYFRAMES_AT_RULE = /(?:^|-)keyframes$/i;

function classSelector(value) {
  const node = selectorParser.className({ value: "" });
  node.value = value;
  return node;
}

function idSelector(value) {
  const node = selectorParser.id({ value: "" });
  node.value = value;
  return node;
}

function globalSelector(node) {
  return selectorParser.pseudo({
    value: ":global",
    nodes: [selectorParser.selector({ value: "", nodes: [node] })],
  });
}

function isSelectorContainer(node) {
  return Array.isArray(node.nodes);
}

function toExportKey(sourceName) {
  return sourceName
    .replace(/[-_]+([A-Za-z0-9])/g, (_, character) => character.toUpperCase())
    .replace(/[^A-Za-z0-9_$]/g, "");
}

function outputName(block, sourceName) {
  const modifierIndex = sourceName.indexOf("--");
  const baseName = modifierIndex === -1 ? sourceName : sourceName.slice(0, modifierIndex);
  const modifierName = modifierIndex === -1 ? null : sourceName.slice(modifierIndex + 2);
  const baseOutput = baseName === "root" ? block : `${block}__${baseName}`;
  return modifierName ? `${baseOutput}--${modifierName}` : baseOutput;
}

function lowerSelectorNodes(nodes, block, exports, mode = "local") {
  let currentMode = mode;
  for (const node of [...nodes]) {
    if (node.type === "pseudo" && (node.value === ":global" || node.value === ":local")) {
      const nextMode = node.value === ":global" ? "global" : "local";
      if (!isSelectorContainer(node) || node.nodes.length === 0) {
        currentMode = nextMode;
      }
      // Function-form :global(...) already carries its own scope. Its contents
      // must be left intact, while following sibling nodes keep the parent scope.
      continue;
    }

    if (currentMode === "local" && node.type === "class") {
      const sourceName = node.value;
      const output = outputName(block, sourceName);
      exports.set(toExportKey(sourceName), output);
      node.replaceWith(globalSelector(classSelector(output)));
      continue;
    }

    if (currentMode === "local" && node.type === "id") {
      node.replaceWith(globalSelector(idSelector(node.value)));
      continue;
    }

    if (isSelectorContainer(node)) lowerSelectorNodes(node.nodes, block, exports, currentMode);
  }
}

function lowerRuleSelector(rule, block, exports) {
  rule.selector = selectorParser((selectors) => {
    selectors.each((selector) => lowerSelectorNodes(selector.nodes, block, exports));
  }).processSync(rule.selector);
}

function readBlock(root, from) {
  const comments = root.nodes.filter((node) => node.type === "comment" && BLOCK_COMMENT.test(node.text));
  if (comments.length === 0) return null;
  if (comments.length > 1) throw new Error(`multiple @block declarations in ${from}`);
  const match = comments[0].text.match(BLOCK_COMMENT);
  if (!match?.[1]) throw new Error(`invalid @block declaration in ${from}`);
  comments[0].remove();
  return match[1];
}

function conflictKey({ name, files }) {
  return `${name}\u0000${files.join("\u0000")}`;
}

function clearResolvedWarnings(registry, reportedConflicts) {
  const activeKeys = new Set(registry.conflicts().map(conflictKey));
  for (const key of reportedConflicts) {
    if (!activeKeys.has(key)) reportedConflicts.delete(key);
  }
}

function globalizeKeyframes(root, from, registry, result, reportedConflicts) {
  const names = new Set();
  root.walkAtRules((atRule) => {
    if (!KEYFRAMES_AT_RULE.test(atRule.name)) return;
    const name = atRule.params.trim();
    if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(name)) return;
    names.add(name);
    atRule.params = `:global(${name})`;
  });
  if (!registry) return;
  registry.replace(from, names);
  clearResolvedWarnings(registry, reportedConflicts);
  for (const conflict of registry.conflicts()) {
    const { name, files } = conflict;
    const otherFile = files.find((file) => file !== from) ?? files[0];
    const key = conflictKey(conflict);
    if (files.includes(from) && !reportedConflicts.has(key)) {
      result.warn(`duplicate global keyframes "${name}" also seen in ${otherFile}`, {
        plugin: "bem-parser-spike",
      });
      reportedConflicts.add(key);
    }
  }
}

function appendExports(root, exports) {
  if (exports.size === 0) return;
  const exportRule = postcss.rule({ selector: ":export" });
  for (const [key, value] of [...exports.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    exportRule.append(postcss.decl({ prop: key, value }));
  }
  root.append(exportRule);
}

export function createBemPostcssPlugin(options = {}) {
  const keyframesRegistry = options.keyframes === false
    ? null
    : options.keyframes?.registry instanceof KeyframesRegistry
      ? options.keyframes.registry
      : new KeyframesRegistry();
  const reportedConflicts = new Set();
  const dtsEnabled = options.dts === true;
  const plugin = {
    postcssPlugin: "bem-parser-spike",
    async Once(root, { result }) {
      const from = result.opts.from ?? "<unknown>";
      const sourcePath = path.resolve(from);
      const block = readBlock(root, from);
      if (!block) {
        keyframesRegistry?.remove(sourcePath);
        if (keyframesRegistry) clearResolvedWarnings(keyframesRegistry, reportedConflicts);
        if (dtsEnabled && isCssModulePath(sourcePath)) {
          await removeOwnedDeclaration(sourcePath);
        }
        return;
      }

      const classMap = new Map();
      globalizeKeyframes(root, sourcePath, keyframesRegistry, result, reportedConflicts);
      root.walkRules((rule) => {
        if (rule.selector === ":export") return;
        lowerRuleSelector(rule, block, classMap);
      });
      root.walkDecls((decl) => {
        if (decl.prop === "animation" || decl.prop === "animation-name") {
          decl.value = globalizeAnimationValue(decl.value, decl.prop);
        }
      });
      appendExports(root, classMap);
      if (dtsEnabled && isCssModulePath(sourcePath)) {
        await writeClassDeclaration(sourcePath, classMap);
      }
    },
  };
  plugin.keyframesRegistry = keyframesRegistry;
  return plugin;
}

export function createBemCompanionPlugin({ keyframesRegistry, dts = true } = {}) {
  return {
    name: "bem-parser-spike-companion",
    configureServer(server) {
      const onWatcherEvent = async (event, file) => {
        if (event !== "unlink") return;
        if (!isCssModulePath(path.resolve(file))) return;
        keyframesRegistry?.remove(path.resolve(file));
        if (dts) await removeOwnedDeclaration(path.resolve(file));
      };
      server.watcher.on("all", onWatcherEvent);
    },
  };
}
