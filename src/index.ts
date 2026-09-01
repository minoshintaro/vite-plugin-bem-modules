import type { ConfigEnv, Plugin, PluginOption, UserConfig } from "vite";
import { createBemRuntime } from "./runtime.js";
import type { BemModulesOptions } from "./types.js";
import {
  isInNodeModules,
  isModuleFile,
  isVirtualModule,
  stripQuery,
  getNonModuleQuery,
} from "./vite-utils.js";
import { unsupportedCssModuleQueryError } from "./diagnostics.js";

/** Identity helper for sharing one options object with the Vite plugin and CLI. */
export function defineBemModulesConfig(options: BemModulesOptions): BemModulesOptions {
  return options;
}

export default function bemModules(options: BemModulesOptions = {}): PluginOption {
  const runtime = createBemRuntime(options);

  const cssPlugin: Plugin = {
    name: "vite-plugin-bem-modules:css",
    enforce: "pre",

    // CSS rewriting stays pre; the observer is asserted again after resolution.
    config: {
      order: "post",
      handler(config: UserConfig, env: ConfigEnv) {
        return runtime.config(config, env);
      },
    },

    configResolved: {
      order: "post",
      handler(config) {
        runtime.configResolved(config);
      },
    },

    async resolveId(source, importer) {
      if (!runtime.isActive()) return null;
      const nonModuleQuery = getNonModuleQuery(source);
      if (!nonModuleQuery || !importer || isVirtualModule(source)) return null;
      const resolved = await this.resolve(source, importer, { skipSelf: true });
      const resolvedId = typeof resolved === "string" ? resolved : resolved?.id;
      if (!resolvedId || !isModuleFile(resolvedId) || isInNodeModules(resolvedId) || isVirtualModule(resolvedId)) {
        return null;
      }
      const cleanId = stripQuery(resolvedId);
      if (await runtime.isOwnedCssModule(cleanId)) {
        throw unsupportedCssModuleQueryError(cleanId, nonModuleQuery);
      }
      return null;
    },

    async transform(code, id) {
      if (!runtime.isActive()) return null;
      if (!isModuleFile(id) || isInNodeModules(id) || isVirtualModule(id)) return null;

      const cleanId = stripQuery(id);
      const nonModuleQuery = getNonModuleQuery(id);
      if (nonModuleQuery) {
        if (await runtime.isOwnedCssModule(cleanId)) {
          throw unsupportedCssModuleQueryError(cleanId, nonModuleQuery);
        }
        return null;
      }
      const transformed = await runtime.transformCss(cleanId, code);
      if (!transformed) return null;

      return { code: transformed, map: null };
    },

    async buildStart() {
      await runtime.handleBuildStart();
    },

    async hotUpdate(context) {
      return runtime.handleHotUpdate(context);
    },
  };

  return [cssPlugin];
}

export type {
  BemGlobalScopeOptions,
  BemModulesOptions,
  BemProjectOptions,
  ModifierOutput,
  BemNamingOptions,
  BemOutputSeparator,
  WordCase,
} from "./types.js";

export { isBemGlobalClassName } from "./global-scope.js";
