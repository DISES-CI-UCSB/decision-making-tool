import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

export interface PanelActionButton {
  id: string;
  labelKey: string;
}

@Component({
  selector: 'app-panel-container',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  templateUrl: './panel-container.html',
})
export class PanelContainerComponent {
  @Input() rootId = 'panel-container-root';
  @Input({ required: true }) titleKey = '';
  @Input() collapsible = false;
  @Input() collapsed = false;
  @Input() actionButtons: PanelActionButton[] = [];

  @Output() readonly actionSelected = new EventEmitter<string>();

  protected onToggleCollapse(): void {
    if (!this.collapsible) {
      return;
    }
    this.collapsed = !this.collapsed;
  }

  protected onActionClick(actionId: string): void {
    this.actionSelected.emit(actionId);
  }
}
