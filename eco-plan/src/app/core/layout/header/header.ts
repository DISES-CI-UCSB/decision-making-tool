import { Component, inject } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './header.html',
  styleUrl: './header.scss'
})
export class HeaderComponent {
  private readonly translate = inject(TranslateService);

  protected get activeLanguage(): string {
    return this.translate.getCurrentLang();
  }

  protected toggleLanguage(): void {
    const nextLanguage = this.activeLanguage === 'es' ? 'en' : 'es';
    this.translate.use(nextLanguage).subscribe();
  }
}
