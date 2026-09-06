import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Lint for the API.
 *
 * Type-aware rather than syntax-only: the mistakes worth catching in a NestJS
 * service are floating promises and misused awaits, and neither is visible
 * without the type checker. That is the whole reason for the projectService
 * setting below.
 *
 * The rule set is deliberately close to the recommended baseline. A house style
 * invented alongside the linter is a style nobody has agreed to, and every rule
 * added here is one more thing a contributor has to argue with.
 */
export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'var/**', 'coverage/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Nest's decorators mean a constructor parameter is often "unused" in the
      // body while being the whole point of the line.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // A dropped promise in a request handler is a silently lost write, which
      // is the single most expensive mistake this codebase can make.
      '@typescript-eslint/no-floating-promises': 'error',
      // Off deliberately. It fires ~90 times on `doc.id as string`, which is a
      // settled idiom here for Mongoose documents: the assertion documents that
      // the virtual is a string even where inference already agrees. Rewriting
      // every call site to satisfy a rule nobody asked for would be a large
      // diff of pure noise through code that is working.
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      // Off deliberately. An async method that satisfies an async interface
      // without needing to await anything is correct - the fake payment gateway
      // and the in-memory throttle store are both that - and the alternative is
      // scattering `await Promise.resolve()` to appease a linter.
      '@typescript-eslint/require-await': 'off',
      // Off deliberately. It fires where HttpStatus constants are switched on a
      // numeric status, and where mongoose's readyState is compared to a
      // number - both idiomatic, both correct, and both made worse by the
      // casts needed to satisfy the rule.
      '@typescript-eslint/no-unsafe-enum-comparison': 'off',
    },
  },
  {
    // The e2e specs live outside the build tsconfig, so the type-aware rules
    // have no program to consult and every test file is simply unparseable.
    // They are linted for syntax and obvious mistakes instead, which is most of
    // what a test file can get wrong: the rules switched off below were the
    // type-aware ones anyway, since tests reach into internals and assert on
    // loosely typed fixtures.
    files: ['test/**/*.ts', '**/*.spec.ts'],
    extends: [tseslint.configs.disableTypeChecked],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
