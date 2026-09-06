import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import angular from 'angular-eslint';

/**
 * Lint for the Angular app.
 *
 * The rules worth having here are the Angular ones rather than the generic
 * TypeScript ones: selector prefixes, lifecycle mistakes, and the template
 * checks that catch a binding no compiler sees until the page renders.
 *
 * Component and directive selectors are held to the `eh` prefix the codebase
 * already uses everywhere, so a stray `app-` from a generator is caught rather
 * than quietly establishing a second convention.
 */
export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', '.angular/**', 'coverage/**'],
  },
  {
    files: ['**/*.ts'],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
      ...angular.configs.tsRecommended,
    ],
    processor: angular.processInlineTemplates,
    rules: {
      '@angular-eslint/directive-selector': [
        'error',
        { type: 'attribute', prefix: 'eh', style: 'camelCase' },
      ],
      '@angular-eslint/component-selector': [
        'error',
        { type: 'element', prefix: 'eh', style: 'kebab-case' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // The bootstrap component is the one exception to the prefix: index.html
    // hardcodes <app-root>, and renaming the selector to match a lint rule
    // would mean editing the host page to satisfy a convention that exists for
    // feature components.
    files: ['src/app/app.ts'],
    rules: { '@angular-eslint/component-selector': 'off' },
  },
  {
    // Inline templates are extracted by the processor above and linted here.
    files: ['**/*.html'],
    extends: [
      ...angular.configs.templateRecommended,
      ...angular.configs.templateAccessibility,
    ],
    rules: {},
  },
);
