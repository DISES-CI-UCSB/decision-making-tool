import { Routes } from '@angular/router';
import { tierAccessGuard } from '@core/guards/tier-access.guard';
import { UserTier } from '@core/models';
import { TierTwoPageComponent } from '@features/tier-two-page/tier-two-page';

export const routes: Routes = [
  {
    path: 'about',
    loadComponent: () =>
      import('@features/about-page/about-page').then((module) => module.AboutPageComponent),
  },
  {
    path: 'tier-two',
    component: TierTwoPageComponent,
    canActivate: [tierAccessGuard],
    data: {
      minimumTier: UserTier.DecisionMaker,
    },
  },
];
