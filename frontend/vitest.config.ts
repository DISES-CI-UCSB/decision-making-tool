import { defineConfig } from 'vitest/config';

export default defineConfig({
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
