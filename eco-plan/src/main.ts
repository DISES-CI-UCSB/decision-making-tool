import { bootstrapApplication } from '@angular/platform-browser';
import esriConfig from '@arcgis/core/config';
import { defineCustomElements } from '@arcgis/map-components/dist/loader';
import { appConfig } from './app/app.config';
import { App } from './app/app';

esriConfig.assetsPath = '/assets/arcgis-core';
defineCustomElements(window, { resourcesUrl: '/assets/arcgis-map-components' });

bootstrapApplication(App, appConfig)
  .catch((err) => console.error(err));
