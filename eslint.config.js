// @ts-check
/**
 * Root ESLint flat config (ESLint 9) for the zemingengine monorepo.
 *
 * Loaded as CommonJS because the root package.json has no "type": "module".
 * All referenced plugins (@eslint/js, typescript-eslint, eslint-plugin-react,
 * eslint-plugin-react-hooks) ship CommonJS-compatible entry points.
 */
const js = require('@eslint/js');
const tseslint = require('typescript-eslint');
const reactPlugin = require('eslint-plugin-react');
const reactHooksPlugin = require('eslint-plugin-react-hooks');

module.exports = tseslint.config(
  // ---------------------------------------------------------------------------
  // Global ignores: dependencies, build output, and generated artifacts.
  // ---------------------------------------------------------------------------
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/data/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/*.d.ts',
      '**/*.map',
      // Committed build output that lives inside the shared package source.
      'packages/shared/src/*.js',
    ],
  },

  // ---------------------------------------------------------------------------
  // Base: ESLint recommended + typescript-eslint recommended.
  // ---------------------------------------------------------------------------
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // ---------------------------------------------------------------------------
  // Global language options + shared rules.
  // ES2022 / ESNext modules, matching tsconfig.base.json (target ES2022,
  // module ESNext). typescript-eslint's base config already sets the parser
  // and sourceType: 'module' globally; we only add ecmaVersion here.
  // ---------------------------------------------------------------------------
  {
    name: 'zemingengine/global',
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      // Use the TypeScript-aware variant everywhere (the TS parser is used for
      // all files) and turn off the base rule to avoid duplicate reports.
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': 'warn',
    },
  },

  // ---------------------------------------------------------------------------
  // CommonJS .js files (this config file, any *.cjs): allow Node/CommonJS
  // globals so no-undef does not flag require/module/exports.
  // ---------------------------------------------------------------------------
  {
    name: 'zemingengine/common-js',
    files: ['*.js', '**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        require: 'readonly',
        module: 'readonly',
        exports: 'writable',
        __dirname: 'readonly',
        __filename: 'readonly',
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
      },
    },
    rules: {
      // CommonJS config files legitimately use require().
      '@typescript-eslint/no-require-imports': 'off',
    },
  },

  // ---------------------------------------------------------------------------
  // ESM Node scripts (*.mjs): provide Node + platform globals so no-undef
  // does not flag process/console/fetch/etc.
  // ---------------------------------------------------------------------------
  {
    name: 'zemingengine/node-scripts',
    files: ['**/*.mjs'],
    languageOptions: {
      sourceType: 'module',
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
      },
    },
  },

  // ---------------------------------------------------------------------------
  // Server code: discourage leaving console statements in.
  // ---------------------------------------------------------------------------
  {
    name: 'zemingengine/server',
    files: ['apps/server/**/*.{js,ts}'],
    rules: {
      'no-console': 'warn',
    },
  },

  // ---------------------------------------------------------------------------
  // Web (React) app: register the React plugins and apply their recommended
  // rule sets, with modern defaults for the new JSX transform + TypeScript.
  // ---------------------------------------------------------------------------
  {
    name: 'zemingengine/web',
    files: ['apps/web/**/*.{js,jsx,ts,tsx}'],
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
    },
    languageOptions: {
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
    rules: {
      ...reactPlugin.configs.recommended.rules,
      ...reactHooksPlugin.configs.recommended.rules,
      // Not needed with the automatic JSX runtime (React 17+) and TypeScript.
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
    },
  },
);
