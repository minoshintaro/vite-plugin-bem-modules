import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createBemPostcssPlugin } from "../src/index.js";
import { createBemRuntime } from "../src/runtime.js";

test("watcher unlinkのcleanup失敗をloggerへ報告し、同期throwとrejectをunhandledにしない", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bem-modules-runtime-"));
  try {
    const postcssPlugin = createBemPostcssPlugin({ types: true });
    const runtime = createBemRuntime({ types: true });
    runtime.configResolved({
      root,
      css: {
        transformer: "postcss",
        modules: {},
        postcss: { plugins: [postcssPlugin] },
      },
    } as never);

    const messages: string[] = [];
    let onAll: ((event: string, file: string) => void) | undefined;
    runtime.configureServer({
      config: {
        root,
        logger: { error(message: string) { messages.push(message); } },
      },
      watcher: {
        add() {},
        on(event: string, listener: (event: string, file: string) => void) {
          if (event === "all") onAll = listener;
        },
      },
    } as never);
    assert.ok(onAll);

    const syncFile = path.join(root, "Sync.module.css");
    const asyncFile = path.join(root, "Async.module.css");
    const syncError = new Error("sync cleanup failure");
    const asyncError = new Error("async cleanup failure");
    postcssPlugin.cleanup = (filePath) => {
      if (filePath === syncFile) throw syncError;
      return Promise.reject(asyncError);
    };

    onAll("unlink", syncFile);
    onAll("unlink", asyncFile);
    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.equal(messages.length, 2);
    assert.ok(messages.some((message) => message.includes(syncFile) && message.includes(syncError.message)));
    assert.ok(messages.some((message) => message.includes(asyncFile) && message.includes(asyncError.message)));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
