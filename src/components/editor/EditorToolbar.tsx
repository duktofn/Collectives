import { createSignal, onCleanup, Show } from "solid-js";
import { editorStore } from "../../stores/editor";
import { uiStore } from "../../stores/ui";
import { Icon } from "../common/Icon";
import { ToolbarMenu } from "../common/ToolbarMenu";
import { collectionsStore } from "../../stores/collections";
import { requestMarkdownTemplateInsert, type MarkdownTemplate } from "../../lib/editorCommands";

interface EditorToolbarProps {
  canGoBack: () => boolean;
  canGoForward: () => boolean;
  onBack: () => void;
  onForward: () => void;
}

export function EditorToolbar(props: EditorToolbarProps) {
  const [copyMessage, setCopyMessage] = createSignal("");
  let messageTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(messageTimer));
  const getFileName = () => {
    const path = editorStore.state.openFilePath;
    if (!path) return "";
    const parts = path.split(/[/\\]/);
    return parts[parts.length - 1];
  };

  const getRelativePath = () => {
    return editorStore.state.openFilePath ?? "";
  };

  const getBreadcrumb = () => {
    const path = editorStore.state.openFilePath;
    if (!path) return "";
    const parts = path.split(/[/\\]/).filter(Boolean);
    const folder = parts.slice(0, -1).slice(-2).join(" / ");
    return [collectionsStore.activeCollection()?.name, folder].filter(Boolean).join(" / ");
  };

  const copyToClipboard = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopyMessage(`${label} copied`);
      clearTimeout(messageTimer);
      messageTimer = setTimeout(() => setCopyMessage(""), 2400);
    } catch {
      setCopyMessage("Clipboard is unavailable");
    }
  };

  const insertTemplate = (template: MarkdownTemplate) => {
    if (!requestMarkdownTemplateInsert(template)) setCopyMessage("Place the cursor in editable Markdown outside a code block.");
  };

  return (
    <div class="editor-toolbar">
      <div class="editor-document-context">
        <div class="editor-navigation" aria-label="Document history">
          <button class="editor-nav-btn" type="button" aria-label="Back" title="Back (Alt+Left outside text fields)" disabled={!props.canGoBack()} onClick={() => props.onBack()}><Icon name="chevron-left" size={16} /></button>
          <button class="editor-nav-btn" type="button" aria-label="Forward" title="Forward (Alt+Right outside text fields)" disabled={!props.canGoForward()} onClick={() => props.onForward()}><Icon name="chevron-right" size={16} /></button>
        </div>
        <div class="editor-title-container">
          <div class="editor-file-details">
            <Show when={getBreadcrumb()}><span class="editor-breadcrumb" title={getBreadcrumb()}>{getBreadcrumb()}</span></Show>
            <span class="editor-file-name" title={getRelativePath()}>{getFileName().replace(/\.md$/i, "")}</span>
          </div>
          <Show when={editorStore.state.isReadOnly}><span class="badge badge-readonly">Read only</span></Show>
        </div>
      </div>
      <div class="editor-actions">
        <Show when={editorStore.state.fileKind !== "text-source"} fallback={<span class="editor-source-label">Source</span>}>
          <div class="editor-mode-selector" role="group" aria-label="Editor mode">
            <button class="mode-btn" type="button" aria-pressed={editorStore.state.mode === "view"} classList={{ active: editorStore.state.mode === "view" }} onClick={() => editorStore.setMode("view")} title="Read formatted Markdown">Read</button>
            <Show when={!editorStore.state.isReadOnly}>
              <button class="mode-btn" type="button" aria-pressed={editorStore.state.mode === "edit-render"} classList={{ active: editorStore.state.mode === "edit-render" }} onClick={() => editorStore.setMode("edit-render")} title="Write with live Markdown formatting">Write</button>
              <button class="mode-btn" type="button" aria-pressed={editorStore.state.mode === "edit-source"} classList={{ active: editorStore.state.mode === "edit-source" }} onClick={() => editorStore.setMode("edit-source")} title="Edit Markdown source">Source</button>
            </Show>
          </div>
        </Show>
        <div class="editor-secondary-actions">
          <Show when={!editorStore.state.isReadOnly && editorStore.state.fileKind === "markdown" && editorStore.state.mode !== "view"}>
            <ToolbarMenu label="Insert Markdown template" class="editor-template-btn" trigger={<><Icon name="plus" size={16} /><span>Insert</span></>}
              items={[
                { label: "Heading", onSelect: () => insertTemplate("heading") },
                { label: "Checklist item", onSelect: () => insertTemplate("checklist") },
                { label: "Table", onSelect: () => insertTemplate("table") },
                { label: "Code block", onSelect: () => insertTemplate("code") },
                { label: "Chart block", onSelect: () => insertTemplate("chart") },
              ]} />
          </Show>
          <Show when={editorStore.state.fileKind === "markdown"}>
            <button class="editor-reference-toggle" type="button" aria-label="Outline and backlinks" title="Outline and backlinks" aria-expanded={uiStore.state.isReferencePanelOpen} onClick={() => uiStore.toggleReferencePanel()}><Icon name="list" size={17} /></button>
          </Show>
          <ToolbarMenu label="More note actions" trigger={<Icon name="more" size={18} />}
            items={[
              { label: "Copy path", onSelect: () => void copyToClipboard(getRelativePath(), "Path") },
              { label: "Copy WikiLink", onSelect: () => void copyToClipboard(`[[${editorStore.currentFileName ?? ""}]]`, "WikiLink") },
            ]} />
        </div>
      </div>
      <Show when={copyMessage()}><span class="editor-copy-toast" role="status">{copyMessage()}</span></Show>
    </div>
  );
}
