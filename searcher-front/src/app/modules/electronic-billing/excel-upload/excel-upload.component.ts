import { Component, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import * as xlsx from 'xlsx';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';
import { TooltipModule } from 'primeng/tooltip';
import { ElectronicBillingService } from '../services/electronic-billing.service';

@Component({
  selector: 'app-excel-upload',
  standalone: true,
  imports: [CommonModule, TableModule, ButtonModule, ToastModule, TooltipModule],
  providers: [MessageService],
  templateUrl: './excel-upload.component.html',
  styleUrl: './excel-upload.component.scss'
})
export class ExcelUploadComponent {

  isDragging = signal<boolean>(false);
  parsedData = signal<any[]>([]);
  fileName = signal<string | null>(null);
  isUploading = signal<boolean>(false);

  private selectedFile: File | null = null;
  private billingService = inject(ElectronicBillingService);

  constructor(private messageService: MessageService) { }

  onDragOver(event: DragEvent) {
    event.preventDefault();
    this.isDragging.set(true);
  }

  onDragLeave(event: DragEvent) {
    event.preventDefault();
    this.isDragging.set(false);
  }

  onDrop(event: DragEvent) {
    event.preventDefault();
    this.isDragging.set(false);

    if (event.dataTransfer?.files && event.dataTransfer.files.length > 0) {
      this.handleFile(event.dataTransfer.files[0]);
    }
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.handleFile(input.files[0]);
    }
  }

  handleFile(file: File) {
    if (!file.name.endsWith('.xlsx') && !file.name.endsWith('.xls') && !file.name.endsWith('.csv')) {
      this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Formato no soportado. Suba un archivo Excel (.xlsx, .xls, .csv)' });
      return;
    }

    this.fileName.set(file.name);
    const reader = new FileReader();

    reader.onload = (e: any) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = xlsx.read(data, { type: 'array' });

        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];

        const json: any[] = xlsx.utils.sheet_to_json(worksheet, { defval: "" });

        if (json.length === 0) {
          this.messageService.add({ severity: 'warn', summary: 'Archivo vacío', detail: 'El documento no contiene datos.' });
          this.parsedData.set([]);
          return;
        }

        this.parsedData.set(json);
        this.selectedFile = file;
        this.messageService.add({ severity: 'success', summary: 'Excel Cargado', detail: `Se extrajeron ${json.length} filas del archivo.` });

      } catch (err) {
        this.messageService.add({ severity: 'error', summary: 'Error de lectura', detail: 'No se pudo procesar el archivo Excel.' });
        this.parsedData.set([]);
        this.selectedFile = null;
      }
    };

    reader.readAsArrayBuffer(file);
  }

  processBatch() {
    if (!this.selectedFile) {
      this.messageService.add({ severity: 'warn', summary: 'Sin Archivo', detail: 'Por favor seleccione un archivo Excel primero.' });
      return;
    }

    this.isUploading.set(true);
    this.messageService.add({ severity: 'info', summary: 'Procesando...', detail: 'Enviando lote masivo al backend para facturación.' });

    this.billingService.uploadExcelForMassBilling(this.selectedFile).subscribe({
      next: (response) => {
        this.isUploading.set(false);
        this.messageService.add({
          severity: 'success',
          summary: 'Facturación Masiva',
          detail: `Proceso completado. Éxitos: ${response.successCount}, Fallos: ${response.failCount}`
        });
        this.clearData();
      },
      error: (err) => {
        this.isUploading.set(false);
        this.messageService.add({ severity: 'error', summary: 'Error', detail: err.error?.message || 'Error procesando la facturación masiva' });
      }
    });
  }

  clearData() {
    this.parsedData.set([]);
    this.fileName.set(null);
    this.selectedFile = null;
    this.isUploading.set(false);
  }
}
