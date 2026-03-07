import { Component, HostListener } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

type ResizeSide = 'left' | 'right';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './app-shell.html',
  styleUrl: './app-shell.scss',
})
export class AppShellComponent {
  protected leftWidth = 280;
  protected rightWidth = 320;
  protected leftCollapsed = false;
  protected rightCollapsed = false;
  protected leftDrawerOpen = false;
  protected rightDrawerOpen = false;
  protected isMobileViewport = false;

  private readonly minLeftWidth = 220;
  private readonly maxLeftWidth = 520;
  private readonly minRightWidth = 240;
  private readonly maxRightWidth = 620;
  private readonly handleWidth = 10;
  private readonly minCenterWidth = 400;

  private activeResizeSide: ResizeSide | null = null;
  private dragStartX = 0;
  private dragStartWidth = 0;

  constructor() {
    this.updateViewportMode();
    this.autoCollapseForViewport();
  }

  protected get desktopGridTemplateColumns(): string {
    const leftPaneWidth = this.leftCollapsed ? 0 : this.leftWidth;
    const rightPaneWidth = this.rightCollapsed ? 0 : this.rightWidth;
    const leftHandleWidth = this.leftCollapsed ? 0 : this.handleWidth;
    const rightHandleWidth = this.rightCollapsed ? 0 : this.handleWidth;

    return `${leftPaneWidth}px ${leftHandleWidth}px minmax(0, 1fr) ${rightHandleWidth}px ${rightPaneWidth}px`;
  }

  protected toggleLeftCollapse(): void {
    this.leftCollapsed = !this.leftCollapsed;
  }

  protected toggleRightCollapse(): void {
    this.rightCollapsed = !this.rightCollapsed;
  }

  protected openLeftDrawer(): void {
    this.leftDrawerOpen = true;
    this.rightDrawerOpen = false;
  }

  protected openRightDrawer(): void {
    this.rightDrawerOpen = true;
    this.leftDrawerOpen = false;
  }

  protected closeMobileDrawers(): void {
    this.leftDrawerOpen = false;
    this.rightDrawerOpen = false;
  }

  protected startResize(side: ResizeSide, event: MouseEvent): void {
    if (this.isMobileViewport) {
      return;
    }

    this.activeResizeSide = side;
    this.dragStartX = event.clientX;
    this.dragStartWidth = side === 'left' ? this.leftWidth : this.rightWidth;
    event.preventDefault();
  }

  @HostListener('window:mousemove', ['$event'])
  protected onWindowMouseMove(event: MouseEvent): void {
    if (!this.activeResizeSide || this.isMobileViewport) {
      return;
    }

    const deltaX = event.clientX - this.dragStartX;

    if (this.activeResizeSide === 'left') {
      this.leftWidth = this.clamp(
        this.dragStartWidth + deltaX,
        this.minLeftWidth,
        this.maxLeftWidth,
      );
      return;
    }

    this.rightWidth = this.clamp(
      this.dragStartWidth - deltaX,
      this.minRightWidth,
      this.maxRightWidth,
    );
  }

  @HostListener('window:mouseup')
  protected onWindowMouseUp(): void {
    this.activeResizeSide = null;
  }

  @HostListener('window:resize')
  protected onWindowResize(): void {
    this.updateViewportMode();
  }

  private updateViewportMode(): void {
    this.isMobileViewport = window.innerWidth < 768;
    if (!this.isMobileViewport) {
      this.closeMobileDrawers();
    }
  }

  private autoCollapseForViewport(): void {
    if (this.isMobileViewport) return;
    const bothSidebarsTotal = this.leftWidth + this.rightWidth + 2 * this.handleWidth;
    if (window.innerWidth < bothSidebarsTotal + this.minCenterWidth) {
      this.rightCollapsed = true;
    }
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
  }
}
