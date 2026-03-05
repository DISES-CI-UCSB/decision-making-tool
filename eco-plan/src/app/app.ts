import { Component, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AppShellComponent } from '@core/layout/app-shell/app-shell';
import { HeaderComponent } from '@core/layout/header/header';
import { TranslatePipe } from '@ngx-translate/core';

@Component({
  selector: 'app-root',
  imports: [AppShellComponent, HeaderComponent, RouterOutlet, TranslatePipe],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  schemas: [CUSTOM_ELEMENTS_SCHEMA]
})
export class App {}
