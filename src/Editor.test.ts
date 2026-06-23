import { describe, it, expect, vi, beforeEach } from "vitest";
import { EditorState } from "@codemirror/state";
import { getExtensionsForMode } from "./lib/cm-extensions/markdown-mode";
import { getFootnoteDefinitions } from "./lib/cm-extensions/annotation";
import { editorStore } from "./stores/editor";
import * as yaml from "js-yaml";

// Mock Tauri APIs
vi.mock("./lib/tauri", () => {
  return {
    readFile: vi.fn((path: string) => {
      if (path === "valid.md") return Promise.resolve("Hello **world**\n[^note]: Hello Annotation");
      return Promise.reject("File not found");
    }),
    writeFile: vi.fn(() => Promise.resolve()),
  };
});

describe("CodeMirror Mode Extensions", () => {
  it("should create EditorState for different modes correctly", () => {
    const doc = "Hello **world**";
    
    // Test Edit-Source mode
    const sourceState = EditorState.create({
      doc,
      extensions: getExtensionsForMode("edit-source"),
    });
    expect(sourceState.readOnly).toBe(false);

    // Test Edit-Render mode
    const renderState = EditorState.create({
      doc,
      extensions: getExtensionsForMode("edit-render"),
    });
    expect(renderState.readOnly).toBe(false);

    // Test View mode
    const viewState = EditorState.create({
      doc,
      extensions: getExtensionsForMode("view"),
    });
    expect(viewState.readOnly).toBe(true);
  });
});

describe("Chart YAML Parsing", () => {
  it("should parse valid Chart spec correctly", () => {
    const spec = `
type: bar
data:
  labels: [A, B]
  datasets:
    - data: [1, 2]
`;
    const config = yaml.load(spec) as any;
    expect(config.type).toBe("bar");
    expect(config.data.labels).toEqual(["A", "B"]);
    expect(config.data.datasets[0].data).toEqual([1, 2]);
  });

  it("should fail gracefully on invalid YAML spec", () => {
    const spec = `
type: bar
data:
  labels: [A, B
  datasets:
    - data: [1, 2]
`;
    expect(() => yaml.load(spec)).toThrow();
  });
});

describe("Footnotes Annotation Parsing", () => {
  it("should extract footnote definitions from Text document correctly", () => {
    const state = EditorState.create({
      doc: "Some content [^note1]\n\n[^note1]: My footnote explanation\n[^note2]: Other one",
    });
    const defs = getFootnoteDefinitions(state.doc);
    
    expect(defs["note1"]).toBeDefined();
    expect(defs["note1"].content).toBe("My footnote explanation");
    expect(defs["note1"].line).toBe(3);

    expect(defs["note2"]).toBeDefined();
    expect(defs["note2"].content).toBe("Other one");
    expect(defs["note2"].line).toBe(4);
  });
});

describe("Editor Store State Management", () => {
  beforeEach(() => {
    editorStore.closeFile();
  });

  it("should open file and populate state", async () => {
    await editorStore.openFile("valid.md");
    expect(editorStore.state.openFilePath).toBe("valid.md");
    expect(editorStore.state.openFileContent).toBe("Hello **world**\n[^note]: Hello Annotation");
    expect(editorStore.state.isDirty).toBe(false);
    expect(editorStore.state.isReadOnly).toBe(false);
  });

  it("should set read-only file mode to view", async () => {
    await editorStore.openFile("valid.md", true);
    expect(editorStore.state.isReadOnly).toBe(true);
    expect(editorStore.state.mode).toBe("view");
  });

  it("should mark dirty when content changes", async () => {
    await editorStore.openFile("valid.md");
    editorStore.updateContent("modified");
    expect(editorStore.state.currentContent).toBe("modified");
    expect(editorStore.state.isDirty).toBe(true);
  });

  it("should clear dirty flag after save", async () => {
    await editorStore.openFile("valid.md");
    editorStore.updateContent("modified");
    expect(editorStore.state.isDirty).toBe(true);
    
    await editorStore.saveFile();
    expect(editorStore.state.isDirty).toBe(false);
    expect(editorStore.state.openFileContent).toBe("modified");
  });
});
