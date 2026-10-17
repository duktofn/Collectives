import { createEffect, createSignal, For, on, onCleanup, onMount } from 'solid-js';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
  codeSyntaxHighlighting,
  sourceCodeExtensions,
} from '../../lib/cm-extensions/code-presentation';

const samples = [
  {
    name: 'Java',
    file: 'Sample.java',
    text: '// Java\npublic final class Sample {\n  private int count = 42;\n  @Override\n  public String toString() {\n    return "Count: " + count;\n  }\n}',
  },
  {
    name: 'C#',
    file: 'Sample.cs',
    text: '// C#\npublic class Sample {\n  [SerializeField] private int _count = 42;\n  public string Name { get; private set; }\n  private void Awake() {\n    var message = "Hello";\n    Debug.Log(message);\n  }\n}',
  },
  {
    name: 'C++',
    file: 'sample.cpp',
    text: '#include <string>\n// C++\nclass Sample {\nprivate:\n  int count = 42;\npublic:\n  [[nodiscard]] std::string name() const {\n    return "Hello";\n  }\n};',
  },
  {
    name: 'Rust',
    file: 'sample.rs',
    text: '// Rust\n#[derive(Debug)]\npub struct Sample { count: i32 }\nfn main() {\n  let mut count: i32 = 42;\n  if count > 0 {\n    println!("Hello {}", count);\n  }\n}',
  },
  {
    name: 'Python',
    file: 'sample.py',
    text: '# Python\nclass Sample:\n    @staticmethod\n    def greet(count: int = 42) -> str:\n        message = "Hello"\n        if count > 0:\n            return message\n        return None',
  },
];

export function CodeThemePreview() {
  const [language, setLanguage] = createSignal(samples[1]);
  let host: HTMLDivElement | undefined;
  let view: EditorView | undefined;
  const previewState = () =>
    EditorState.create({
      doc: language().text,
      extensions: [
        sourceCodeExtensions(language().file),
        codeSyntaxHighlighting,
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        EditorView.contentAttributes.of({ 'aria-label': `${language().name} color preview` }),
        EditorView.theme({
          '&': { fontSize: '12px', height: '210px' },
          '.cm-content': { padding: '8px 0', lineHeight: '1.6' },
          '.cm-scroller': { fontFamily: 'var(--font-mono)', overflow: 'auto' },
        }),
      ],
    });
  onMount(() => {
    view = new EditorView({ state: previewState(), parent: host });
  });
  createEffect(on(language, () => view?.setState(previewState()), { defer: true }));
  onCleanup(() => view?.destroy());
  return (
    <div class="code-theme-preview">
      <div class="appearance-preview-languages" aria-label="Preview language">
        <For each={samples}>
          {(sample) => (
            <button
              type="button"
              aria-pressed={language() === sample}
              onClick={() => setLanguage(sample)}
            >
              {sample.name}
            </button>
          )}
        </For>
      </div>
      <div ref={host} />
    </div>
  );
}
