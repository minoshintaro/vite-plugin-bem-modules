import path from "node:path";
import postcss, { type Comment, type Root, type Rule } from "postcss";
import postcssScss from "postcss-scss";
import selectorParser, { type Node as SelectorNode } from "postcss-selector-parser";
import { createBemDiagnosticError } from "./diagnostics.js";
import { isBemGlobalClassName } from "./global-scope.js";
import type {
  BemBase,
  BemClass,
  BemModifier,
  BemModuleSchema,
  ResolvedBemCompilerOptions,
} from "./types.js";

const KEBAB_TOKEN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const CAMEL_TOKEN = /^[a-z][A-Za-z0-9]*$/;
const BLOCK_NAME = /^[A-Za-z_][A-Za-z0-9_-]*$/;

function normalizeCompilerFilePath(filePath: string): string {
  return path.resolve(filePath).replaceAll("\\", "/");
}

function toApiName(value: string, wordCase: ResolvedBemCompilerOptions["naming"]["wordCase"]): string {
  if (wordCase === "camel") return value;
  return value.replace(/-([a-z0-9])/g, (_match, character: string) => character.toUpperCase());
}

export function toCssModuleApiName(value: string): string {
  return value.replace(/-+([A-Za-z0-9])/g, (_match, character: string) => character.toUpperCase());
}

function tokenPattern(wordCase: ResolvedBemCompilerOptions["naming"]["wordCase"]): RegExp {
  return wordCase === "kebab" ? KEBAB_TOKEN : CAMEL_TOKEN;
}

type ScopeMode = "local" | "global";
type SelectorContainer<Nodes extends readonly SelectorNode[] = readonly SelectorNode[]> = SelectorNode & {
  nodes: Nodes;
};

function isSelectorContainer<Nodes extends readonly SelectorNode[] = readonly SelectorNode[]>(
  node: SelectorNode,
): node is SelectorContainer<Nodes> {
  return "nodes" in node && Array.isArray(node.nodes);
}

function collectLocalClassNamesFromNodes(
  nodes: readonly SelectorNode[],
  localNames: Set<string>,
  globalNames: Set<string>,
  inheritedMode: ScopeMode,
): ScopeMode {
  let mode = inheritedMode;
  for (const node of nodes) {
    if (node.type === "pseudo" && (node.value === ":global" || node.value === ":local")) {
      const nextMode: ScopeMode = node.value === ":global" ? "global" : "local";
      if (!isSelectorContainer(node) || node.nodes.length === 0) {
        mode = nextMode;
      } else {
        collectLocalClassNamesFromNodes(node.nodes, localNames, globalNames, nextMode);
      }
      continue;
    }

    if (node.type === "class") (mode === "local" ? localNames : globalNames).add(node.value);
    // Vite carries an empty :global/:local mode across selector branches inside
    // a pseudo function, while an explicit function scope remains child-only.
    if (isSelectorContainer(node)) collectLocalClassNamesFromNodes(node.nodes, localNames, globalNames, mode);
  }
  return mode;
}

function scopeModeAfterRuleSelector(selector: string, inheritedMode: ScopeMode): ScopeMode {
  let result = inheritedMode;
  let firstSelector = true;
  selectorParser((selectors) => {
    selectors.each((parsedSelector) => {
      const mode = collectLocalClassNamesFromNodes(parsedSelector.nodes, new Set(), new Set(), inheritedMode);
      if (firstSelector) {
        result = mode;
        firstSelector = false;
      } else if (mode !== result) {
        result = inheritedMode;
      }
    });
  }).processSync(selector);
  return result;
}

function inheritedRuleScopeMode(rule: Rule): ScopeMode {
  const ancestors: Rule[] = [];
  let ancestor = rule.parent;
  while (ancestor && ancestor.type !== "root") {
    if (ancestor.type === "rule") ancestors.push(ancestor);
    ancestor = ancestor.parent;
  }

  let mode: ScopeMode = "local";
  for (const ancestorRule of ancestors.reverse()) {
    mode = scopeModeAfterRuleSelector(ancestorRule.selector, mode);
  }
  return mode;
}

type BlockComment = {
  comment: Comment;
  blockName: string;
};

const BLOCK_COMMENT_CANDIDATE = /\/\*\s*@block(?:\s|$)/;

function collectBlockComments(root: Root): Comment[] {
  const comments: Comment[] = [];
  root.walkComments((comment) => {
    // postcss-scss marks `//` comments with raws.inline. A block comment on
    // the same line as a rule remains a normal Comment node and is retained.
    if (comment.raws.inline === true) return;
    if (/^\s*@block(?:\s|$)/.test(comment.text)) comments.push(comment);
  });
  return comments;
}

function assertSupportedBemSyntax(root: Root, filePath: string): void {
  const implicitBemSelector = /(?:&|#\{\s*&\s*\})(?:--|__|_|-)(?:[A-Za-z0-9_]|#\{)/;
  const selectorInterpolation = /#\{/;
  const reject = (selector: string): never => {
    throw createBemDiagnosticError("BEM005", "selector nesting must not implicitly create a BEM class name.", {
      file: filePath,
      details: [
        `selector: ${selector}`,
        "write the complete class selector explicitly; selector interpolation and the @at-root syntax are not supported.",
      ],
    });
  };

  root.walkRules((rule) => {
    if (rule.selector && selectorInterpolation.test(rule.selector)) reject(rule.selector);
    let ancestor = rule.parent;
    let nested = false;
    while (ancestor && ancestor !== root) {
      if (ancestor.type === "rule") {
        nested = true;
        break;
      }
      ancestor = ancestor.parent as typeof ancestor;
    }
    if (!nested || !rule.selector) return;
    if (implicitBemSelector.test(rule.selector)) reject(rule.selector);
  });

  root.walkAtRules("at-root", (atRule) => {
    reject(`@at-root ${atRule.params}`.trim());
  });
  root.walkAtRules("extend", (atRule) => {
    throw createBemDiagnosticError("BEM005", "Sass @extend is not supported in BEM modules.", {
      file: filePath,
      details: [
        `target: ${atRule.params}`,
        "use a mixin to share declarations without selector inheritance.",
      ],
    });
  });
}

function readBlockComment(root: Root, filePath: string): BlockComment {
  const comments = collectBlockComments(root);

  if (comments.length === 0) {
    throw createBemDiagnosticError("BEM001", "a CSS Module must declare exactly one @block name.", {
      file: filePath,
      details: ["expected: /* @block card */"],
    });
  }
  if (comments.length > 1) {
    throw createBemDiagnosticError("BEM002", "a CSS Module must not declare more than one @block name.", {
      file: filePath,
      details: comments.map((comment) => `declaration: ${comment.text.trim()}`),
    });
  }

  const match = comments[0]!.text.match(/^\s*@block\s+(.+?)\s*$/);
  const blockName = match?.[1]?.trim() ?? "";
  if (!blockName || !BLOCK_NAME.test(blockName)) {
    throw createBemDiagnosticError("BEM001", "@block must contain one CSS-safe Block name.", {
      file: filePath,
      details: [`received: ${JSON.stringify(blockName)}`],
    });
  }

  return { comment: comments[0]!, blockName };
}

function addNonClassExportName(names: Set<string>, value: string): void {
  const name = value.trim();
  if (!/^-?[A-Za-z_][A-Za-z0-9_-]*$/.test(name)) return;
  names.add(name);
  names.add(toCssModuleApiName(name));
}

function collectNonClassExportNames(root: Root): string[] {
  const names = new Set<string>();
  root.walkRules((rule) => {
    if (rule.selector.trim() !== ":export") return;
    rule.walkDecls((declaration) => addNonClassExportName(names, declaration.prop));
  });
  root.walkAtRules((atRule) => {
    if (/^(?:-[A-Za-z0-9]+-)?keyframes$/i.test(atRule.name)) {
      addNonClassExportName(names, atRule.params.trim().split(/\s+/, 1)[0] ?? "");
      return;
    }
    if (atRule.name.toLowerCase() !== "value") return;

    const declaration = atRule.params.split(/\s+from\s+/i, 1)[0] ?? "";
    const namesPart = declaration.split(":", 1)[0] ?? declaration;
    const trimmedNamesPart = namesPart.trim();
    const importList = trimmedNamesPart.startsWith("(") && trimmedNamesPart.endsWith(")")
      ? trimmedNamesPart.slice(1, -1)
      : trimmedNamesPart;
    for (const segment of importList.split(",")) {
      const tokens = segment.trim().split(/\s+/);
      if (tokens.length >= 3 && tokens[1]?.toLowerCase() === "as") {
        addNonClassExportName(names, tokens[0] ?? "");
        addNonClassExportName(names, tokens[2] ?? "");
      } else {
        addNonClassExportName(names, tokens[0] ?? "");
      }
    }
  });
  return [...names].sort();
}

function parseModuleSource(filePath: string, source: string): Root {
  return filePath.endsWith(".scss")
    ? postcssScss.parse(source, { from: filePath })
    : postcss.parse(source, { from: filePath });
}

function parseModuleSourceIfOwned(filePath: string, source: string): Root | null {
  // Keep the cheap candidate check, but let the format parser decide whether
  // the candidate is a real comment. This avoids treating `//` in an
  // unquoted Sass URL such as `url(http://...)` as a line comment.
  if (!BLOCK_COMMENT_CANDIDATE.test(source)) return null;
  const root = parseModuleSource(filePath, source);
  return collectBlockComments(root).length > 0 ? root : null;
}

function classSelector(value: string): SelectorNode {
  const node = selectorParser.className({ value: "" });
  // The factory preserves raw input; the setter escapes a CSS identifier.
  node.value = value;
  return node;
}

function globalClassSelector(value: string): SelectorNode {
  return selectorParser.pseudo({
    value: ":global",
    nodes: [selectorParser.selector({ value: "", nodes: [classSelector(value)] })],
  });
}

function lowerSelectorNodes(
  nodes: SelectorNode[],
  schema: BemModuleSchema,
  inheritedMode: ScopeMode,
  wrapMappedClasses = true,
): void {
  let mode = inheritedMode;
  for (const node of [...nodes]) {
    if (node.type === "pseudo" && (node.value === ":global" || node.value === ":local")) {
      const nextMode: ScopeMode = node.value === ":global" ? "global" : "local";
      if (!isSelectorContainer<SelectorNode[]>(node) || node.nodes.length === 0) {
        mode = nextMode;
        if (nextMode === "local") node.remove();
      } else {
        const unwrapLocal = nextMode === "local" && node.nodes.length === 1;
        lowerSelectorNodes(node.nodes, schema, nextMode, unwrapLocal ? wrapMappedClasses : false);
        if (nextMode === "local") {
          if (unwrapLocal) {
            const child = node.nodes[0];
            if (isSelectorContainer<SelectorNode[]>(child)) node.replaceWith(...child.nodes);
          } else {
            node.value = ":global";
          }
        }
      }
      continue;
    }

    if (node.type === "class" && mode === "local") {
      const outputName = schema.classMap[node.value];
      if (outputName) {
        node.replaceWith(wrapMappedClasses
          ? globalClassSelector(outputName)
          : classSelector(outputName));
      }
    }
    if (isSelectorContainer<SelectorNode[]>(node)) {
      lowerSelectorNodes(node.nodes, schema, mode, wrapMappedClasses);
    }
  }
}

function lowerSelectors(root: Root, schema: BemModuleSchema): void {
  const inheritedModes = new Map<Rule, ScopeMode>();
  root.walkRules((rule) => {
    inheritedModes.set(rule, inheritedRuleScopeMode(rule));
  });

  root.walkRules((rule) => {
    if (!rule.selector) return;
    const inheritedMode = inheritedModes.get(rule) ?? "local";
    rule.selector = selectorParser((selectors) => {
      selectors.each((selector) => {
        lowerSelectorNodes(selector.nodes, schema, inheritedMode);
      });
    }).processSync(rule.selector);
  });
}

function appendExportMap(root: Root, schema: BemModuleSchema): void {
  const exportRule = postcss.rule({ selector: ":export" });
  for (const key of Object.keys(schema.exportMap).sort()) {
    exportRule.append(postcss.decl({ prop: key, value: schema.exportMap[key]! }));
  }
  root.append(exportRule);
}

function lowerParsedModuleSource(filePath: string, root: Root, schema: BemModuleSchema): string {
  readBlockComment(root, filePath).comment.remove();
  lowerSelectors(root, schema);
  appendExportMap(root, schema);
  return root.toString();
}

export function lowerBemModuleSource(
  filePath: string,
  source: string,
  schema: BemModuleSchema,
): string {
  return lowerParsedModuleSource(filePath, parseModuleSource(filePath, source), schema);
}

export function analyzeAndLowerModuleSourceIfOwned(
  filePath: string,
  source: string,
  options: ResolvedBemCompilerOptions,
): { schema: BemModuleSchema; loweredSource: string } | null {
  const root = parseModuleSourceIfOwned(filePath, source);
  if (!root) return null;
  const schema = analyzeParsedModule(filePath, root, options);
  return { schema, loweredSource: lowerParsedModuleSource(filePath, root, schema) };
}

function collectClassNames(root: Root): { localNames: Set<string>; explicitGlobalNames: Set<string> } {
  const localNames = new Set<string>();
  const explicitGlobalNames = new Set<string>();
  root.walkRules((rule) => {
    if (!rule.selector) return;
    const inheritedMode = inheritedRuleScopeMode(rule);
    selectorParser((selectors) => {
      selectors.each((selector) => {
        collectLocalClassNamesFromNodes(selector.nodes, localNames, explicitGlobalNames, inheritedMode);
      });
    }).processSync(rule.selector);
  });
  return { localNames, explicitGlobalNames };
}

function assertToken(value: string, wordCase: ResolvedBemCompilerOptions["naming"]["wordCase"], filePath: string) {
  if (value === "root") return;
  if (!tokenPattern(wordCase).test(value)) {
    throw createBemDiagnosticError("BEM003", "CSS class names do not match the configured wordCase.", {
      file: filePath,
      details: [`class: .${value}`, `wordCase: ${wordCase}`],
    });
  }
}

function classifyClasses(
  localNames: readonly string[],
  blockName: string,
  options: ResolvedBemCompilerOptions,
  filePath: string
): { bases: BemBase[]; classes: BemClass[] } {
  const modifierSeparator = options.naming.modifierSeparator;
  const baseNames = new Set(localNames.filter((name) => !name.includes(modifierSeparator)));
  const bases = new Map<string, BemBase>();
  const classes: BemClass[] = [];
  const apiNames = new Map<string, string>();

  for (const sourceName of localNames) {
    if (sourceName.includes(modifierSeparator)) continue;
    assertToken(sourceName, options.naming.wordCase, filePath);
    const apiName = toApiName(sourceName, options.naming.wordCase);
    const previous = apiNames.get(apiName);
    if (previous && previous !== sourceName) {
      throw createBemDiagnosticError("BEM003", "CSS class names collide after JavaScript name conversion.", {
        file: filePath,
        details: [`api name: ${apiName}`, `classes: .${previous}, .${sourceName}`],
      });
    }
    apiNames.set(apiName, sourceName);
    const outputName = sourceName === "root"
      ? blockName
      : `${blockName}${options.naming.elementSeparator}${sourceName}`;
    bases.set(sourceName, {
      sourceName,
      apiName,
      outputName,
      modifiers: [],
    });
  }

  for (const sourceName of localNames) {
    const separatorIndex = sourceName.indexOf(modifierSeparator);
    if (separatorIndex === -1) continue;

    const baseSourceName = sourceName.slice(0, separatorIndex);
    const modifierSourceName = sourceName.slice(separatorIndex + modifierSeparator.length);
    if (!baseSourceName || !modifierSourceName || modifierSourceName.includes(modifierSeparator)) {
      throw createBemDiagnosticError("BEM003", "modifier class names must contain one modifier separator.", {
        file: filePath,
        details: [`class: .${sourceName}`, `separator: ${modifierSeparator}`],
      });
    }
    if (!baseNames.has(baseSourceName)) {
      throw createBemDiagnosticError("BEM003", "modifier class has no matching base class.", {
        file: filePath,
        details: [`modifier: .${sourceName}`, `missing base: .${baseSourceName}`],
      });
    }
    assertToken(baseSourceName, options.naming.wordCase, filePath);
    assertToken(modifierSourceName, options.naming.wordCase, filePath);

    const base = bases.get(baseSourceName)!;
    const apiName = toApiName(modifierSourceName, options.naming.wordCase);
    const existingModifier = base.modifiers.find((modifier) => modifier.apiName === apiName);
    if (existingModifier && existingModifier.sourceModifierName !== modifierSourceName) {
      throw createBemDiagnosticError("BEM003", "modifier names collide after JavaScript name conversion.", {
        file: filePath,
        details: [`base: .${baseSourceName}`, `api name: ${apiName}`],
      });
    }

    const outputName = baseSourceName === "root"
      ? `${blockName}${options.naming.modifierSeparator}${modifierSourceName}`
      : `${blockName}${options.naming.elementSeparator}${baseSourceName}${options.naming.modifierSeparator}${modifierSourceName}`;
    const modifier: BemModifier = {
      sourceName,
      sourceModifierName: modifierSourceName,
      apiName,
      outputName,
    };
    base.modifiers = [...base.modifiers, modifier];
    classes.push({
      sourceName,
      apiName,
      kind: "modifier",
      baseSourceName,
      modifierSourceName,
      outputName,
    });
  }

  for (const base of bases.values()) {
    classes.push({
      sourceName: base.sourceName,
      apiName: base.apiName,
      kind: "base",
      baseSourceName: base.sourceName,
      outputName: base.outputName,
    });
  }

  return {
    bases: [...bases.values()].sort((a, b) => a.sourceName.localeCompare(b.sourceName)),
    classes: classes.sort((a, b) => a.sourceName.localeCompare(b.sourceName)),
  };
}

function analyzeParsedModule(
  filePath: string,
  root: Root,
  options: ResolvedBemCompilerOptions,
): BemModuleSchema {
  root.walkDecls("composes", (declaration) => {
    throw createBemDiagnosticError("BEM007", "CSS Modules `composes` is not supported.", {
      file: filePath,
      details: [`value: ${declaration.value}`],
    });
  });
  const blockName = readBlockComment(root, filePath).blockName;
  assertSupportedBemSyntax(root, filePath);
  const nonClassExportNames = collectNonClassExportNames(root);
  const collectedNames = collectClassNames(root);
  const localNames = [...collectedNames.localNames].sort();
  const globalNames: string[] = [];
  const bemNames: string[] = [];
  for (const name of localNames) {
    (isBemGlobalClassName(name, options.globalScope) ? globalNames : bemNames).push(name);
  }
  const classified = classifyClasses(bemNames, blockName, options, filePath);

  const outputOwners = new Map<string, string>();
  for (const classInfo of classified.classes) {
    const previous = outputOwners.get(classInfo.outputName);
    if (previous && previous !== classInfo.sourceName) {
      throw createBemDiagnosticError("BEM003", "Generated class names must be unique within a CSS Module.", {
        file: filePath,
        details: [
          `class: ${classInfo.outputName}`,
          `classes: .${previous}, .${classInfo.sourceName}`,
        ],
      });
    }
    outputOwners.set(classInfo.outputName, classInfo.sourceName);
  }

  const flatApiOwners = new Map<string, string>();
  const classMap: Record<string, string> = Object.create(null) as Record<string, string>;
  const exportMap: Record<string, string> = Object.create(null) as Record<string, string>;
  const addClassMap = (sourceName: string, outputName: string) => {
    const apiNames = new Set([sourceName, toCssModuleApiName(sourceName)]);
    for (const apiName of apiNames) {
      const previous = flatApiOwners.get(apiName);
      if (previous && previous !== sourceName) {
        throw createBemDiagnosticError("BEM003", "CSS Module local names collide after camelCase conversion.", {
          file: filePath,
          details: [`api name: ${apiName}`, `classes: .${previous}, .${sourceName}`],
        });
      }
      flatApiOwners.set(apiName, sourceName);
      classMap[apiName] = outputName;
    }
  };
  const addExportMap = (sourceName: string, exportValue: string) => {
    const apiNames = new Set([sourceName, toCssModuleApiName(sourceName)]);
    for (const apiName of apiNames) exportMap[apiName] = exportValue;
  };

  for (const sourceName of globalNames) {
    addClassMap(sourceName, sourceName);
    addExportMap(sourceName, sourceName);
  }
  for (const classInfo of classified.classes) {
    addClassMap(classInfo.sourceName, classInfo.outputName);
  }
  for (const classInfo of classified.classes) {
    const exportValue = classInfo.kind === "modifier" && options.modifierOutput === "withBase"
      ? `${classMap[classInfo.baseSourceName]!} ${classInfo.outputName}`
      : classInfo.outputName;
    addExportMap(classInfo.sourceName, exportValue);
  }

  return {
    filePath: normalizeCompilerFilePath(filePath),
    blockName,
    bases: classified.bases,
    classes: classified.classes,
    classMap,
    exportMap,
    explicitGlobalClassNames: [...collectedNames.explicitGlobalNames].sort(),
    nonClassExportNames,
  };
}

export function analyzeModuleSource(
  filePath: string,
  source: string,
  options: ResolvedBemCompilerOptions
): BemModuleSchema {
  const root = parseModuleSource(filePath, source);
  return analyzeParsedModule(filePath, root, options);
}

export function analyzeModuleSourceIfOwned(
  filePath: string,
  source: string,
  options: ResolvedBemCompilerOptions,
): BemModuleSchema | null {
  const root = parseModuleSourceIfOwned(filePath, source);
  if (!root) return null;
  return analyzeParsedModule(filePath, root, options);
}
