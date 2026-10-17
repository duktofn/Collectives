import type { CodeColors, ThemeColors } from '../types';

export const codeColorFields = [
  {
    key: 'text',
    label: 'Code text',
    example: 'Punctuation and operators',
    variable: '--syntax-text',
    dark: '#e6e3dd',
    light: '#191919',
  },
  {
    key: 'background',
    label: 'Code background',
    example: 'Code blocks and source files',
    variable: '--syntax-background',
    dark: '#22201e',
    light: '#f4f1ea',
  },
  {
    key: 'keyword',
    label: 'Keywords',
    example: 'if, return, class, match, def',
    variable: '--syntax-keyword',
    dark: '#d798c6',
    light: '#8a286b',
  },
  {
    key: 'modifier',
    label: 'Modifiers',
    example: 'public, private, static, const, mut',
    variable: '--syntax-modifier',
    dark: '#e891bd',
    light: '#813994',
  },
  {
    key: 'type',
    label: 'Types',
    example: 'int, String, Vec, class and struct names',
    variable: '--syntax-type',
    dark: '#7fbfdf',
    light: '#185c88',
  },
  {
    key: 'function',
    label: 'Functions / Methods',
    example: 'main(), Awake(), validate()',
    variable: '--syntax-function',
    dark: '#e5c07b',
    light: '#795514',
  },
  {
    key: 'variable',
    label: 'Variables / Parameters',
    example: 'count, value, arguments',
    variable: '--syntax-variable',
    dark: '#c2a7ec',
    light: '#6b3999',
  },
  {
    key: 'property',
    label: 'Fields / Properties',
    example: 'self.name, this.count, JSON keys',
    variable: '--syntax-property',
    dark: '#b5c5ec',
    light: '#355b96',
  },
  {
    key: 'string',
    label: 'Strings / Characters',
    example: '"Hello", \'a\', multiline strings',
    variable: '--syntax-string',
    dark: '#a8c97b',
    light: '#3b6622',
  },
  {
    key: 'number',
    label: 'Numbers / Constants',
    example: '42, 3.14, true, null, None',
    variable: '--syntax-number',
    dark: '#e8b86e',
    light: '#8f540f',
  },
  {
    key: 'comment',
    label: 'Comments',
    example: '// comment, # comment, documentation',
    variable: '--syntax-comment',
    dark: '#a4a098',
    light: '#6d6a65',
  },
  {
    key: 'annotation',
    label: 'Annotations / Attributes',
    example: '@Override, [SerializeField], #[derive], @staticmethod',
    variable: '--syntax-annotation',
    dark: '#d6bc80',
    light: '#806015',
  },
  {
    key: 'macro',
    label: 'Macros / Preprocessor',
    example: '#include, #define, println!',
    variable: '--syntax-macro',
    dark: '#76c7ba',
    light: '#17695e',
  },
  {
    key: 'lineNumber',
    label: 'Line numbers',
    example: 'Gutter text',
    variable: '--syntax-line-number',
    dark: '#a39f96',
    light: '#706b64',
  },
  {
    key: 'activeLineNumber',
    label: 'Active line number',
    example: 'Uses Accent when left at default',
    variable: '--syntax-active-line-number',
    dark: '#e57e54',
    light: '#c44e24',
  },
] as const satisfies readonly {
  key: keyof CodeColors;
  label: string;
  example: string;
  variable: string;
  dark: string;
  light: string;
}[];

export const themeColorFields = [
  {
    key: 'background',
    label: 'Background',
    example: 'Main app canvas',
    variable: '--bg-primary',
    dark: '#191816',
    light: '#fbfaf8',
  },
  {
    key: 'surface',
    label: 'Surface',
    example: 'Sidebar, cards, panels',
    variable: '--bg-secondary',
    dark: '#22201e',
    light: '#f4f1ea',
  },
  {
    key: 'border',
    label: 'Border',
    example: 'Dividers and control outlines',
    variable: '--color-border',
    dark: '#33312e',
    light: '#e6e2d8',
  },
  {
    key: 'text',
    label: 'Interface text',
    example: 'Buttons, labels, menus',
    variable: '--color-text-primary',
    dark: '#e6e3dd',
    light: '#191919',
  },
  {
    key: 'secondaryText',
    label: 'Secondary text',
    example: 'Hints and secondary labels',
    variable: '--color-text-secondary',
    dark: '#a39f96',
    light: '#706b64',
  },
  {
    key: 'hover',
    label: 'Hover',
    example: 'Hovered controls and rows',
    variable: '--bg-hover',
    dark: '#252422',
    light: '#f1f0ee',
  },
  {
    key: 'active',
    label: 'Active surface',
    example: 'Selected controls and rows',
    variable: '--bg-active',
    dark: '#2d2b27',
    light: '#eae6db',
  },
] as const satisfies readonly {
  key: keyof ThemeColors;
  label: string;
  example: string;
  variable: string;
  dark: string;
  light: string;
}[];

export function defaultCodeColors(dark: boolean): Required<CodeColors> {
  return Object.fromEntries(
    codeColorFields.map((field) => [field.key, dark ? field.dark : field.light])
  ) as Required<CodeColors>;
}

export function codeColorVariables(colors: CodeColors | null | undefined): Record<string, string> {
  return Object.fromEntries(
    codeColorFields
      .filter((field) => colors?.[field.key])
      .map((field) => [field.variable, colors![field.key]!])
  );
}
