import { Component, HostListener, input, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

type TooltipAlignment = 'start' | 'center' | 'end';

@Component({
  selector: 'app-table-header-tooltip',
  standalone: true,
  imports: [TranslatePipe],
  host: {
    '[attr.id]': "idBase() + '-help'",
  },
  template: `
    <span
      [id]="idBase() + '-content'"
      class="group relative inline-flex align-middle hover:z-50 focus-within:z-50"
    >
      <span [id]="idBase() + '-label'">{{ labelKey() | translate }}</span>
      <button
        [id]="idBase() + '-help-trigger'"
        type="button"
        class="tooltip-info-icon-glyph inline-flex h-4 w-4 shrink-0 cursor-help items-center justify-center rounded-full border border-slate-300 bg-white text-[10px] font-bold normal-case text-slate-600 transition hover:border-sky-300 hover:bg-sky-50 hover:text-sky-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
        [attr.aria-label]="questionKey() | translate"
        [attr.aria-describedby]="idBase() + '-help-tooltip'"
        (click)="togglePinned($event)"
        (keydown.escape)="dismiss($event)"
      >i</button>
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
