import { createSignal, onCleanup, type JSX } from 'solid-js';
import { EditorView } from '@codemirror/view';
import { selectAll } from '@codemirror/commands';
import { editorStore } from '../../stores/editor';
import {
  insertMarkdownTemplate,
  buildMarkdownTemplateTransaction,
  setMarkdownHeading,
  requestNoteContentSearch,
} from '../../lib/editorCommands';
import { ContextMenu, type ContextMenuItem } from '../common/ContextMenu';
import { EditorModeSwitcher } from './EditorModeSwitcher';
import { EditorScrollbar } from './EditorScrollbar';
import type { ChartKind } from '../../lib/charts/chartModel';

export function EditorSurface(props: {
  view: () => EditorView | undefined;
  children: JSX.Element;
}) {
  const [menu, setMenu] = createSignal<{
    x: number;
    y: number;
    view: EditorView;
    text: string;
    generation: number;
  } | null>(null);
  const [notice, setNotice] = createSignal('');
  const [pasteAvailable, setPasteAvailable] = createSignal<boolean | undefined>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(timer));
  const report = (text: string) => {
    setNotice(text);
    clearTimeout(timer);
    timer = setTimeout(() => setNotice(''), 4000);
  };
  const showMenu = (event: MouseEvent | KeyboardEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const root = props.view();
    if (!root || !(event.target instanceof HTMLElement) || !event.target.closest('.cm-editor'))
      return;
    const view = EditorView.findFromDOM(event.target) ?? root;
    if ('clientX' in event && view.state.selection.main.empty) {
      const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (position !== null) view.dispatch({ selection: { anchor: position } });
    }
    const domSelection = window.getSelection();
    const text =
      view.state.selection.ranges
        .map((range) => view.state.sliceDoc(range.from, range.to))
        .filter(Boolean)
        .join('\n') ||
      (domSelection?.anchorNode && view.dom.contains(domSelection.anchorNode)
        ? domSelection.toString()
        : '');
    const coords =
      'clientX' in event
        ? { x: event.clientX, y: event.clientY }
        : (() => {
            const bounds =
              view.coordsAtPos(view.state.selection.main.head) ?? view.dom.getBoundingClientRect();
            return { x: bounds.left, y: bounds.bottom };
          })();
    const snapshot = { ...coords, view, text, generation: editorStore.state.generation };
    setPasteAvailable(undefined);
    setMenu(snapshot);
    if (navigator.clipboard?.readText)
      void navigator.clipboard
        .readText()
        .then((value) => {
          if (menu() === snapshot) setPasteAvailable(Boolean(value));
        })
        .catch(() => {
          /* A Paste click can request clipboard permission directly. */
        });
  };
  const current = () => {
    const state = menu();
    return state?.generation === editorStore.state.generation && state.view.dom.isConnected
      ? state
      : null;
  };
  const items = (): ContextMenuItem[] => {
    const state = current();
    if (!state) return [];
    const { view, text } = state;
    const editable =
      !editorStore.state.isReadOnly &&
      !view.state.readOnly &&
      view.state.facet(EditorView.editable);
    const markdown = editable && view === props.view() && editorStore.state.fileKind === 'markdown';
    const canInsert = markdown && Boolean(buildMarkdownTemplateTransaction(view, 'table'));
    const insert = (kind: 'table' | `chart-${ChartKind}`) => {
      if (current() && !insertMarkdownTemplate(view, kind))
        report('Place the cursor in editable Markdown outside a code block.');
    };
    const clipboard = async (cut: boolean) => {
      const doc = view.state.doc,
        selection = view.state.selection,
        generation = editorStore.state.generation;
      try {
        await navigator.clipboard.writeText(text);
        if (
          cut &&
          view.dom.isConnected &&
          generation === editorStore.state.generation &&
          view.state.doc === doc &&
          view.state.selection.eq(selection) &&
          !view.state.readOnly &&
          !editorStore.state.isReadOnly
        ) {
          view.dispatch({ ...view.state.replaceSelection(''), userEvent: 'delete.cut' });
          view.focus();
        }
      } catch {
        report('Could not access the clipboard.');
      }
    };
    const paste = async () => {
      const doc = view.state.doc,
        selection = view.state.selection,
        generation = editorStore.state.generation;
      try {
        const value = await navigator.clipboard.readText();
        if (
          value &&
          view.dom.isConnected &&
          generation === editorStore.state.generation &&
          view.state.doc === doc &&
          view.state.selection.eq(selection) &&
          !view.state.readOnly &&
          !editorStore.state.isReadOnly
        ) {
          view.dispatch({ ...view.state.replaceSelection(value), userEvent: 'input.paste' });
          view.focus();
        }
      } catch {
        report('Could not access the clipboard.');
      }
    };
    return [
      {
        label: 'Search in notes',
        icon: 'search' as const,
        onClick: () => {
          requestNoteContentSearch(text.replace(/\s+/g, ' ').trim());
        },
      },
      { label: 'Copy', disabled: !text, onClick: () => void clipboard(false) },
      {
        label: 'Cut',
        disabled: !text || !editable || view.state.selection.main.empty,
        onClick: () => void clipboard(true),
      },
      {
        label: 'Paste',
        disabled: !editable || !navigator.clipboard?.readText || pasteAvailable() === false,
        onClick: () => void paste(),
      },
      {
        label: 'Select All',
        separatorBefore: true,
        onClick: () => {
          selectAll(view);
          view.focus();
        },
      },
      {
        label: 'Heading',
        separatorBefore: true,
        disabled: !canInsert,
        children: ([1, 2, 3] as const).map((level) => ({
          label: `Header ${level}`,
          onClick: () => {
            if (current()) setMarkdownHeading(view, level);
          },
        })),
      },
      { label: 'Table', disabled: !canInsert, onClick: () => insert('table') },
      {
        label: 'Chart',
        disabled: !canInsert,
        onClick: () => insert('chart-bar'),
        children: (
          [
            ['Bar', 'bar'],
            ['Line', 'line'],
            ['Area', 'area'],
            ['Pie', 'pie'],
            ['Doughnut', 'doughnut'],
          ] as const
        ).map(([label, kind]) => ({ label, onClick: () => insert(`chart-${kind}`) })),
      },
    ];
  };
  return (
    <div
      class="editor-writing-pane"
      onContextMenu={showMenu}
      onPointerDown={(event) => {
        if (event.button === 2 && !props.view()?.state.selection.main.empty) event.preventDefault();
      }}
      onKeyDown={(event) => {
        if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) showMenu(event);
      }}
    >
      {props.children}
      <EditorScrollbar view={props.view} />
      <EditorModeSwitcher />
      {notice() && (
        <div class="editor-context-notice" role="alert">
          {notice()}
        </div>
      )}
      <ContextMenu
        x={menu()?.x ?? 0}
        y={menu()?.y ?? 0}
        isOpen={Boolean(menu())}
        items={items()}
        onClose={() => setMenu(null)}
      />
    </div>
  );
}
