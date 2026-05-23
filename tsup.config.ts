import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    cli: 'src/cli.ts',
    index: 'src/index.ts',
  },
  format: ['esm'],
  // Matches package.json engines (>=20.6 for process.loadEnvFile).
  target: 'node20',
  dts: true,
  clean: true,
  splitting: false,
  sourcemap: true,
  shims: true,
  // CRITICAL for a CLI consumed via `npm i -g` / `npm link`: do NOT bundle
  // node_modules into dist/cli.js. Packages like `playwright` and
  // `@babel/traverse` use CommonJS `require()` for tty/fs at runtime —
  // bundling them under ESM rewrites those into a dynamic require shim that
  // crashes with "Dynamic require of 'tty' is not supported" the moment the
  // CLI starts. Leaving them external means the runtime resolves them from
  // node_modules where their original CJS form works.
  skipNodeModulesBundle: true,
});
