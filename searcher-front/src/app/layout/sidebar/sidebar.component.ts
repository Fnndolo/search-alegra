import { Component, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';
import { TooltipModule } from 'primeng/tooltip';

export interface MenuItem {
  label: string;
  icon: string;
  route: string;
  roles?: string[];
  children?: MenuItem[];
}

import { AuthService } from '../../core/auth/auth.service';
import { PurchaseOrdersService } from '../../modules/inventory/purchase-orders/purchase-orders.service';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule, RouterModule, TooltipModule],
  templateUrl: './sidebar.component.html',
  styleUrl: './sidebar.component.scss'
})
export class SidebarComponent implements OnInit {
  /** true = sidebar fijado (empuja el contenido), false = solo iconos */
  isPinned = signal<boolean>(true);

  /** true = mouse encima cuando el sidebar NO está fijado */
  isHovered = signal<boolean>(false);

  /** Sidebar visualmente expandido si está fijado O si el mouse está encima */
  isExpanded = computed(() => this.isPinned() || this.isHovered());

  /** true = menu abierto en móvil */
  isMobileMenuOpen = signal<boolean>(false);

  /** Alias para compatibilidad con main-layout */
  isCollapsed = computed(() => !this.isPinned());

  currentRoute = signal<string>('');

  syncErrorCount = signal<number>(0);

  /** IDs de submenús abiertos */
  openSubMenus = signal<Record<string, boolean>>({
    '/facturacion-electronica': true,
    '/inventario': true
  });

  menuItems: MenuItem[] = [
    {
      label: 'Buscador de Facturas',
      icon: 'pi pi-search',
      route: '/facturas',
      roles: ['admin', 'usuario', 'facturacion']
    },
    {
      label: 'Facturación Electrónica',
      icon: 'pi pi-file-export',
      route: '/facturacion-electronica',
      roles: ['admin', 'facturacion'],
      children: [
        {
          label: 'Módulo Principal',
          icon: 'pi pi-home',
          route: '/facturacion-electronica',
          roles: ['admin', 'facturacion']
        },
        {
          label: 'Estandarizar Items',
          icon: 'pi pi-list',
          route: '/facturacion-electronica/standardize-items',
          roles: ['admin', 'facturacion']
        },
        {
          label: 'Estandarizar Bancos',
          icon: 'pi pi-building',
          route: '/facturacion-electronica/standardize-banks',
          roles: ['admin', 'facturacion']
        }
      ]
    },
    {
      label: 'Inventario',
      icon: 'pi pi-box',
      route: '/inventario/overview',
      roles: ['admin', 'inventario', 'usuario'],
      children: [
        {
          label: 'Resumen',
          icon: 'pi pi-chart-bar',
          route: '/inventario/overview',
          roles: ['admin', 'inventario', 'usuario']
        },
        {
          label: 'Órdenes de Compra',
          icon: 'pi pi-shopping-cart',
          route: '/inventario/purchase-orders',
          roles: ['admin', 'facturacion']
        }
      ]
    },
    {
      label: 'Usuarios',
      icon: 'pi pi-users',
      route: '/usuarios',
      roles: ['admin']
    }
  ];

  filteredMenuItems = computed(() => {
    const userRole = this.authService.userRole();
    if (!userRole) return [];
    
    return this.menuItems.filter(item => {
      const hasRole = !item.roles || item.roles.includes(userRole);
      if (!hasRole) return false;
      
      if (item.children) {
        item.children = item.children.filter(child => !child.roles || child.roles.includes(userRole));
      }
      return true;
    });
  });

  constructor(
    private router: Router,
    public authService: AuthService,
    private purchaseOrdersService: PurchaseOrdersService,
  ) {
    this.router.events.pipe(
      filter(event => event instanceof NavigationEnd)
    ).subscribe((event: any) => {
      this.currentRoute.set(event.urlAfterRedirects);
    });
  }

  ngOnInit(): void {
    if (this.authService.userRole() === 'admin') {
      this.purchaseOrdersService.getSyncCount().subscribe({
        next: ({ count }) => this.syncErrorCount.set(count),
        error: () => {},
      });
    }
  }

  togglePin() {
    this.isPinned.update(v => !v);
    if (!this.isPinned()) {
      this.isHovered.set(false);
    }
  }

  toggleMobileMenu() {
    this.isMobileMenuOpen.update(v => !v);
  }

  closeMobileMenu() {
    this.isMobileMenuOpen.set(false);
  }

  onMouseEnter() {
    if (!this.isPinned()) {
      this.isHovered.set(true);
    }
  }

  onMouseLeave() {
    if (!this.isPinned()) {
      this.isHovered.set(false);
    }
  }

  toggleSubMenu(route: string, event: Event) {
    if (!this.isExpanded() && !this.isMobileMenuOpen()) {
      this.isPinned.set(true);
    }
    event.stopPropagation();
    this.openSubMenus.update(state => ({
      ...state,
      [route]: !state[route]
    }));
  }

  closeMobileIfOpen() {
    if (this.isMobileMenuOpen()) {
      this.closeMobileMenu();
    }
  }

  isActive(route: string, exact: boolean = false): boolean {
    if (exact) {
      return this.currentRoute() === route;
    }
    return this.currentRoute().startsWith(route);
  }

  isOpen(route: string): boolean {
    return !!this.openSubMenus()[route];
  }
}
