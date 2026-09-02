import { Component, HostListener, input, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { InfoIconComponent } from '@core/shared/info-icon/info-icon';

type TooltipAlignment = 'start' | 'center' | 'end';

@Component({
  selector: 'app-table-header-tooltip',
  standalone: true,
  imports: [InfoIconComponent, TranslatePipe],
  host: {
    '[attr.id]': "idBase() + '-help'",
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
    <span [id]="idBase() + '-content'">
      <span [id]="idBase() + '-label'">{{ labelKey() | translate }}</span
      ><span class="table-header-inline-help group hover:z-50 focus-within:z-50">
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
          class="pointer-events-auto absolute top-full z-50 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-md border border-slate-200 bg-white p-3 text-left text-xs font-normal normal-case leading-snug tracking-normal text-slate-700 opacity-0 shadow-lg transition-opacity duration-75 group-hover:opacity-100 group-focus-within:opacity-100"
          [class.opacity-100]="pinned()"
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
  readonly align = input<TooltipAlignment>('center');
  protected readonly pinned = signal(false);

  @HostListener('document:click')
  protected closePinnedTooltip(): void {
    this.pinned.set(false);
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
