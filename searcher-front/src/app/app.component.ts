import { Component } from '@angular/core';
import { InvoicesComponent } from './modules/invoices/invoices/invoices.component';

@Component({
  selector: 'app-root',
  template: `<app-invoices />`,
  standalone: true,
  imports: [InvoicesComponent]
})
export class AppComponent {}