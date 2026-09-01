import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import bemModules from "../../src/index.ts";
import bemModulesConfig from "./bem-modules.config.mjs";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [bemModules(bemModulesConfig)],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    minify: false,
    lib: {
      entry: "src/main.ts",
      formats: ["es"],
      fileName: "index",
    },
  },
});
