import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../extension/server.js", import.meta.url), "utf8");

for (const saved of [undefined, "http://127.0.0.1:8765", "http://localhost:8765/"]) {
  test(`migrates old/default endpoint: ${saved}`, async () => {
    const storage = { readcastServer: saved };
    const context = vm.createContext({ chrome: { storage: { local: {
      get: async () => storage,
      set: async (values) => Object.assign(storage, values),
    } } } });
    vm.runInContext(source, context);
    assert.equal(await context.getReadcastServer(), "http://127.0.0.1:43827");
    if (saved) assert.equal(storage.readcastServer, "http://127.0.0.1:43827");
  });
}

test("preserves custom servers", async () => {
  for (const saved of ["http://localhost:9001", "https://example.test:8765", "http://127.0.0.1:43827"]) {
    const context = vm.createContext({ chrome: { storage: { local: {
      get: async () => ({ readcastServer: saved }),
      set: async () => assert.fail("must not rewrite custom endpoints"),
    } } } });
    vm.runInContext(source, context);
    assert.equal(await context.getReadcastServer(), saved);
  }
});

test("packaged extension matches the unpacked extension", () => {
  for (const name of ["server.js", "popup.js", "popup.html", "background.js", "manifest.json"]) {
    assert.equal(
      readFileSync(new URL(`../extension/${name}`, import.meta.url), "utf8"),
      readFileSync(new URL(`../src/readcast/web/extension/${name}`, import.meta.url), "utf8"),
    );
  }
});
