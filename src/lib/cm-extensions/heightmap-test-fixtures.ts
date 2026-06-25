/** Minimal repro documents for Bug #6 HeightMap bisect. */
export const REPRO_DOCS = {
  plain: "First paragraph line.\n\nSecond paragraph line.\n\nThird paragraph line.",

  heading: "# Main Heading\n\nParagraph after heading.",

  codeBlock: "Text before.\n\n```javascript\nconst x = 1;\nconsole.log(x);\n```\n\nText after.",

  chart: "Intro.\n\n```chart\ntype: bar\ndata:\n  labels: [A, B]\n  datasets:\n    - data: [1, 2]\n```\n\nOutro.",

  table: "Above table.\n\n| H1 | H2 |\n| --- | --- |\n| a | b |\n\nBelow table.",
} as const;

export type ReproDocKey = keyof typeof REPRO_DOCS;
