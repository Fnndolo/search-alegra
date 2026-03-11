import { Component, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../core/auth/auth.service';
import { MenuModule } from 'primeng/menu';
import { MenuItem } from 'primeng/api';
import { ButtonModule } from 'primeng/button';

@Component({
  selector: 'app-profile-menu',
  standalone: true,
  imports: [CommonModule, MenuModule, ButtonModule],
  template: `
    <div class="flex items-center gap-3">
        <div class="hidden sm:flex flex-col items-end mr-1">
            <span class="text-xs font-bold text-surface-900 leading-none">{{authService.currentUser()?.username}}</span>
            <span class="text-[9px] font-medium text-surface-500 uppercase tracking-widest mt-0.5">{{authService.currentUser()?.role}}</span>
        </div>
        
        <button #btn (click)="menu.toggle($event)" class="relative focus:outline-none group">
            <div class="w-9 h-9 rounded-xl bg-primary-500 flex items-center justify-center text-white font-bold shadow-md group-hover:bg-primary-600 transition-all cursor-pointer">
                {{userInitials()}}
            </div>
            <div class="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-green-500 border-2 border-white rounded-full"></div>
        </button>
        <p-menu #menu [model]="profileMenuItems" [popup]="true" appendTo="body" styleClass="!rounded-xl !shadow-2xl !border-surface-100 !mt-2"></p-menu>
    </div>
  `,
  styles: [`
    :host { display: block; }
  `]
})
export class ProfileMenuComponent {
  public authService = inject(AuthService);
  
  userInitials = computed(() => {
    const user = this.authService.currentUser();
    if (!user) return '?';
    return user.username.charAt(0).toUpperCase();
  });

  profileMenuItems: MenuItem[] = [
    {
      label: 'Cerrar Sesión',
      icon: 'pi pi-sign-out',
      command: () => this.onLogout()
    }
  ];

  onLogout() {
    this.authService.logout();
  }
}
