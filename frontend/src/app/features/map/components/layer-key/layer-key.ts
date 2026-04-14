import { Component, computed, inject, signal } from '@angular/core';
import { AdminBoundaryService } from '@features/map/services/admin-boundary.service';

interface LayerKeyEntry {
  id: string;
  name: string;
  lineStyle: 'dashed' | 'solid';
  color: string;
  lineWidth: number;
}

const BOUNDARY_ENTRIES: Record<string, Omit<LayerKeyEntry, 'id'>> = {
  sirap: { name: 'SIRAP Regions', lineStyle: 'dashed', color: '#111827', lineWidth: 2 },
  department: { name: 'Departments', lineStyle: 'solid', color: '#4c0073', lineWidth: 1 },
  municipality: { name: 'Municipalities', lineStyle: 'solid', color: '#475569', lineWidth: 1 },
};

@Component({
  selector: 'app-layer-key',
  standalone: true,
  template: `
    @if (entries().length > 0) {
      <section
        id="layer-key-panel"
        class="pointer-events-auto max-w-72 rounded-md border border-slate-200 bg-white/95 shadow-sm"
      >
        <button
          id="layer-key-toggle"
          type="button"
          class="flex w-full items-center gap-2 px-3 py-2 text-left"
          [attr.aria-expanded]="!collapsed()"
          (click)="toggleCollapsed()"
        >
          <h3
            id="layer-key-title"
            class="flex-1 text-xs font-semibold uppercase tracking-wide text-slate-500"
          >
            Layer Key
          </h3>
          <svg
            id="layer-key-chevron"
            class="h-3 w-3 text-slate-400 transition-transform"
            [class.rotate-180]="collapsed()"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M3 4.5L6 7.5L9 4.5" />
          </svg>
        </button>
        @if (!collapsed()) {
          <ul id="layer-key-list" class="space-y-1.5 px-3 pb-2.5 text-xs text-slate-700">
            @for (entry of entries(); track entry.id) {
              <li [id]="'layer-key-entry-' + entry.id" class="flex items-center gap-2">
                <span
                  [id]="'layer-key-swatch-' + entry.id"
                  class="inline-block h-0 w-5"
                  [style.border-top-style]="entry.lineStyle"
                  [style.border-top-color]="entry.color"
                  [style.border-top-width.px]="entry.lineWidth"
                ></span>
                {{ entry.name }}
              </li>
            }
          </ul>
        }
      </section>
    }
  `,
})
export class LayerKeyComponent {
  private readonly adminBoundary = inject(AdminBoundaryService);

  readonly collapsed = signal(false);

  readonly entries = computed<LayerKeyEntry[]>(() => {
    const visibility = this.adminBoundary.layerVisibilityByType$();
    const result: LayerKeyEntry[] = [];
    for (const [type, visible] of Object.entries(visibility)) {
      if (!visible) continue;
      const meta = BOUNDARY_ENTRIES[type];
      if (meta) {
        result.push({ id: type, ...meta });
      }
    }
    return result;
  });

  protected toggleCollapsed(): void {
    this.collapsed.update((v) => !v);
  }
}
