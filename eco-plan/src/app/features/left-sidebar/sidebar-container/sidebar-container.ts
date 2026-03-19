import { Component, EventEmitter, Output } from '@angular/core';
import { MapLayersPanelComponent } from '../map-layers-panel/map-layers-panel';

@Component({
  selector: 'app-sidebar-container',
  standalone: true,
  imports: [MapLayersPanelComponent],
  templateUrl: './sidebar-container.html',
  styleUrl: './sidebar-container.scss',
})
export class SidebarContainerComponent {
  @Output() readonly solutionFinderRequested = new EventEmitter<void>();

  protected onSolutionFinderRequested(): void {
    this.solutionFinderRequested.emit();
  }
}
