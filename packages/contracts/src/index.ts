/**
 * Shared contracts between apps/web (Angular) and apps/api (NestJS).
 *
 * Consumed as a normal npm `file:` dependency (@eventhub/contracts) rather than
 * through a TypeScript path alias. Path aliases are not rewritten by tsc, so an
 * ESM build would emit a bare "@contracts" specifier that Node cannot resolve.
 * A real package keeps runtime resolution ordinary - and it is plain npm, not
 * monorepo tooling.
 *
 * ESM requires explicit file extensions on relative specifiers.
 */
export * from './enums.js';
export * from './common.js';
export * from './auth.js';
export * from './events.js';
