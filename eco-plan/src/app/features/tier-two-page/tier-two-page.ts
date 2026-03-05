import { Component } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

@Component({
  selector: 'app-tier-two-page',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './tier-two-page.html'
})
export class TierTwoPageComponent {}
