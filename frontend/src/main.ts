import { bootstrapApplication } from '@angular/platform-browser';
import esriConfig from '@arcgis/core/config';
import { appConfig } from './app/app.config';
import { App } from './app/app';

esriConfig.assetsPath = '/assets/arcgis-core';

bootstrapApplication(App, appConfig).catch((err) => console.error(err));
