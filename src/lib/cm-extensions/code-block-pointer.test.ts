import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { baseEditorExtensions, getExtensionsForMode } from "./markdown-mode";

vi.mock("../../features/links", () => ({
  resolveWikilink: vi.fn(() => Promise.resolve(null)),
  searchLinkIndex: vi.fn(() => Promise.resolve([])),
}));

vi.mock("chart.js", () => {
  const ChartMock = vi.fn(function ChartMock(this: { destroy: () => void }) {
    this.destroy = vi.fn();
  });
  Object.assign(ChartMock, { register: vi.fn() });
  return { Chart: ChartMock, registerables: [] };
});

const CODE_DOCUMENT = "Before\n\n```javascript\nconst x = 1;\nconsole.log(x);\n```\n\nAfter";

function installJsdomTextGeometry() {
  const rect = { left: 0, right: 100, top: 0, bottom: 16, width: 100, height: 16 };
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: () => [rect],
  });
  Object.defineProperty(Range.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => rect,
  });
}

function mount() {
  installJsdomTextGeometry();
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({
    state: EditorState.create({
      doc: CODE_DOCUMENT,
      extensions: [...baseEditorExtensions, ...getExtensionsForMode("edit-render")],
    }),
    parent,
  });
  return { view, parent };
}

function renderedCodeCoordinate(view: EditorView, sourceText: string, lineNumber: number) {
  const code = view.dom.querySelector(".cm-codeblock-widget-container code");
  expect(code).not.toBeNull();
  expect(code?.textContent).toContain(sourceText);
  const renderedText = code?.textContent ?? "";
  const renderedLine = renderedText.split("\n").findIndex((line) => line.includes(sourceText));
  expect(renderedLine).toBeGreaterThanOrEqual(0);
  const rect = code?.getBoundingClientRect() ?? new DOMRect();
  const lineHeight = 16;
  return {
    code: code as HTMLElement,
    x: rect.left + 8,
    y: rect.top + (renderedLine + 0.5) * lineHeight,
    sourceLine: view.state.doc.line(lineNumber),
  };
}

function dispatchMouse(target: Element, type: string, x: number, y: number, buttons = 0) {
  target.dispatchEvent(new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button: 0,
    buttons,
  }));
}

function dispatchKey(view: EditorView, key: string, keyCode: number) {
  const event = new KeyboardEvent("keydown", { key, code: key, keyCode, which: keyCode, bubbles: true, cancelable: true });
  const before = view.state.selection.main.head;
  view.contentDOM.dispatchEvent(event);
  if (view.state.selection.main.head === before) expect(runScopeHandlers(view, event, "editor")).toBe(true);
}

describe("Feature 4.2 fenced-code ownership and pointer boundaries", () => {
  const mounted: { view: EditorView; parent: HTMLDivElement }[] = [];

  afterEach(() => {
    for (const { view, parent } of mounted.splice(0)) {
      view.destroy();
      parent.remove();
    }
  });

  it("derives a rendered-code coordinate and enters the exact source offset on click", () => {
    const mountedView = mount();
    mounted.push(mountedView);
    const { view } = mountedView;
    const target = renderedCodeCoordinate(view, "console.log", 5);
    const sourceOffset = target.sourceLine.from + "console".length;
    vi.spyOn(view, "posAtCoords").mockReturnValue(sourceOffset);

    expect(view.dom.querySelectorAll(".cm-codeblock-widget-container")).toHaveLength(1);
    expect(view.dom.querySelectorAll(".cm-codeblock-line")).toHaveLength(0);
    dispatchMouse(target.code, "mousedown", target.x, target.y);
    dispatchMouse(target.code, "mouseup", target.x, target.y);
    dispatchMouse(target.code, "click", target.x, target.y);

    expect(view.state.selection.main.head).toBe(sourceOffset);
    expect(view.dom.querySelectorAll(".cm-codeblock-widget-container")).toHaveLength(0);
    expect(view.dom.querySelectorAll(".cm-codeblock-line")).toHaveLength(4);
  });

  it("keeps drag selection and keyboard entry on real document ranges across fences", () => {
    const mountedView = mount();
    mounted.push(mountedView);
    const { view } = mountedView;
    const target = renderedCodeCoordinate(view, "console.log", 5);
    const sourceLine = target.sourceLine;
    const end = sourceLine.to;
    vi.spyOn(view, "posAtCoords").mockReturnValueOnce(sourceLine.from).mockReturnValueOnce(end);

    dispatchMouse(target.code, "mousedown", target.x, target.y, 1);
    dispatchMouse(target.code, "mousemove", target.x + 24, target.y, 1);
    dispatchMouse(target.code, "mouseup", target.x + 24, target.y);
    expect(view.state.selection.main.from).toBe(sourceLine.from);
    expect(view.state.selection.main.to).toBe(end);

    vi.spyOn(view, "coordsAtPos").mockReturnValue({ left: 0, right: 0, top: 0, bottom: 16 });
    vi.spyOn(view, "posAtCoords").mockReturnValue(sourceLine.from);
    view.dispatch({ selection: { anchor: view.state.doc.line(3).to } });
    view.focus();
    dispatchKey(view, "ArrowDown", 40);
    expect(view.state.selection.main.head).toBeGreaterThanOrEqual(view.state.doc.line(4).from);

    view.dispatch({ selection: { anchor: view.state.doc.line(4).from + 4 } });
    expect(view.state.selection.main.head).toBe(view.state.doc.line(4).from + 4);
    view.focus();
    dispatchKey(view, "Home", 36);
    expect(view.state.selection.main.head).toBeGreaterThanOrEqual(view.state.doc.line(4).from);
    expect(view.state.selection.main.head).toBeLessThanOrEqual(sourceLine.to);
    dispatchKey(view, "End", 35);
    expect(view.state.selection.main.head).toBeGreaterThanOrEqual(view.state.doc.line(4).from);
    expect(view.state.selection.main.head).toBeLessThanOrEqual(sourceLine.to);
  });

  it("owns source-line decorations and exposes no fenced-code atomic range", () => {
    const mountedView = mount();
    mounted.push(mountedView);
    const { view } = mountedView;
    const sourceLine = view.state.doc.line(5);
    view.dispatch({ selection: { anchor: sourceLine.from } });

    expect(view.dom.querySelectorAll(".cm-codeblock-widget-container")).toHaveLength(0);
    expect(view.dom.querySelectorAll(".cm-codeblock-line")).toHaveLength(4);
    let fencedFrom = -1;
    let fencedTo = -1;
    syntaxTree(view.state).iterate({
      enter(node) {
        if (node.name === "FencedCode") {
          fencedFrom = node.from;
          fencedTo = node.to;
        }
      },
    });
    expect(fencedFrom).toBeGreaterThanOrEqual(0);
    expect(fencedTo).toBeGreaterThan(fencedFrom);
    const hasFencedAtomicRange = view.state.facet(EditorView.atomicRanges).some((provider) => {
      let found = false;
      provider(view).between(fencedFrom, fencedTo, () => { found = true; });
      return found;
    });
    expect(hasFencedAtomicRange).toBe(false);
  });
});
