#!/usr/bin/env node
/* global console, process */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { generate } from "./generate-file-capabilities.mjs";

const root = resolve(import.meta.dirname, "../..");
const failures = [];
try { generate({ check: true }); } catch (error) { failures.push(String(error)); }
for (const fixture of ["invalid-duplicate.json", "invalid-unknown-kind.json", "invalid-uppercase.json", "invalid-no-markdown-owner.json"]) {
  try { generate({ check: true, manifestPath: resolve(root, "test-fixtures/feature42/file-capabilities", fixture) }); failures.push(`${fixture} unexpectedly passed`); } catch { /* expected negative */ }
}
const manifest = JSON.parse(readFileSync(resolve(root, "contracts/file-capabilities.v1.json"), "utf8"));
if (manifest.directories?.visible !== true) failures.push("directories visibility contract failed");
console.log(JSON.stringify({ status: failures.length ? "fail" : "pass", version: manifest.version, failures }, null, 2));
if (failures.length) process.exitCode = 1;
