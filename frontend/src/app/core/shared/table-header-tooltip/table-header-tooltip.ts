import { Component, HostListener, input, output, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { InfoIconComponent } from '@core/shared/info-icon/info-icon';

type TooltipAlignment = 'start' | 'center' | 'end';
type SortDirection = 'asc' | 'desc' | 'none';

@Component({
  selector: 'app-table-header-tooltip',
  standalone: true,
  imports: [InfoIconComponent, TranslatePipe],
  host: {
    '[attr.id]': "idBase() + '-help'",
    class: 'block text-left',
  },
  styles: `
    .table-header-inline-help {
      position: relative;
      display: inline-flex;
      align-items: baseline;
      margin-left: 2px;
    }

    .table-header-inline-help-trigger {
      appearance: none;
      border: 0;
      margin: 0;
      padding: 0;
      background: transparent;
      cursor: help;
      line-height: 0;
    }

    .table-header-inline-help-trigger:focus-visible {
      outline: 2px solid #93c5fd;
      outline-offset: 1px;
    }
  `,
  template: `
    <span [id]="idBase() + '-content'" class="inline-flex items-baseline">
      @if (sortable()) {
        <button
          [id]="idBase() + '-sort-button'"
          type="button"
          class="group/sort inline-flex items-baseline gap-1 rounded-sm text-left font-inherit hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-300"
          [attr.aria-label]="sortAriaLabel()"
          (click)="onSortClick($event)"
        >
          <span [id]="idBase() + '-label'">{{ labelKey() | translate }}</span>
          <span
            [id]="idBase() + '-sort-indicator'"
            class="inline-flex h-3 w-3 shrink-0 text-slate-400 opacity-0 transition-opacity group-hover/sort:opacity-60"
            [class.text-slate-600]="sortDirection() !== 'none'"
            [class.opacity-100]="sortDirection() !== 'none'"
            aria-hidden="true"
          >
            <svg [id]="idBase() + '-sort-chevron'" class="h-3 w-3" viewBox="0 0 12 12" fill="currentColor">
              @if (sortDirection() === 'asc') {
                <path [id]="idBase() + '-sort-chevron-up'" d="M6 2.25 10.5 9.75H1.5Z" />
              } @else if (sortDirection() === 'desc') {
                <path [id]="idBase() + '-sort-chevron-down'" d="M6 9.75 1.5 2.25h9Z" />
              } @else {
                <path
                  [id]="idBase() + '-sort-chevron-hover'"
                  d="M6 1.25 8.6 4.75H3.4Zm0 9.5L3.4 7.25h5.2Z"
                />
              }
            </svg>
          </span>
        </button>
      } @else {
        <span [id]="idBase() + '-label'">{{ labelKey() | translate }}</span>
      }
      <span class="table-header-inline-help group hover:z-50 focus-within:z-50">
        <button
          [id]="idBase() + '-help-trigger'"
          type="button"
          class="table-header-inline-help-trigger"
          [attr.aria-label]="questionKey() | translate"
          [attr.aria-describedby]="idBase() + '-help-tooltip'"
          (click)="togglePinned($event)"
          (keydown.escape)="dismiss($event)"
        >
          <app-info-icon [rootId]="idBase() + '-help-icon'" colorClass="text-slate-400" />
        </button>
        <span
          [id]="idBase() + '-help-tooltip'"
          role="tooltip"
          class="pointer-events-auto absolute top-full z-50 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-md border border-slate-200 bg-white p-3 text-left text-xs font-normal normal-case leading-snug tracking-normal text-slate-700 shadow-lg group-hover:block! group-focus-within:block!"
          [class.hidden]="!pinned()"
          [class.block]="pinned()"
          [class.left-0]="align() === 'start'"
          [class.left-1/2]="align() === 'center'"
          [class.-translate-x-1/2]="align() === 'center'"
          [class.right-0]="align() === 'end'"
        >
          {{ questionKey() | translate }}
        </span>
      </span>
    </span>
  `,
})
export class TableHeaderTooltipComponent {
  readonly idBase = input.required<string>();
  readonly labelKey = input.required<string>();
  readonly questionKey = input.required<string>();
  readonly align = input<TooltipAlignment>('start');
  readonly sortable = input(false);
  readonly sortDirection = input<SortDirection>('none');
  readonly sortAriaLabel = input('');
  readonly sortClick = output<void>();
  protected readonly pinned = signal(false);

  @HostListener('document:click')
  protected closePinnedTooltip(): void {
    this.pinned.set(false);
  }

  protected onSortClick(event: Event): void {
    event.stopPropagation();
    this.sortClick.emit();
  }

  protected togglePinned(event: Event): void {
    event.stopPropagation();
    const wasPinned = this.pinned();
    this.pinned.set(!wasPinned);
    if (wasPinned) {
      (event.currentTarget as HTMLButtonElement).blur();
    }
  }

  protected dismiss(event: Event): void {
    this.pinned.set(false);
    (event.currentTarget as HTMLButtonElement).blur();
  }
}
