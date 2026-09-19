import { defineConfig } from "vite";
import { createBemPostcssPlugin } from "../parser-plugin.mjs";

const postcssOrderProbe = {
  postcssPlugin: "postcss-order-probe",
  Once(root) {
    if (root.toString().includes(":global(.p-card)")) {
      root.append({ type: "comment", text: "postcss-order-probe-after-bem" });
    }
  },
};

export default defineConfig({
  build: {
    lib: {
      entry: "src/main.js",
      formats: ["es"],
      fileName: "bundle",
    },
  },
  css: {
    modules: {
      exportGlobals: false,
    },
    postcss: {
      // The BEM parser is intentionally registered by the consumer.
      plugins: [createBemPostcssPlugin(), postcssOrderProbe],
    },
  },
});
