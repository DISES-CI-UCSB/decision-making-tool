/**
 * Feature flags — all environments in one place.
 *
 * To change a flag: edit the value under the relevant environment block below.
 * To add a flag: add it to every environment block, then use FEATURE_FLAGS
 * wherever you need it  (import { FEATURE_FLAGS } from '@feature-flags').
 *
 * Angular bakes environment.production in at build time, so there is no
 * runtime overhead — the unused environment block is tree-shaken away.
 */
import { environment } from './environments/environment';

const FLAGS = {
  development: {
    sirapLayers: {
      combined: false,
      territorial: true,
      thematic: true,
    },
  },

  production: {
    sirapLayers: {
      combined: false,
      territorial: true,
      thematic: true,
    },
  },
};

export const FEATURE_FLAGS = FLAGS[environment.production ? 'production' : 'development'];
