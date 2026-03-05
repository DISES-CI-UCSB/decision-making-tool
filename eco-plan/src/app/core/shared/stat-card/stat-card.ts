import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

@Component({
  selector: 'app-stat-card',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  templateUrl: './stat-card.html'
})
export class StatCardComponent {
  @Input() rootId = 'stat-card-root';
  @Input({ required: true }) labelKey = '';
  @Input({ required: true }) value: string | number = '';
  @Input() unitKey?: string;
  @Input() icon?: string;
  @Input() trendPercent?: number;

  protected get trendDirection(): 'up' | 'down' | null {
    if (this.trendPercent === undefined || this.trendPercent === 0) {
      return null;
    }
    return this.trendPercent > 0 ? 'up' : 'down';
  }
}
