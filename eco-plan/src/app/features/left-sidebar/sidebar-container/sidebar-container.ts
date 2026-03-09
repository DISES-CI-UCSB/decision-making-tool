import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';

interface SidebarSection {
  id: string;
  title: string;
  isCollapsed: boolean;
  stickToBottom?: boolean;
}

@Component({
  selector: 'app-sidebar-container',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './sidebar-container.html',
})
export class SidebarContainerComponent {
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
}
