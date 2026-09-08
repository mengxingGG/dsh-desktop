import { defineConfig } from 'tsdown'

export default defineConfig([
  {
    entry: ['lib/types/main.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    deps: { neverBundle: ['electron'] },
  },
  // Each sandboxed preload must embed its local imports; Electron cannot require shared chunks.
  ...['preload', 'preload-app'].map(entry => ({
    entry: [`lib/types/${entry}.js`],
    outDir: 'lib',
    format: ['cjs' as const],
    platform: 'node' as const,
    target: 'es2024',
    codeSplitting: false,
    fixedExtension: false,
    dts: false,
    clean: false,
    deps: { neverBundle: ['electron'] },
  })),
])
