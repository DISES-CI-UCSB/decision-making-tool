import { Component, Input } from '@angular/core';

export type InfoIconPlacement = 'inline' | 'control';

@Component({
  selector: 'app-info-icon',
  standalone: true,
  host: {
    '[class.info-icon--control]': "placement === 'control'",
  },
  styles: `
    :host {
      display: inline-block;
      line-height: 0;
      vertical-align: baseline;
      width: 1.15em;
      height: 1.15em;
      transform: translateY(0.1em);
    }

    :host(.info-icon--control) {
      width: 1rem;
      height: 1rem;
      transform: translateY(-1px);
    }

    svg {
      display: block;
      width: 100%;
      height: 100%;
    }
  `,
  template: `
    <svg
      [id]="rootId"
      [class]="'shrink-0 ' + colorClass"
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
  @Input() placement: InfoIconPlacement = 'inline';
  @Input() colorClass = 'text-slate-400';
}
