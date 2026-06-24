import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import solidPlugin from 'eslint-plugin-solid';

export default tseslint.config(
  {
    ignores: ['dist/**', 'src-tauri/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      solid: solidPlugin,
    },
    languageOptions: {
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    rules: {
      ...solidPlugin.configs.recommended.rules,
      "@typescript-eslint/no-explicit-any": "off",
      "solid/reactivity": "off",
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { "argsIgnorePattern": "^_" }]
    },
  }
);
