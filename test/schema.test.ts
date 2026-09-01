import assert from "node:assert/strict";
import test from "node:test";
import { analyzeModuleSource, analyzeModuleSourceIfOwned } from "../src/schema.js";
import type {
  BemGlobalScopeOptions,
  BemNamingOptions,
  ModifierOutput,
  ResolvedBemCompilerOptions,
} from "../src/types.js";

const KEBAB_NAMING = { wordCase: "kebab" as const };

type CompilerOptionOverrides = {
  naming?: BemNamingOptions;
  globalScope?: BemGlobalScopeOptions;
  modifierOutput?: ModifierOutput;
};

function compilerOptions(options: CompilerOptionOverrides = {}): ResolvedBemCompilerOptions {
  return {
    naming: {
      wordCase: "camel",
      elementSeparator: "__",
      modifierSeparator: "--",
      ...options.naming,
    },
    globalScope: {
      exact: options.globalScope?.exact ?? [],
      prefix: options.globalScope?.prefix ?? [],
    },
    modifierOutput: options.modifierOutput ?? "only",
  };
}

function analyze(source: string, naming: BemNamingOptions | undefined = undefined) {
  return analyzeModuleSource("/tmp/Card.module.css", source, compilerOptions({ naming }));
}

function analyzeWithOptions(source: string, options: CompilerOptionOverrides = {}) {
  return analyzeModuleSource("/tmp/Card.module.css", source, compilerOptions(options));
}

test("camel記法からModifierを解析し、入力tokenを生成classへ引き継ぐ", () => {
  const schema = analyze("/* @block card */ .root {} .profileImage {} .profileImage--rounded {}");

  assert.equal(schema.classMap.profileImage, "card__profileImage");
  assert.equal(schema.classMap.profileImageRounded, "card__profileImage--rounded");
});

test("modifierOutputはselector用classMapを変えず、flat export valueだけを切り替える", () => {
  const source = "/* @block card */ .root {} .root--compact {} .profileImage {} .profileImage--rounded {}";
  const only = analyzeWithOptions(source);
  const withBase = analyzeWithOptions(source, { modifierOutput: "withBase" });

  assert.deepEqual(Object.keys(withBase.classMap).sort(), Object.keys(withBase.exportMap).sort());
  assert.equal(only.classMap.rootCompact, "card--compact");
  assert.equal(only.exportMap.rootCompact, "card--compact");
  assert.equal(withBase.classMap.rootCompact, "card--compact");
  assert.equal(withBase.exportMap.rootCompact, "card card--compact");
  assert.equal(
    withBase.exportMap.profileImageRounded,
    "card__profileImage card__profileImage--rounded",
  );
  assert.equal(
    withBase.exportMap["profileImage--rounded"],
    "card__profileImage card__profileImage--rounded",
  );
});

test("明示したkebabの -- 記法から Modifier をルールベースで解析する", () => {
  const schema = analyze(`
/* @block p-card */
.root {}
.root--compact {}
.profile-image {}
.profile-image--rounded {}
`, KEBAB_NAMING);

  assert.equal(schema.blockName, "p-card");
  assert.equal(schema.classMap.root, "p-card");
  assert.equal(schema.classMap.profileImage, "p-card__profile-image");
  assert.equal(schema.classMap.profileImageRounded, "p-card__profile-image--rounded");
  assert.equal(schema.classMap.rootCompact, "p-card--compact");
  assert.equal(schema.classMap["profile-image--rounded"], "p-card__profile-image--rounded");
  assert.deepEqual(schema.bases.find((base) => base.apiName === "profileImage")?.modifiers.map((modifier) => modifier.apiName), ["rounded"]);
});

test("keyframes と ICSS value は class export ではないschema情報として保持する", () => {
  const schema = analyze(`
/* @block card */
@value primary: #f00;
@keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
:export { theme-color: #0f0; }
.root { color: primary; animation: fade-in 1s; }
`);

  assert.deepEqual(schema.nonClassExportNames, ["fade-in", "fadeIn", "primary", "theme-color", "themeColor"]);
});

test("単一ハイフンの名前は Modifier ではなく通常の Element として残る", () => {
  const schema = analyze("/* @block card */ .profile-image-rounded {}", KEBAB_NAMING);

  assert.equal(schema.classMap.profileImageRounded, "card__profile-image-rounded");
  assert.equal(schema.bases[0]?.modifiers.length, 0);
});

test("kebab では -- が Modifier、単一ハイフンが Element の境界になる", () => {
  const schema = analyze("/* @block card */ .root {} .root--primary {} .root-state {}", KEBAB_NAMING);

  assert.equal(schema.classMap.root, "card");
  assert.equal(schema.classMap.rootPrimary, "card--primary");
  assert.equal(schema.classMap.rootState, "card__root-state");
});

test("root--primary は Block Modifier、root-primary は Element として扱う", () => {
  const modifier = analyze("/* @block card */ .root {} .root--primary {}", KEBAB_NAMING);
  const element = analyze("/* @block card */ .root {} .root-primary {}", KEBAB_NAMING);

  assert.equal(modifier.classMap.rootPrimary, "card--primary");
  assert.equal(element.classMap.rootPrimary, "card__root-primary");
});

test("camel の local class 名も flat API 名をそのまま使う", () => {
  const schema = analyze(
    `
/* @block card */
.root {}
.profileImage {}
.profileImage--extraLarge {}
`,
    { wordCase: "camel" },
  );

  assert.equal(schema.classMap.profileImage, "card__profileImage");
  assert.equal(schema.classMap.profileImage, "card__profileImage");
  assert.equal(schema.classMap["profileImage--extraLarge"], "card__profileImage--extraLarge");
});

test("camel ではModifier区切りを入力と出力に共通で単一ハイフンへ変更できる", () => {
  const schema = analyze(
    "/* @block card */ .root {} .root-primary {} .profileImage {} .profileImage-rounded {}",
    { wordCase: "camel", modifierSeparator: "-" },
  );

  assert.equal(schema.classMap.rootPrimary, "card-primary");
  assert.equal(schema.classMap.profileImage, "card__profileImage");
  assert.equal(schema.classMap.profileImageRounded, "card__profileImage-rounded");
});

test("併記なしの modifier は対応する base がなければ拒否する", () => {
  assert.throws(
    () => analyze("/* @block card */ .profile-image--rounded {}", KEBAB_NAMING),
    /modifier class has no matching base class/,
  );
});

test("flat APIではStringやObjectのprototype名もModifierとして許可する", () => {
  for (const sourceName of [
    "length",
    "trim",
    "replace-all",
    "to-lower-case",
    "has-own-property",
    "is-prototype-of",
    "property-is-enumerable",
    "to-locale-string",
  ]) {
    assert.doesNotThrow(() => analyze(`/* @block card */ .root {} .root--${sourceName} {}`, KEBAB_NAMING));
  }

  for (const sourceName of [
    "small",
    "big",
    "bold",
    "fixed",
    "link",
    "sub",
    "sup",
    "italics",
    "strike",
    "blink",
    "anchor",
    "fontcolor",
    "fontsize",
  ]) {
    assert.doesNotThrow(() => analyze(`/* @block card */ .root {} .root--${sourceName} {}`, KEBAB_NAMING));
  }
});

test("@block がない CSS Module は拒否する", () => {
  assert.throws(() => analyze(".root {}"), /must declare exactly one @block name/);
});

test("@block がない CSS Module は optional ownership 判定でViteへ委譲する", () => {
  assert.equal(
    analyzeModuleSourceIfOwned("/tmp/Card.module.css", ".root {}", compilerOptions()),
    null,
  );
  assert.equal(
    analyzeModuleSourceIfOwned(
      "/tmp/Card.module.css",
      '.root { content: "/* @block not-a-marker */"; }',
      compilerOptions(),
    ),
    null,
  );
});

test("SCSSの行コメントは@block所有判定と重複検査から除外する", () => {
  const options = compilerOptions();
  const schema = analyzeModuleSourceIfOwned(
    "/tmp/Card.module.scss",
    "// don't remove this\n/* @block card */\n// @block ignored\n.root {}\n.root--compact {}",
    options,
  );

  assert.ok(schema);
  assert.equal(schema.blockName, "card");
  assert.equal(schema.classMap.rootCompact, "card--compact");
  assert.equal(
    analyzeModuleSourceIfOwned(
      "/tmp/Card.module.scss",
      "// /* @block card */\n.root {}",
      options,
    ),
    null,
  );
});

test("global classの__proto__をclassMapの特殊キーとして扱わない", () => {
  const schema = analyzeModuleSource(
    "/tmp/Card.module.css",
    "/* @block card */ .root {} .__proto__ {}",
    compilerOptions({ globalScope: { exact: ["__proto__"] } }),
  );

  assert.equal(schema.classMap["__proto__"], "__proto__");
  assert.equal(Object.getPrototypeOf(schema.classMap), null);
});

test("設定と異なる単語結合の class 名を拒否する", () => {
  assert.throws(
    () => analyze("/* @block card */ .profile-image {} .profileImage {}", { wordCase: "kebab" }),
    /do not match the configured wordCase/,
  );
});

test("Modifier区切りは入力と出力で共通し、Element区切りとは個別指定できる", () => {
  const schema = analyze(
    "/* @block card */ .root {} .root-compact {} .title {} .title-large {}",
    { wordCase: "camel", elementSeparator: "_", modifierSeparator: "-" },
  );

  assert.equal(schema.classMap.root, "card");
  assert.equal(schema.classMap.title, "card_title");
  assert.equal(schema.classMap["title-large"], "card_title-large");
});

test("Modifier区切りにアンダースコアも入力と出力へ共通で使える", () => {
  const schema = analyze(
    "/* @block card */ .title {} .title_large {}",
    { elementSeparator: "__", modifierSeparator: "_" },
  );

  assert.equal(schema.classMap["title_large"], "card__title_large");
});

test("BEM classを暗黙生成するselector nestingはBEM005で拒否する", () => {
  assert.throws(
    () => analyzeModuleSource(
      "/tmp/Card.module.scss",
      "/* @block card */ .profile-image { &--rounded { border-radius: 50%; } }",
      compilerOptions({ naming: KEBAB_NAMING }),
    ),
    /vite-plugin-bem-modules:BEM005.*selector nesting/s,
  );
});

test("BEM suffixを生成するSass補間もBEM005で拒否する", () => {
  assert.throws(
    () => analyzeModuleSource(
      "/tmp/Card.module.scss",
      "/* @block card */ $modifier: rounded; .profile-image { &--#{$modifier} {} }",
      compilerOptions({ naming: KEBAB_NAMING }),
    ),
    /vite-plugin-bem-modules:BEM005.*selector nesting/s,
  );
});

test("#{&}でBEM suffixを生成するSass補間もBEM005で拒否する", () => {
  assert.throws(
    () => analyzeModuleSource(
      "/tmp/Card.module.scss",
      "/* @block card */ .profile-image { #{&}--rounded {} }",
      compilerOptions({ naming: KEBAB_NAMING }),
    ),
    /vite-plugin-bem-modules:BEM005.*selector nesting/s,
  );
});

test("宣言値のSass補間はimplicit BEM nestingとして診断しない", () => {
  const schema = analyzeModuleSource(
    "/tmp/Card.module.scss",
    "/* @block card */ .profile-image { $space: 4px; margin: #{$space}; }",
    compilerOptions({ naming: KEBAB_NAMING }),
  );

  assert.equal(schema.classMap.profileImage, "card__profile-image");
});

test("Sass変数に保持したparent selectorからのBEM suffix生成もBEM005で拒否する", () => {
  assert.throws(
    () => analyzeModuleSource(
      "/tmp/Card.module.scss",
      "/* @block card */ .profile-image { $this: &; #{$this}--rounded {} }",
      compilerOptions({ naming: KEBAB_NAMING }),
    ),
    /vite-plugin-bem-modules:BEM005.*selector nesting/s,
  );
});

test("@at-rootによるselector生成もBEM005で拒否する", () => {
  assert.throws(
    () => analyzeModuleSource(
      "/tmp/Card.module.scss",
      "/* @block card */ .profile-image { @at-root #{&}--rounded {} }",
      compilerOptions({ naming: KEBAB_NAMING }),
    ),
    /vite-plugin-bem-modules:BEM005.*selector nesting/s,
  );
});

test("BEM対象のSass @extendはoptionalやplaceholderを含めBEM005で拒否する", () => {
  for (const target of [".root", ".root !optional", "%shared"]) {
    const source = `%shared { color: red; } .root { padding: 4px; } .title { @extend ${target}; }`;
    assert.throws(
      () => analyzeModuleSource("/tmp/Card.module.scss", `/* @block card */ ${source}`, compilerOptions()),
      /BEM005.*@extend/s,
    );
    assert.equal(analyzeModuleSourceIfOwned("/tmp/Plain.module.scss", source, compilerOptions()), null);
  }
});

test("global selectorはCSS Modulesのschema対象外にする", () => {
  const schema = analyze(`
/* @block card */
:global .vendor {}
.root {}
:global(.utility) .child {}
.local :global .another-vendor {}
`);

  assert.deepEqual(schema.classes.map((classInfo) => classInfo.sourceName), ["child", "local", "root"]);
  assert.deepEqual(schema.explicitGlobalClassNames, ["another-vendor", "utility", "vendor"]);
});

test("global / local の関数形式は親のscope状態を漏らさない", () => {
  const schema = analyze(`
/* @block card */
:global .vendor :local(.child) {}
.root:not(:global .another-vendor) .descendant {}
.root:is(.local, :global .third-party) .after {}
`);

  assert.deepEqual(
    schema.classes.map((classInfo) => classInfo.sourceName),
    ["after", "child", "descendant", "local", "root"],
  );
});

test("global / local のblock形式をnested ruleへ継承する", () => {
  const schema = analyze(`
/* @block card */
:global {
  .vendor {}
  :local(.child) {}
}
:local {
  .root {}
}
`);

  assert.deepEqual(schema.classes.map((classInfo) => classInfo.sourceName), ["child", "root"]);
});

test("親selectorのglobal / local scopeをSass nestingの子へ継承する", () => {
  const schema = analyzeModuleSource(
    "/tmp/Card.module.scss",
    `/* @block card */
:global .vendor {
  .global-child {}
}
.root :global .another-vendor {
  .another-global-child {}
}
:global .vendor :local .local-parent {
  .local-child {}
}
`,
    compilerOptions({ naming: KEBAB_NAMING }),
  );

  assert.deepEqual(schema.classes.map((classInfo) => classInfo.sourceName), ["local-child", "local-parent", "root"]);
});

test("指定した接頭辞の class は BEM 分類をスキップし、元の名前を classMap に保持する", () => {
  const schema = analyzeWithOptions(
    `
/* @block card */
.root {}
.is-active {}
.has-error--visible {}
`,
    { globalScope: { prefix: ["is-", "has-"] } },
  );

  assert.deepEqual(schema.classes.map((classInfo) => classInfo.sourceName), ["root"]);
  assert.equal(schema.classMap.root, "card");
  assert.equal(schema.classMap["is-active"], "is-active");
  assert.equal(schema.classMap.isActive, "is-active");
  assert.equal(schema.classMap["has-error--visible"], "has-error--visible");
  assert.equal(schema.classMap.hasErrorVisible, "has-error--visible");
});

test("globalScope.prefix は任意の接頭辞に適用し、未指定の接頭辞は BEM 対象のままにする", () => {
  const schema = analyzeWithOptions(
    "/* @block card */ .state-open {} .is-active {}",
    { naming: KEBAB_NAMING, globalScope: { prefix: ["state-"] } },
  );

  assert.equal(schema.classMap.stateOpen, "state-open");
  assert.equal(schema.classMap.isActive, "card__is-active");
});

test("globalScope.exact は完全一致だけを BEM 分類から除外する", () => {
  const schema = analyzeWithOptions(
    "/* @block card */ .active {} .active-state {} .root {}",
    { naming: KEBAB_NAMING, globalScope: { exact: ["active"] } },
  );

  assert.equal(schema.classMap.active, "active");
  assert.equal(schema.classMap.activeState, "card__active-state");
  assert.equal(schema.classMap.root, "card");
});

test("予約語 root は globalScope より優先されて Block として扱う", () => {
  const schema = analyzeWithOptions(
    "/* @block card */ .root {} .root--compact {}",
    { globalScope: { exact: ["root"] } },
  );

  assert.equal(schema.classMap.root, "card");
  assert.equal(schema.classMap.rootCompact, "card--compact");
  assert.equal(schema.bases[0]?.sourceName, "root");
});

test("グローバル class は wordCase と Modifier の Base 検証を受けない", () => {
  const schema = analyzeWithOptions(
    "/* @block card */ .is-active--compact {}",
    { naming: { wordCase: "camel" }, globalScope: { prefix: ["is-"] } },
  );

  assert.equal(schema.classMap["is-active--compact"], "is-active--compact");
  assert.equal(schema.bases.length, 0);
  assert.equal(schema.classes.length, 0);
});

test("グローバル class の camelCase alias が BEM class と衝突したら拒否する", () => {
  assert.throws(
    () => analyzeWithOptions(
      "/* @block card */ .is-active {} .isActive {}",
      { naming: { wordCase: "camel" }, globalScope: { prefix: ["is-"] } },
    ),
    /local names collide after camelCase conversion/,
  );
});

test("camelCase化後にModifierとElementのflat keyが衝突したら拒否する", () => {
  assert.throws(
    () => analyze("/* @block card */ .foo {} .foo-bar {} .foo--bar {}", KEBAB_NAMING),
    /local names collide after camelCase conversion/,
  );
});

test("CSS Modules の composes は明示的な unsupported 診断にする", () => {
  assert.throws(
    () => analyze("/* @block card */ .root { composes: legacy; }"),
    /vite-plugin-bem-modules:BEM007.*CSS Modules `composes` is not supported/s,
  );
});
