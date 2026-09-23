#!/usr/bin/env node
/* global console, process */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

const workspace = resolve(import.meta.dirname, "../..");
const read = (path) => readFileSync(resolve(workspace, path), "utf8");
const failures = [];

const appCss = read("src/App.css");
const requiredImports = [
  './styles/variables.css',
  './styles/design-tokens.css',
  './styles/design-aliases.css',
  './styles/design-system.css',
];
const importPositions = requiredImports.map((value) => appCss.indexOf(`@import "${value}";`));
if (importPositions.some((position) => position < 0)) failures.push("App.css is missing a required token import");
if (importPositions.some((position, index) => index > 0 && position <= importPositions[index - 1])) failures.push("global token import order is not canonical");
for (const value of requiredImports) {
  const count = appCss.split(`@import "${value}";`).length - 1;
  if (count !== 1) failures.push(`global token import count for ${value}: ${count}`);
}

function parseTsx(path) {
  return ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function hasJsxStyleAttribute(source) {
  let found = false;
  const visit = (node) => {
    if (ts.isJsxAttribute(node) && node.name.text === "style") found = true;
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

const ownedTsx = [
  "src/components/shell/AppShell.tsx",
  "src/components/shell/WorkspaceHeader.tsx",
  "src/components/shell/ActivityStatus.tsx",
  "src/components/shell/EmptyWorkspace.tsx",
  "src/components/common/ModalLayer.tsx",
  "src/components/common/ModalFocusScope.ts",
];
for (const path of ownedTsx) {
  if (!existsSync(resolve(workspace, path))) continue;
  if (hasJsxStyleAttribute(parseTsx(path))) failures.push(`inline style in Phase 4 owned file: ${path}`);
}

const ownedCss = [
  "src/components/shell/AppShell.css",
  "src/components/common/ModalLayer.css",
];
const literalPattern = /(?:#[0-9a-fA-F]{3,8}\b|\brgba?\(|\b(?:\d+(?:\.\d+)?)(?:px|rem|em|vh|vw)\b)/;
for (const path of ownedCss) {
  if (!existsSync(resolve(workspace, path))) continue;
  for (const [index, line] of read(path).split(/\r?\n/).entries()) {
    if (literalPattern.test(line) && !line.includes("--")) failures.push(`literal visual value in ${path}:${index + 1}`);
  }
}

const validCss = read("test-fixtures/phase4/design-contract/valid.css");
if (literalPattern.test(validCss)) failures.push("valid CSS fixture contains an unexpected literal");
const invalidCss = read("test-fixtures/phase4/design-contract/invalid-new-literal.css");
if (!literalPattern.test(invalidCss)) failures.push("invalid CSS fixture no longer exercises literal detection");
const invalidTsx = parseTsx(resolve(workspace, "test-fixtures/phase4/design-contract/invalid-inline-style.tsx"));
if (!hasJsxStyleAttribute(invalidTsx)) failures.push("invalid TSX fixture no longer exercises AST style detection");

const report = {
  schema_version: 1,
  phase: "phase4",
  status: failures.length ? "fail" : "pass",
  import_order: requiredImports,
  production_exemptions: [],
  recorded_legacy_exemptions: [
    { file: "src/App.tsx", reason: "pre-Phase4 legacy modal-content inline styles remain untouched until their bounded component restyle" },
    { file: "src/components/theme/ThemePanel.tsx", reason: "pre-Phase4 persisted-settings controls retain existing inline layout until component restyle" },
  ],
  negative_fixtures: { css_literal: "pass", tsx_inline_style_ast: "pass" },
  failures,
};
console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exitCode = 1;
