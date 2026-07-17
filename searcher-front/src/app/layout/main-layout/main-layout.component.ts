import { Component, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import { SidebarComponent } from '../sidebar/sidebar.component';
import { ButtonModule } from 'primeng/button';
import { inject } from '@angular/core';
import { AuthService } from '../../core/auth/auth.service';

@Component({
  selector: 'app-main-layout',
  standalone: true,
  imports: [CommonModule, RouterOutlet, SidebarComponent, ButtonModule],
  templateUrl: './main-layout.component.html',
  styleUrl: './main-layout.component.scss'
})
export class MainLayoutComponent {
  /**
   * `static: true` because `<app-sidebar>` is unconditional in the template — without it, the
   * ViewChild resolves to `undefined` on the first CD pass and to the real instance by the dev-mode
   * verification pass, throwing NG0100 (ExpressionChangedAfterItHasBeenCheckedError) on every
   * bootstrap and aborting that tick's change detection for the rest of the app (breaks any
   * async update that happens to land in the same tick, e.g. order-detail's variant resolution).
   */
  @ViewChild(SidebarComponent, { static: true }) sidebarComponent!: SidebarComponent;
  
  private authService = inject(AuthService);

  onLogout() {
    this.authService.logout();
  }
}
