import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { aboutPartnerSections } from '@core/config/partner-logos';

@Component({
  selector: 'app-about-page',
  imports: [RouterLink, TranslatePipe],
  templateUrl: './about-page.html',
  styleUrl: './about-page.scss',
})
export class AboutPageComponent {
  protected readonly partnerSections = aboutPartnerSections;
}
