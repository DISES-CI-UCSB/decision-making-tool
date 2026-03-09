import { Component, OnInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AppShellComponent } from '@core/layout/app-shell/app-shell';
import { HeaderComponent } from '@core/layout/header/header';
import { ModalShellComponent } from '@core/shared/modal-shell/modal-shell';
import { PanelSwitcherComponent } from '@features/analysis/panel-switcher/panel-switcher';
import { SidebarContainerComponent } from '@features/left-sidebar/sidebar-container/sidebar-container';
import { MapViewComponent } from '@features/map/map-view/map-view';
import { FinderModalComponent } from '@features/solution-finder/finder-modal/finder-modal';
import { TranslatePipe } from '@ngx-translate/core';

@Component({
  selector: 'app-root',
  imports: [
    AppShellComponent,
    HeaderComponent,
    MapViewComponent,
    ModalShellComponent,
    PanelSwitcherComponent,
    RouterOutlet,
    SidebarContainerComponent,
    FinderModalComponent,
    TranslatePipe,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App implements OnInit {
  private readonly debugMarker = 'UCS-39-map-debug-v1';
  protected solutionFinderModalOpen = false;
  protected perspectiveModalOpen = false;

  ngOnInit(): void {
    const runtimePort = window.location.port || '(default)';
    console.info(`[App][${this.debugMarker}] ngOnInit on port ${runtimePort}`);
    (window as Window & { __ecoPlanDebugMarker?: string }).__ecoPlanDebugMarker = this.debugMarker;
  }

  protected openSolutionFinderModal(): void {
    this.solutionFinderModalOpen = true;
  }

  protected closeSolutionFinderModal(): void {
    this.solutionFinderModalOpen = false;
  }

  protected openPerspectiveModal(): void {
    this.perspectiveModalOpen = true;
  }

  protected closePerspectiveModal(): void {
    this.perspectiveModalOpen = false;
  }

  protected onScenarioApplied(): void {
    this.closeSolutionFinderModal();
  }
}
