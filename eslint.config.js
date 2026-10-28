import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['unsynced/', 'node_modules/'] },
  js.configs.recommended,
  {
    files: ['extension/editor/**/*.js'],
    languageOptions: { globals: { ...globals.browser, chrome: 'readonly' } },
  },
  {
    files: ['extension/content/**/*.js'],
    languageOptions: { sourceType: 'script', globals: { ...globals.browser, chrome: 'readonly', doodlerFriends: 'readonly' } },
  },
  {
    files: ['*.js', 'tests/**/*.js'],
    languageOptions: { globals: globals.node },
  },
];
