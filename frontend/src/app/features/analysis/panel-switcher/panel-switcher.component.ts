import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { PanelContainerComponent } from '@core/shared/panel-container/panel-container';
import { TranslatePipe } from '@ngx-translate/core';

type AnalysisPanelId = 'welcome' | 'overview' | 'aoi' | 'comparison';

interface AnalysisPanelOption {
  id: AnalysisPanelId;
  titleKey: string;
  descriptionKey: string;
}

@Component({
  selector: 'app-panel-switcher',
  standalone: true,
  imports: [CommonModule, PanelContainerComponent, TranslatePipe],
  templateUrl: './panel-switcher.component.html',
})
export class PanelSwitcherComponent {
  protected readonly panelOptions: AnalysisPanelOption[] = [
    {
      id: 'welcome',
      titleKey: 'analysis.panelSwitcher.welcome.title',
      descriptionKey: 'analysis.panelSwitcher.welcome.description',
    },
    {
      id: 'overview',
      titleKey: 'analysis.panelSwitcher.overview.title',
      descriptionKey: 'analysis.panelSwitcher.overview.description',
    },
    {
      id: 'aoi',
      titleKey: 'analysis.panelSwitcher.aoi.title',
      descriptionKey: 'analysis.panelSwitcher.aoi.description',
    },
    {
      id: 'comparison',
      titleKey: 'analysis.panelSwitcher.comparison.title',
      descriptionKey: 'analysis.panelSwitcher.comparison.description',
    },
  ];

  protected activePanelId: AnalysisPanelId = 'welcome';

  protected setActivePanel(panelId: AnalysisPanelId): void {
    this.activePanelId = panelId;
  }

  protected isActivePanel(panelId: AnalysisPanelId): boolean {
    return this.activePanelId === panelId;
  }

  protected get activePanel(): AnalysisPanelOption {
    return (
      this.panelOptions.find((panel) => panel.id === this.activePanelId) ?? this.panelOptions[0]
    );
  }
}
