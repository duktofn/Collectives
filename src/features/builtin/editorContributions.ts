import { autocompletion, type CompletionSource } from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { blockRefDecorationExtension, blockRefExtension } from "../../lib/cm-extensions/block-ref";
import { chartWidgetExtension } from "../../lib/cm-extensions/chart-widget";
import { wikilinkCompletionSource } from "../../lib/cm-extensions/wikilink-autocomplete";
import { wikilinkDecorationExtension } from "../../lib/cm-extensions/wikilink-decoration";
import { slashTemplateCompletionSource } from "../../lib/cm-extensions/slash-template-autocomplete";
import {
  installEditorCommandHandlers,
  type MarkdownTemplate,
} from "../../lib/editorCommands";
import type { EditorMode } from "../../types";

export type BuiltinEditorContributionId =
  | "chart"
  | "note-links"
  | "block-references"
  | "fixed-templates"
  | "editor-commands";

export interface BuiltinEditorContributionContext {
  currentView: () => EditorView | null;
  currentSessionKey: () => string;
  isCurrent: (view: EditorView, sessionKey: string) => boolean;
  isWritable: (view: EditorView, sessionKey: string) => boolean;
  insertMarkdownTemplate: (view: EditorView, sessionKey: string, template: MarkdownTemplate) => boolean;
  formatDocument: (view: EditorView, sessionKey: string) => Promise<boolean>;
}

interface BuiltinEditorContribution {
  readonly id: BuiltinEditorContributionId;
  readonly extensions?: Partial<Record<EditorMode, readonly Extension[]>>;
  readonly completionSources?: Partial<Record<EditorMode, readonly CompletionSource[]>>;
  readonly install?: (context: BuiltinEditorContributionContext) => () => void;
}

const editorCommandContribution: BuiltinEditorContribution = {
  id: "editor-commands",
  install(context) {
    const currentWritableView = () => {
      const view = context.currentView();
      const sessionKey = context.currentSessionKey();
      if (!view || !context.isCurrent(view, sessionKey) || !context.isWritable(view, sessionKey)) return null;
      return { view, sessionKey };
    };

    return installEditorCommandHandlers({
      insertMarkdownTemplate(template) {
        const active = currentWritableView();
        return active
          ? context.insertMarkdownTemplate(active.view, active.sessionKey, template)
          : false;
      },
      formatDocument() {
        const active = currentWritableView();
        return active
          ? context.formatDocument(active.view, active.sessionKey)
          : Promise.resolve(false);
      },
    });
  },
};

const trustedBuiltinEditorContributions: readonly BuiltinEditorContribution[] = [
  {
    id: "chart",
    extensions: {
      view: [chartWidgetExtension],
      "edit-render": [chartWidgetExtension],
    },
  },
  {
    id: "note-links",
    extensions: {
      view: [wikilinkDecorationExtension],
      "edit-render": [wikilinkDecorationExtension],
    },
    completionSources: {
      "edit-render": [wikilinkCompletionSource],
    },
  },
  {
    id: "block-references",
    extensions: {
      view: [blockRefDecorationExtension],
      "edit-render": [blockRefExtension],
    },
  },
  {
    id: "fixed-templates",
    completionSources: {
      "edit-source": [slashTemplateCompletionSource],
      "edit-render": [slashTemplateCompletionSource],
    },
  },
  editorCommandContribution,
];

const completionExtensions = new Map<EditorMode, Extension>();
for (const mode of ["view", "edit-source", "edit-render"] satisfies EditorMode[]) {
  const sources = trustedBuiltinEditorContributions.flatMap((contribution) =>
    contribution.completionSources?.[mode] ?? []
  );
  if (sources.length > 0) {
    completionExtensions.set(mode, autocompletion({
      override: sources,
      activateOnTyping: true,
      interactionDelay: 0,
    }));
  }
}

export function getBuiltinEditorContributionExtensions(
  contributionId: BuiltinEditorContributionId,
  mode: EditorMode,
): Extension[] {
  const contribution = trustedBuiltinEditorContributions.find((entry) => entry.id === contributionId);
  return [...(contribution?.extensions?.[mode] ?? [])];
}

export function getBuiltinEditorCompletionExtension(mode: EditorMode): Extension | undefined {
  return completionExtensions.get(mode);
}

export function installBuiltinEditorContributions(
  context: BuiltinEditorContributionContext,
): () => void {
  const disposers: Array<() => void> = [];
  try {
    for (const contribution of trustedBuiltinEditorContributions) {
      const dispose = contribution.install?.(context);
      if (dispose) disposers.push(dispose);
    }
  } catch (error) {
    for (const dispose of disposers.reverse()) dispose();
    throw error;
  }

  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    for (const dispose of disposers.reverse()) dispose();
  };
}
