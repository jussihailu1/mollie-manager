import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { it } from "node:test";
import { transform, transformSync } from "@esbuild-kit/core-utils";

it("the legacy tooling actually resolves a patched esbuild installation", () => {
  const projectRequire = createRequire(resolve("package.json"));
  const legacyRequire = createRequire(projectRequire.resolve("@esbuild-kit/core-utils"));
  const { version } = legacyRequire("esbuild/package.json") as { version: string };
  const [major, minor] = version.split(".").map(Number);
  assert.ok(major > 0 || minor >= 25, `GHSA-67mh-4wv8-2f99 still affects installed esbuild ${version}`);
});

// Compatibility guard for the scoped esbuild override in the legacy Drizzle
// dependency. These transforms execute only synthetic code, with no DB access.
it("legacy tooling transforms TypeScript to CommonJS with source maps", () => {
  const filename = resolve("synthetic-toolchain-fixture.ts");
  const result = transformSync("export const value: number = 42;", filename);
  const cjsModule = { exports: {} as { value?: number } };
  runInNewContext(result.code, { module: cjsModule, exports: cjsModule.exports });
  assert.equal(cjsModule.exports.value, 42);
  const map = typeof result.map === "string" ? JSON.parse(result.map) : result.map;
  assert.equal(map.version, 3);
  assert.ok(map.sources.some((source: string) => source.endsWith("synthetic-toolchain-fixture.ts")));
  assert.ok(map.mappings.length > 0);
});

it("legacy tooling transforms TypeScript ESM and preserves top-level await", async () => {
  const result = await transform(
    "const value: number = await Promise.resolve(42); export default value;",
    resolve("synthetic-toolchain-fixture.mts"),
  );
  const loaded = await import("data:text/javascript;base64," + Buffer.from(result.code).toString("base64"));
  assert.equal(loaded.default, 42);
});

it("legacy tooling preserves JSX transformation options", () => {
  const result = transformSync(
    'const h = (tag: string, props: unknown) => ({ tag, props }); export const view = <section title="fixture" />;',
    resolve("synthetic-toolchain-fixture.tsx"),
    { jsxFactory: "h", jsx: "transform" },
  );
  const cjsModule = { exports: {} as { view?: { tag: string; props: { title: string } } } };
  runInNewContext(result.code, { module: cjsModule, exports: cjsModule.exports });
  assert.equal(cjsModule.exports.view?.tag, "section");
  assert.equal(cjsModule.exports.view?.props.title, "fixture");
});

it("legacy tooling reports malformed TypeScript instead of silently accepting it", async () => {
  assert.throws(() => transformSync("const value: = ;", resolve("synthetic-invalid.ts")));
  await assert.rejects(transform("const value: = ;", resolve("synthetic-invalid.mts")));
});
