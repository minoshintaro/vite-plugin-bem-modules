export type WordCase = "kebab" | "camel";
export type BemOutputSeparator = "-" | "--" | "_" | "__";
export type ModifierOutput = "only" | "withBase";

export type BemNamingOptions = {
  /** The spelling used for local CSS class names. */
  wordCase?: WordCase;
  /** The separator between a block and an element in generated classes. */
  elementSeparator?: BemOutputSeparator;
  /** The separator used by source and generated class names before a modifier. */
  modifierSeparator?: BemOutputSeparator;
};

export type BemModulesOptions = {
  naming?: BemNamingOptions;
  /** CSS class names and prefixes excluded from BEM conversion. */
  globalScope?: BemGlobalScopeOptions;
  /** Whether Modifier exports include their corresponding Base class. */
  modifierOutput?: ModifierOutput;
  /** Generate an adjacent declaration file for each CSS Module. */
  types?: boolean;
  /** The explicit source scope owned by project checks and declaration sync. */
  project?: BemProjectOptions;
};

export type BemProjectOptions = {
  /** Root-relative or absolute files/directories included in the project scope. */
  include?: readonly string[];
  /** Root-relative or absolute files/directories excluded from the project scope. */
  exclude?: readonly string[];
};

export type BemGlobalScopeOptions = {
  exact?: readonly string[];
  prefix?: readonly string[];
};

export type ResolvedBemNamingOptions = {
  wordCase: WordCase;
  elementSeparator: BemOutputSeparator;
  modifierSeparator: BemOutputSeparator;
};

export type ResolvedBemCompilerOptions = {
  naming: ResolvedBemNamingOptions;
  globalScope: {
    exact: readonly string[];
    prefix: readonly string[];
  };
  modifierOutput: ModifierOutput;
};

export type ResolvedBemModulesOptions = ResolvedBemCompilerOptions & {
  types: boolean | undefined;
  project: {
    include: readonly string[];
    exclude: readonly string[];
  };
};

export type BemModifier = {
  sourceName: string;
  sourceModifierName: string;
  apiName: string;
  outputName: string;
};

export type BemBase = {
  sourceName: string;
  apiName: string;
  outputName: string;
  modifiers: readonly BemModifier[];
};

export type BemClass = {
  sourceName: string;
  apiName: string;
  kind: "base" | "modifier";
  baseSourceName: string;
  modifierSourceName?: string;
  outputName: string;
};

export type BemModuleSchema = {
  filePath: string;
  blockName: string;
  bases: readonly BemBase[];
  classes: readonly BemClass[];
  classMap: Readonly<Record<string, string>>;
  /** CSS Module export values; Modifier values may include their Base class. */
  exportMap: Readonly<Record<string, string>>;
  /** Classes written with an explicit :global selector in the module source. */
  explicitGlobalClassNames: readonly string[];
  /** CSS Module exports declared by keyframes or ICSS `@value`, not classes. */
  nonClassExportNames: readonly string[];
};
