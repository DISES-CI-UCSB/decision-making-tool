import { Component, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AppShellComponent } from '@core/layout/app-shell/app-shell';
import { HeaderComponent } from '@core/layout/header/header';
import { BadgeComponent } from '@core/shared/badge/badge';
import { PanelContainerComponent } from '@core/shared/panel-container/panel-container';
import { ProgressBarComponent } from '@core/shared/progress-bar/progress-bar';
import { StatCardComponent } from '@core/shared/stat-card/stat-card';
import { TranslatePipe } from '@ngx-translate/core';

@Component({
  selector: 'app-root',
  imports: [
    AppShellComponent,
    BadgeComponent,
    HeaderComponent,
    PanelContainerComponent,
    ProgressBarComponent,
    RouterOutlet,
    StatCardComponent,
    TranslatePipe
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  schemas: [CUSTOM_ELEMENTS_SCHEMA]
})
export class App {}
