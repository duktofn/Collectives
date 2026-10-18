import { syntaxTree } from '@codemirror/language';
import {
  EditorState,
  Extension,
  RangeSetBuilder,
  StateEffect,
  StateField,
} from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, ViewPlugin, WidgetType } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import { editorModeFacet } from './facet';
import { announcer } from '../../a11y/announcer';

const languageCopyTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

export function isChartFencedCode(state: EditorState, nodeFrom: number): boolean {
  return /^ {0,3}(?:`{3,}|~{3,})chart\s*$/.test(state.doc.lineAt(nodeFrom).text);
}

function fencedCodeAt(state: EditorState, head: number): { from: number; to: number } | null {
  const tree = syntaxTree(state);
  for (const side of [-1, 1] as const) {
    let node: SyntaxNode | null = tree.resolveInner(head, side);
    while (node) {
      if (node.name === 'FencedCode' && head >= node.from && head <= node.to) {
        return { from: node.from, to: node.to };
      }
      node = node.parent;
    }
  }
  return null;
}

export function isCursorInFencedCode(state: EditorState, head: number): boolean {
  return fencedCodeAt(state, head) !== null;
}

function closingFence(line: string, marker: string): boolean {
  const escaped = marker[0] === '`' ? '`' : '~';
  const match = line.match(/^ {0,3}(`+|~+)\s*$/);
  return Boolean(match && match[1][0] === escaped && match[1].length >= marker.length);
}

function activeFencePositions(state: EditorState): number[] {
  if (state.facet(editorModeFacet) !== 'edit-render') return [];
  const positions = new Set<number>();
  for (const range of state.selection.ranges) {
    for (const position of [range.anchor, range.head]) {
      const block = fencedCodeAt(state, position);
      if (block && !isChartFencedCode(state, block.from)) positions.add(block.from);
    }
  }
  return Array.from(positions).sort((a, b) => a - b);
}

class HiddenFenceWidget extends WidgetType {
  eq() {
    return true;
  }
  get estimatedHeight() {
    return 0;
  }
  toDOM() {
    const element = document.createElement('div');
    element.className = 'cm-codeblock-fence-placeholder';
    element.setAttribute('aria-hidden', 'true');
    return element;
  }
}

class CodeLanguageWidget extends WidgetType {
  constructor(readonly language: string) {
    super();
  }

  eq(other: CodeLanguageWidget) {
    return this.language === other.language;
  }

  get estimatedHeight() {
    return 28;
  }

  toDOM(view: EditorView) {
    const names: Record<string, string> = {
      cpp: 'C++',
      'c++': 'C++',
      cxx: 'C++',
      cc: 'C++',
      csharp: 'C#',
      'c#': 'C#',
      cs: 'C#',
      c: 'C',
      json: 'JSON',
      jsonc: 'JSONC',
      text: 'Text',
      txt: 'Text',
      plaintext: 'Text',
      plain: 'Text',
      js: 'JavaScript',
      javascript: 'JavaScript',
      jsx: 'JSX',
      ts: 'TypeScript',
      typescript: 'TypeScript',
      tsx: 'TSX',
      py: 'Python',
      python: 'Python',
      rs: 'Rust',
      rust: 'Rust',
      html: 'HTML',
      css: 'CSS',
      sql: 'SQL',
      yaml: 'YAML',
      yml: 'YAML',
      sh: 'Shell',
      shell: 'Shell',
      bash: 'Bash',
      md: 'Markdown',
      markdown: 'Markdown',
      java: 'Java',
      go: 'Go',
    };
    const label = names[this.language.toLowerCase()] ?? (this.language || 'Text');
    const header = document.createElement('div');
    header.className = 'cm-codeblock-language-header';
    header.dataset.language = this.language || 'text';
    const badge = document.createElement('button');
    badge.type = 'button';
    badge.className = 'cm-codeblock-language-name';
    badge.textContent = label;
    badge.title = 'Copy code';
    badge.setAttribute('aria-label', `Copy ${label} code to clipboard`);
    badge.addEventListener('pointerdown', (event) => event.stopPropagation());
    badge.addEventListener('mousedown', (event) => event.preventDefault());
    let attempts = 0;
    badge.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (badge.disabled) return;
      const timer = languageCopyTimers.get(header);
      if (timer !== undefined) clearTimeout(timer);
      badge.disabled = true;
      void (async () => {
        try {
          // Resolve the live widget position: preceding edits can move or reuse it.
          const block = fencedCodeAt(view.state, view.posAtDOM(header));
          if (!block || !header.isConnected) throw new Error('Code block is no longer available.');
          const opening = view.state.doc.lineAt(block.from);
          const last = view.state.doc.lineAt(block.to);
          const marker = opening.text.match(/^ {0,3}(`{3,}|~{3,})/)?.[1];
          if (!marker) throw new Error('Code block fence is no longer available.');
          const from = Math.min(opening.to + 1, view.state.doc.length);
          const to = last.number > opening.number && closingFence(last.text, marker)
            ? Math.max(from, last.from - 1) : last.to;
          await navigator.clipboard.writeText(view.state.doc.sliceString(from, Math.max(from, to)));
          if (!header.isConnected) return;
          badge.textContent = 'Copied!';
          badge.title = 'Code copied';
          badge.dataset.copyState = 'success';
          announcer.polite('Code copied to clipboard.', `code-copy:${block.from}:${++attempts}`);
        } catch {
          if (!header.isConnected) return;
          badge.textContent = 'Copy failed';
          badge.title = 'Could not copy code. Click to retry.';
          badge.dataset.copyState = 'error';
          announcer.alert('Could not copy code to the clipboard.', `code-copy-error:${++attempts}`);
        } finally {
          badge.disabled = false;
          if (header.isConnected) languageCopyTimers.set(header, setTimeout(() => {
            badge.textContent = label;
            badge.title = 'Copy code';
            delete badge.dataset.copyState;
            languageCopyTimers.delete(header);
          }, 1500));
        }
      })();
    });
    header.appendChild(badge);
    return header;
  }

  destroy(dom: HTMLElement) {
    const timer = languageCopyTimers.get(dom);
    if (timer !== undefined) clearTimeout(timer);
    languageCopyTimers.delete(dom);
  }
}

const hiddenFence = Decoration.replace({
  block: true,
  inclusive: false,
  widget: new HiddenFenceWidget(),
});

function buildCodeBlockDecorations(
  state: EditorState,
  positions = activeFencePositions(state)
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const tree = syntaxTree(state);
  const active = new Set(positions);
  tree.iterate({
    enter(node) {
      if (node.name !== 'FencedCode' || isChartFencedCode(state, node.from)) return;

      const first = state.doc.lineAt(node.from);
      const last = state.doc.lineAt(node.to);
      const openingMatch = first.text.match(/^ {0,3}(`{3,}|~{3,})/);
      if (!openingMatch) return false;
      const marker = openingMatch[1];
      const language = first.text.slice(openingMatch[0].length).trim().split(/\s+/)[0];
      const hasClosingFence = last.number > first.number && closingFence(last.text, marker);
      const firstBodyLine = first.number + 1;
      const lastBodyLine = last.number - (hasClosingFence ? 1 : 0);
      const editing = active.has(node.from);

      for (let number = first.number; number <= last.number; number++) {
        const line = state.doc.line(number);
        const isFence = number === first.number || (hasClosingFence && number === last.number);
        if (isFence && !editing) {
          // A line class has heightRelevant=false in CodeMirror. Collapsing it
          // via CSS leaves stale hit-test heights outside the measured viewport.
          // This direct block replacement declares the hidden source line and
          // its height to the editor's height map, including its newline.
          const end = Math.min(state.doc.length, line.to + 1);
          if (end > line.from)
            builder.add(
              line.from,
              end,
              number === first.number
                ? Decoration.replace({
                    block: true,
                    inclusive: false,
                    widget: new CodeLanguageWidget(language),
                  })
                : hiddenFence
            );
          continue;
        }
        const classes = ['cm-codeblock-line'];
        if (isFence) classes.push('cm-codeblock-fence-edit');
        if (number === (editing ? first.number : firstBodyLine))
          classes.push('cm-codeblock-line-first');
        if (number === (editing ? last.number : lastBodyLine))
          classes.push('cm-codeblock-line-last');
        builder.add(line.from, line.from, Decoration.line({ class: classes.join(' ') }));
      }
      return false;
    },
  });
  return builder.finish();
}

const pointerSelectionEffect = StateEffect.define<boolean>();
const codeBlockDecorationField = StateField.define<{
  decorations: DecorationSet;
  active: number[];
  pointerSelecting: boolean;
  tree: ReturnType<typeof syntaxTree>;
}>({
  create(state) {
    const active = activeFencePositions(state);
    return {
      decorations: buildCodeBlockDecorations(state, active),
      active,
      pointerSelecting: false,
      tree: syntaxTree(state),
    };
  },
  update(value, transaction) {
    let pointerSelecting = value.pointerSelecting;
    for (const effect of transaction.effects)
      if (effect.is(pointerSelectionEffect)) pointerSelecting = effect.value;
    // Never change block height during a drag. A completed click opens the fence;
    // a range keeps the previously opened block stable while extending selection.
    const preserve = pointerSelecting || !transaction.state.selection.main.empty;
    const active =
      transaction.state.facet(editorModeFacet) !== 'edit-render'
        ? []
        : preserve && !transaction.reconfigured
          ? value.active.map((position) => transaction.changes.mapPos(position))
          : activeFencePositions(transaction.state);
    const changed = active.join(',') !== value.active.join(',');
    const tree = syntaxTree(transaction.state);
    return {
      active,
      pointerSelecting,
      tree,
      decorations:
        transaction.docChanged || transaction.reconfigured || changed || tree !== value.tree
          ? buildCodeBlockDecorations(transaction.state, active)
          : value.decorations,
    };
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});

const codePointerTracker = ViewPlugin.define(
  (view) => {
    const release = () => {
      if (view.state.field(codeBlockDecorationField).pointerSelecting)
        view.dispatch({ effects: pointerSelectionEffect.of(false) });
    };
    document.addEventListener('pointerup', release);
    document.addEventListener('pointercancel', release);
    window.addEventListener('blur', release);
    return {
      destroy() {
        document.removeEventListener('pointerup', release);
        document.removeEventListener('pointercancel', release);
        window.removeEventListener('blur', release);
      },
    };
  },
  {
    eventHandlers: {
      pointerdown(event, view) {
        if (event.button === 0) view.dispatch({ effects: pointerSelectionEffect.of(true) });
        return false;
      },
    },
  }
);

/**
 * Fenced code stays as ordinary CodeMirror text. These line decorations style
 * the body and replace the inactive opening fence with a language label. Write exposes the full
 * fence, including its language, for the block under selection. Pointer,
 * keyboard and selection stay native to CodeMirror; language buttons copy the block body.
 */
export const codeBlockWidgetExtension: Extension = [codeBlockDecorationField, codePointerTracker];
