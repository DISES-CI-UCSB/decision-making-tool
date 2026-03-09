import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

interface SidebarSection {
  id: string;
  title: string;
  isCollapsed: boolean;
  stickToBottom?: boolean;
}

interface OnboardingStep {
  id: string;
  titleKey: string;
  descriptionKey: string;
}

@Component({
  selector: 'app-sidebar-container',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  templateUrl: './sidebar-container.html',
  styleUrl: './sidebar-container.scss',
})
export class SidebarContainerComponent {
  @Output() readonly solutionFinderRequested = new EventEmitter<void>();

  protected readonly onboardingSteps: OnboardingStep[] = [
    {
      id: 'choose',
      titleKey: 'solutionControls.onboarding.steps.choose.title',
      descriptionKey: 'solutionControls.onboarding.steps.choose.description',
    },
    {
      id: 'review',
      titleKey: 'solutionControls.onboarding.steps.review.title',
      descriptionKey: 'solutionControls.onboarding.steps.review.description',
    },
    {
      id: 'compare',
      titleKey: 'solutionControls.onboarding.steps.compare.title',
      descriptionKey: 'solutionControls.onboarding.steps.compare.description',
    },
  ];

  protected readonly sectionSlots: SidebarSection[] = [
    {
      id: 'active-solution',
      title: 'Active Solution',
      isCollapsed: false,
    },
    {
      id: 'data-layers',
      title: 'Data Layers',
      isCollapsed: false,
    },
    {
      id: 'actions',
      title: 'Actions',
      isCollapsed: false,
      stickToBottom: true,
    },
  ];

  protected toggleSection(sectionId: string): void {
    const section = this.sectionSlots.find(({ id }) => id === sectionId);
    if (!section) {
      return;
    }

    section.isCollapsed = !section.isCollapsed;
  }

  protected requestSolutionFinder(): void {
    this.solutionFinderRequested.emit();
  }
}
