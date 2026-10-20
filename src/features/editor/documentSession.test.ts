import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDocumentSession } from "./documentSession";
import * as api from "./index";

vi.mock("./index", () => ({
  readFile: vi.fn(async (path: string) => ({ content: `disk:${path}`, versionToken: `token:${path}` })),
  writeFile: vi.fn(async () => ({ versionToken: "saved" })),
  createFile: vi.fn(),
  asSafetyError: vi.fn(() => null),
}));

const session = () => {
  let selected: string | null = null;
  return createDocumentSession({ selectedEntryId: () => selected, selectEntry: (id) => { selected = id; } });
};

beforeEach(() => { vi.clearAllMocks(); });

describe("document session ownership", () => {
  it("isolates live readers, save queues and selection across independent sessions", async () => {
    const a = session();
    const b = session();
    await a.openFile("a.md");
    await b.openFile("b.md");
    a.registerCurrentContentReader(() => "draft A");
    b.registerCurrentContentReader(() => "draft B");
    a.markContentChanged();
    b.markContentChanged();
    await Promise.all([a.saveFile(), b.saveFile()]);
    expect(api.writeFile).toHaveBeenCalledWith("a.md", "draft A", { kind: "version", token: "token:a.md" });
    expect(api.writeFile).toHaveBeenCalledWith("b.md", "draft B", { kind: "version", token: "token:b.md" });
    expect(a.state.currentContent).toBe("draft A");
    expect(b.state.currentContent).toBe("draft B");
    await a.selectEntry("a");
    await b.selectEntry("b");
    expect(a.sessionKey).not.toBe(b.sessionKey);
  });

  it("rejects a delayed read after a newer document open commits", async () => {
    const current = session();
    let resolve!: (snapshot: { content: string; versionToken: string }) => void;
    vi.mocked(api.readFile).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const older = current.openFile("a.md");
    expect(await current.openFile("b.md")).toBe(true);
    resolve({ content: "late A", versionToken: "late" });
    expect(await older).toBe(false);
    expect(current.state.openFilePath).toBe("b.md");
    expect(current.state.currentContent).toBe("disk:b.md");
  });

  it("keeps the active draft when a save barrier fails", async () => {
    const current = session();
    await current.openFile("a.md");
    await current.selectEntry("a");
    current.updateContent("unsaved A");
    vi.mocked(api.writeFile).mockRejectedValueOnce(new Error("disk full"));
    expect(await current.selectEntry("b")).toBe(false);
    expect(current.state.openFilePath).toBe("a.md");
    expect(current.state.currentContent).toBe("unsaved A");
    expect(current.state.isDirty).toBe(true);
  });
});
