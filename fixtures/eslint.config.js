import tseslint from 'typescript-eslint';
import { defineConfig } from 'eslint/config';

export default defineConfig({
  files: ['**/*.js', '**/*.ts'],
  plugins: {
    '@typescript-eslint': tseslint.plugin,
  },
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: {
      project: false,
    },
  },
});
