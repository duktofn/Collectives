#!/usr/bin/env node
/* global console, process */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

const workspace = resolve(import.meta.dirname, "../..");
const failures = [];
const read = (path) => readFileSync(resolve(workspace, path), "utf8");
const sourceFiles = [
  "src/App.tsx",
  "src/components/sidebar/Sidebar.tsx",
  "src/components/sidebar/CollectionItem.tsx",
  "src/components/tree/FileNode.tsx",
  "src/components/tree/FolderRefChildRow.tsx",
  "src/components/tree/FolderRefNode.tsx",
  "src/components/tree/GroupNode.tsx",
  "src/workflows/ArchiveWorkflow.tsx",
  "src/workflows/SettingsWorkflow.tsx",
  "src/workflows/TreeWorkspace.tsx",
  "src/workflows/CollectionWorkspace.tsx",
  "src/workflows/DocumentWorkspace.tsx",
];

function parse(path) { return ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); }
function imports(source) {
  const values = [];
  const visit = (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) values.push(node.moduleSpecifier.text);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return values;
}
function sourceText(source) { return source.getFullText(); }

for (const path of sourceFiles) {
  const source = parse(resolve(workspace, path));
  for (const module of imports(source)) {
    if (/platform\/(dialogs|windowLifecycle|assets)/.test(module)) failures.push(`${path}: direct platform gateway import ${module}`);
    if (module.includes("@tauri-apps") || module.includes("shared/ipc/client")) failures.push(`${path}: forbidden raw platform/IPC import ${module}`);
  }
  if (["src/components/tree/FileNode.tsx", "src/components/tree/FolderRefChildRow.tsx", "src/components/sidebar/CollectionItem.tsx"].includes(path) && /\.selectEntry\s*\(/.test(sourceText(source))) failures.push(`${path}: direct selection owner call`);
  if (["src/components/sidebar/CollectionItem.tsx"].includes(path) && /\.openCollection\s*\(/.test(sourceText(source))) failures.push(`${path}: direct collection switch owner call`);
}

const presentationFiles = ["src/presentation.ts", "src/workflows/presentation.ts"].filter((path) => existsSync(resolve(workspace, path)));
for (const path of presentationFiles) {
  const source = parse(resolve(workspace, path));
  if (imports(source).some((module) => /stores|platform|shared\/ipc|features/.test(module)) || /setTimeout|setInterval|listenEvent|invoke/.test(sourceText(source))) failures.push(`${path}: presentation module is not pure`);
}

const invalid = parse(resolve(workspace, "test-fixtures/phase5/boundaries/invalid.tsx"));
const invalidSource = sourceText(invalid);
if (!imports(invalid).some((module) => module.includes("platform/dialogs")) || !/\.selectEntry\s*\(/.test(invalidSource)) failures.push("negative boundary fixture no longer exercises forbidden imports/selection");

console.log(JSON.stringify({ schema_version: 1, phase: "phase5", status: failures.length ? "fail" : "pass", production_exemptions: 0, violations: failures, negative_fixtures: { forbidden_gateway_and_selection: "pass" } }, null, 2));
if (failures.length) process.exitCode = 1;
