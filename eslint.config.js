const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  {
    ignores: [
      'node_modules/**',
      'public/js/_extracted.js',
      'scripts/extra.js',
      'scripts/assemble-frontend.js',
      'scripts/build-all.js',
      'scripts/build-modules.js',
      'scripts/extract-frontend.js',
      'scripts/split-frontend.js',
      'scripts/strip-app.js',
    ],
  },
  js.configs.recommended,
  {
    files: ['public/js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        marked: 'readonly',
      },
    },
    rules: {
      'no-redeclare': 'error',
      'no-dupe-keys': 'error',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['server.js', 'scripts/check.js', 'scripts/verify.js', 'scripts/stamp-build.js', '.cursor/hooks/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: globals.node,
    },
    rules: {
      'no-redeclare': 'error',
      'no-dupe-keys': 'error',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['server.js'],
    rules: {
      'no-control-regex': 'off',
    },
  },
];
