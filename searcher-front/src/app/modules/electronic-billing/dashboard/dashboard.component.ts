import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { InvoiceListComponent } from '../invoice-list/invoice-list.component';
import { ExcelUploadComponent } from '../excel-upload/excel-upload.component';
import { SyncLogsComponent } from '../sync-logs/sync-logs.component';
import { ProfileMenuComponent } from '../../../layout/profile-menu/profile-menu.component';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, InvoiceListComponent, ExcelUploadComponent, SyncLogsComponent, ProfileMenuComponent],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss'
})
export class DashboardComponent {
  activeTab: 'existing' | 'excel' | 'logs' = 'existing';
}
