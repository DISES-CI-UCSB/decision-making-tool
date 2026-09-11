import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Vitest injects Node export conditions even for Playwright browser tests, and
// Vite concatenates them with Angular's `browser` condition. Firestore lists
// `node` first in `exports`, so the optimizer otherwise prebundles @grpc/grpc-js.
const firestoreBrowserBuild = path.resolve(
  fileURLToPath(new URL('./node_modules/@firebase/firestore/dist/index.esm.js', import.meta.url)),
);

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@firebase\/firestore$/,
        replacement: firestoreBrowserBuild,
      },
    ],
  },
  ssr: {
    noExternal: true,
  },
  test: {
    css: true,
    server: {
      deps: {
        inline: [/^@arcgis\/core/, /^@esri\/calcite-components/],
      },
    },
  },
});
