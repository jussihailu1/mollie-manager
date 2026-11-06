import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

export function loadIsolated<T>(file: string, mocks: Record<string, unknown>, extras: Record<string, unknown> = {}): T {
  const exports = {};
  const code = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  runInNewContext(code, { exports, crypto, Date, Error, console, URL, URLSearchParams, Buffer, Response,
    require: (name: string) => { assert.ok(name in mocks, `Unexpected dependency: ${name}`); return mocks[name]; }, ...extras });
  return exports as T;
}
