import { Component, Input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

type ProgressTheme = 'canopy' | 'ocean' | 'earth' | 'neutral';

@Component({
  selector: 'app-progress-bar',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './progress-bar.html'
})
export class ProgressBarComponent {
  @Input() rootId = 'progress-bar-root';
  @Input({ required: true }) labelKey = '';
  @Input() value = 0;
  @Input() max = 100;
  @Input() theme: ProgressTheme = 'canopy';

  protected get percent(): number {
    if (this.max <= 0) {
      return 0;
    }
    return Math.min(100, Math.max(0, (this.value / this.max) * 100));
  }

  protected get barThemeClass(): string {
    const classes: Record<ProgressTheme, string> = {
      canopy: 'bg-canopy-500',
      ocean: 'bg-ocean-500',
      earth: 'bg-earth-700',
      neutral: 'bg-gray-500'
    };

    return classes[this.theme];
  }
}
