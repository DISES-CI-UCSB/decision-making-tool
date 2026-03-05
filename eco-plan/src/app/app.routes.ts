import { Routes } from '@angular/router';
import { tierAccessGuard } from '@core/guards/tier-access.guard';
import { UserTier } from '@core/models';
import { TierTwoPageComponent } from '@features/tier-two-page/tier-two-page';

export const routes: Routes = [
  {
    path: 'tier-two',
    component: TierTwoPageComponent,
    canActivate: [tierAccessGuard],
    data: {
      minimumTier: UserTier.DecisionMaker
    }
  }
];
