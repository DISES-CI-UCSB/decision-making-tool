import { Component, OnInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AppShellComponent } from '@core/layout/app-shell/app-shell';
import { HeaderComponent } from '@core/layout/header/header';
import { BadgeComponent } from '@core/shared/badge/badge';
import { PanelContainerComponent } from '@core/shared/panel-container/panel-container';
import { ProgressBarComponent } from '@core/shared/progress-bar/progress-bar';
import { StatCardComponent } from '@core/shared/stat-card/stat-card';
import { MapViewComponent } from '@features/map/map-view/map-view';
import { TranslatePipe } from '@ngx-translate/core';

@Component({
  selector: 'app-root',
  imports: [
    AppShellComponent,
    BadgeComponent,
    HeaderComponent,
    MapViewComponent,
    PanelContainerComponent,
    ProgressBarComponent,
    RouterOutlet,
    StatCardComponent,
    TranslatePipe,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App implements OnInit {
  private readonly debugMarker = 'UCS-39-map-debug-v1';

  ngOnInit(): void {
    const runtimePort = window.location.port || '(default)';
    console.info(`[App][${this.debugMarker}] ngOnInit on port ${runtimePort}`);
    (window as Window & { __ecoPlanDebugMarker?: string }).__ecoPlanDebugMarker = this.debugMarker;
  }
}
