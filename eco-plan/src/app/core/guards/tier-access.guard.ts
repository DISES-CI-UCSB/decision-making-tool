import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { UserTier } from '@core/models';
import { AuthService } from '@core/services/auth.service';

export const tierAccessGuard: CanActivateFn = (route) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  const minimumTier = (route.data?.['minimumTier'] as UserTier | undefined) ?? UserTier.DecisionMaker;
  const isAllowed = authService.isAuthenticated() && authService.getCurrentTier() >= minimumTier;

  if (isAllowed) {
    return true;
  }

  return router.parseUrl('/');
};
