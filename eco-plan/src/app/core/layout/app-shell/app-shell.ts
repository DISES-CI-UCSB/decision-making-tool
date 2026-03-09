import { AfterViewInit, Component, ElementRef, HostListener, ViewChild } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { useOverlayScrollbar } from '@core/shared/overlay-scrollbar/use-overlay-scrollbar';

type ResizeSide = 'left' | 'right';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './app-shell.html',
  styleUrl: './app-shell.scss',
})
export class AppShellComponent implements AfterViewInit {
  @ViewChild('appShellLeftScrollArea')
  private leftScrollAreaRef?: ElementRef<HTMLElement>;

  @ViewChild('appShellRightScrollArea')
  private rightScrollAreaRef?: ElementRef<HTMLElement>;

  protected leftWidth = 340;
  protected rightWidth = 360;
  protected leftCollapsed = false;
  protected rightCollapsed = false;
  protected leftDrawerOpen = false;
  protected rightDrawerOpen = false;
  protected isMobileViewport = false;
  protected leftScrollbarInteracting = false;
  protected rightScrollbarInteracting = false;
  protected readonly leftOverlayScrollbar = useOverlayScrollbar();
  protected readonly rightOverlayScrollbar = useOverlayScrollbar();

  private readonly minLeftWidth = 220;
  private readonly maxLeftWidth = 520;
  private readonly minRightWidth = 240;
  private readonly maxRightWidth = 620;
  private readonly resizeHitAreaWidth = 12;
  private readonly minCenterWidth = 400;

  private activeResizeSide: ResizeSide | null = null;
  private dragStartX = 0;
  private dragStartWidth = 0;

  constructor() {
    this.updateViewportMode();
    this.autoCollapseForViewport();
  }

  ngAfterViewInit(): void {
    this.leftOverlayScrollbar.scrollRef.set(this.leftScrollAreaRef?.nativeElement ?? null);
    this.rightOverlayScrollbar.scrollRef.set(this.rightScrollAreaRef?.nativeElement ?? null);
    this.leftOverlayScrollbar.recalculate();
    this.rightOverlayScrollbar.recalculate();
  }

  protected get desktopGridTemplateColumns(): string {
    const leftPaneWidth = this.leftCollapsed ? 0 : this.leftWidth;
    const rightPaneWidth = this.rightCollapsed ? 0 : this.rightWidth;

    return `${leftPaneWidth}px minmax(0, 1fr) ${rightPaneWidth}px`;
  }

  protected get leftResizeHandleOffset(): string {
    return `${Math.max(this.leftWidth - this.resizeHitAreaWidth / 2, 0)}px`;
  }

  protected get rightResizeHandleOffset(): string {
    return `${Math.max(this.rightWidth - this.resizeHitAreaWidth / 2, 0)}px`;
  }

  protected get leftCollapseControlOffset(): string {
    return this.leftCollapsed ? '0px' : `${Math.max(this.leftWidth, 0)}px`;
  }

  protected get rightCollapseControlOffset(): string {
    return this.rightCollapsed ? '0px' : `${Math.max(this.rightWidth, 0)}px`;
  }

  protected toggleLeftCollapse(): void {
    this.leftCollapsed = !this.leftCollapsed;
    this.leftOverlayScrollbar.recalculate();
  }

  protected toggleRightCollapse(): void {
    this.rightCollapsed = !this.rightCollapsed;
    this.rightOverlayScrollbar.recalculate();
  }

  protected openLeftDrawer(): void {
    this.leftDrawerOpen = true;
    this.rightDrawerOpen = false;
    this.leftOverlayScrollbar.recalculate();
  }

  protected openRightDrawer(): void {
    this.rightDrawerOpen = true;
    this.leftDrawerOpen = false;
    this.rightOverlayScrollbar.recalculate();
  }

  protected closeMobileDrawers(): void {
    this.leftDrawerOpen = false;
    this.rightDrawerOpen = false;
  }

  protected setScrollbarInteracting(side: ResizeSide, value: boolean): void {
    if (side === 'left') {
      this.leftScrollbarInteracting = value;
      return;
    }

    this.rightScrollbarInteracting = value;
  }

  protected isLeftOverlayThumbVisible(): boolean {
    return (
      this.leftOverlayScrollbar.thumbHeight() > 0 &&
      (this.leftOverlayScrollbar.isScrolling() || this.leftScrollbarInteracting)
    );
  }

  protected isRightOverlayThumbVisible(): boolean {
    return (
      this.rightOverlayScrollbar.thumbHeight() > 0 &&
      (this.rightOverlayScrollbar.isScrolling() || this.rightScrollbarInteracting)
    );
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
    this.leftOverlayScrollbar.recalculate();
    this.rightOverlayScrollbar.recalculate();
  }

  private updateViewportMode(): void {
    this.isMobileViewport = window.innerWidth < 768;
    if (!this.isMobileViewport) {
      this.closeMobileDrawers();
    }
  }

  private autoCollapseForViewport(): void {
    if (this.isMobileViewport) return;
    const bothSidebarsTotal = this.leftWidth + this.rightWidth;
    if (window.innerWidth < bothSidebarsTotal + this.minCenterWidth) {
      this.rightCollapsed = true;
    }
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
  }
}
