import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { AuthService } from './auth.service';

export const roleGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  const expectedRoles = route.data['roles'] as Array<string>;
  
  if (authService.isAuthenticated() && authService.hasRole(expectedRoles)) {
    return true;
  }

  // Redirect to unauthorized or dashboard if role doesn't match
  router.navigate(['/facturas']);
  return false;
};
