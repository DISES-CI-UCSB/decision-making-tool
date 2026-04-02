import { Component, Input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

type BadgeVariant = 'success' | 'warning' | 'info' | 'neutral';

@Component({
  selector: 'app-badge',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './badge.html',
})
export class BadgeComponent {
  @Input() rootId = 'badge-root';
  @Input({ required: true }) textKey = '';
  @Input() variant: BadgeVariant = 'neutral';

  protected get variantClass(): string {
    const classes: Record<BadgeVariant, string> = {
      success: 'bg-canopy-50 text-canopy-500 border-canopy-300',
      warning: 'bg-yellow-50 text-yellow-700 border-yellow-300',
      info: 'bg-ocean-50 text-ocean-500 border-ocean-300',
      neutral: 'bg-gray-50 text-gray-700 border-gray-300',
    };

    return classes[this.variant];
  }
}
