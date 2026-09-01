import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-info-icon',
  standalone: true,
  styles: `
    :host {
      display: inline-flex;
      transform: translateY(-1px);
    }
  `,
  template: `
    <svg
      [id]="rootId"
      [class]="sizeClass + ' shrink-0 ' + colorClass"
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path
        fill-rule="evenodd"
        d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-7-4a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM9 9a1 1 0 0 1 2 0v5a1 1 0 1 1-2 0V9Z"
        clip-rule="evenodd"
      />
    </svg>
  `,
})
export class InfoIconComponent {
  @Input() rootId = 'info-icon';
  @Input() sizeClass = 'h-4 w-4';
  @Input() colorClass = 'text-slate-400';
}
