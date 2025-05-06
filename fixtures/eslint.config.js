import tseslint from 'typescript-eslint';
import { defineConfig } from 'eslint/config';

export default defineConfig({
  plugins: {
    '@typescript-eslint': tseslint.plugin,
  },
});
