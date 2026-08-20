import { Component, EventEmitter, Input, OnChanges, OnDestroy, Output, SimpleChanges, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DialogModule } from 'primeng/dialog';
import { ButtonModule } from 'primeng/button';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';

type ScannerState = 'idle' | 'requesting' | 'scanning' | 'denied' | 'no-camera' | 'error';

let nextInstanceId = 0;

/**
 * Reusable camera barcode/QR scanner, opened as a PrimeNG dialog (same `[(visible)]` /
 * `visibleChange` pattern as the rest of the app's modals — see `product-form-modal`).
 *
 * It is ALWAYS a shortcut, never a blocker: every state (requesting permission, denied,
 * no camera, generic error) leaves the caller's own text input fully usable — this component
 * only ever fills that input on success, it never disables it.
 */
@Component({
  selector: 'app-barcode-scanner-modal',
  standalone: true,
  imports: [CommonModule, DialogModule, ButtonModule],
  templateUrl: './barcode-scanner-modal.component.html',
})
export class BarcodeScannerModalComponent implements OnChanges, OnDestroy {
  @Input() visible = false;
  @Input() header = 'Escanear código';
  /** Icon for the on-camera banner (see template) — lets a caller reflect what's being scanned
   *  right now (e.g. 'pi pi-barcode' for a SKU, 'pi pi-mobile' for an IMEI), not just in the
   *  small dialog title but directly over the viewfinder, where the operator is actually looking. */
  @Input() badgeIcon = 'pi pi-camera';
  /** Distinguishes scan stages at a glance (e.g. SKU vs IMEI in a chained flow) via banner color. */
  @Input() badgeColor: 'primary' | 'amber' = 'primary';
  /** When true, a successful scan doesn't close the dialog — it briefly pauses (so the same
   *  physical barcode still in frame can't double-fire) then resumes for the next one. Lets a
   *  caller chain several scans (e.g. SKU → IMEI → SKU → ...) without reopening the modal each time. */
  @Input() continuous = false;
  @Output() visibleChange = new EventEmitter<boolean>();
  @Output() scanned = new EventEmitter<string>();

  readonly regionId = `barcode-scanner-region-${nextInstanceId++}`;

  state: ScannerState = 'idle';
  errorMessage = '';

  private scanner: Html5Qrcode | null = null;
  private starting = false;
  private resumeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly cdr: ChangeDetectorRef) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['visible']) {
      if (this.visible) {
        this.startScanning();
      } else {
        this.stopScanning();
      }
    }
  }

  ngOnDestroy(): void {
    this.stopScanning();
  }

  retry(): void {
    this.startScanning();
  }

  close(): void {
    this.stopScanning();
    this.visible = false;
    this.visibleChange.emit(false);
  }

  private async startScanning(): Promise<void> {
    if (this.starting) return;
    this.starting = true;
    this.state = 'requesting';
    this.errorMessage = '';

    // Give the dialog a tick to render the region div before Html5Qrcode looks it up.
    await new Promise((resolve) => setTimeout(resolve, 0));

    // On some browser/camera combinations `Html5Qrcode.start()`'s own promise resolves late (or
    // inconsistently) relative to when the camera is actually live — the video feed and decode
    // loop can be running well before that promise settles. Poll the library's own `isScanning`
    // flag instead of waiting on the promise to flip the UI, so "Pidiendo acceso..." clears the
    // moment the camera is truly active rather than whenever `start()` happens to resolve.
    let poll: ReturnType<typeof setInterval> | null = null;

    try {
      if (!this.scanner) {
        // Every code scanned here (SKU labels, IMEI/serial labels) is a 1D barcode, never a QR —
        // restricting formats skips the QR/DataMatrix/PDF417/Aztec decode passes on every single
        // frame, which is both faster per frame and avoids the decoder occasionally misreading a
        // barcode as a fringe 2D format it was never meant to be.
        this.scanner = new Html5Qrcode(this.regionId, {
          formatsToSupport: [
            Html5QrcodeSupportedFormats.CODE_128,
            Html5QrcodeSupportedFormats.CODE_39,
            Html5QrcodeSupportedFormats.CODE_93,
            Html5QrcodeSupportedFormats.EAN_13,
            Html5QrcodeSupportedFormats.EAN_8,
            Html5QrcodeSupportedFormats.UPC_A,
            Html5QrcodeSupportedFormats.UPC_E,
            Html5QrcodeSupportedFormats.CODABAR,
            Html5QrcodeSupportedFormats.ITF,
          ],
          useBarCodeDetectorIfSupported: true,
          verbose: false,
        });
      }
      poll = setInterval(() => {
        if (this.scanner?.isScanning && this.state === 'requesting') {
          this.state = 'scanning';
          this.cdr.detectChanges();
        }
      }, 150);

      await this.scanner.start(
        // `Html5Qrcode.start()`'s first arg is deliberately restrictive: an object form accepts
        // EXACTLY ONE key (`facingMode` or `deviceId`) — anything else throws synchronously
        // ("'cameraIdOrConfig' object should have exactly 1 key"). Resolution goes in the second
        // arg's `videoConstraints` instead (below), never merged in here.
        { facingMode: 'environment' },
        {
          fps: 10,
          // Most codes here are 1D barcodes (SKU/IMEI labels), not square QR codes — a wide
          // rectangle both matches what the decoder actually reads and, drawn by html5-qrcode as
          // the on-screen viewfinder cutout, shows the operator the real scan area instead of a
          // misleading square. Sized as a function of the actual video feed so it never overflows
          // a narrow phone preview (fixed px sizing would, on some devices, draw past the edges).
          qrbox: (viewfinderWidth: number, viewfinderHeight: number) => {
            const width = Math.floor(Math.min(viewfinderWidth * 0.85, 320));
            const height = Math.floor(Math.min(viewfinderHeight * 0.4, width * 0.45));
            return { width, height: Math.max(height, 80) };
          },
          // Small 1D barcodes need real pixel detail to decode reliably — the browser's default
          // camera resolution is often much lower than this and blurs fine barcode bars away.
          // `ideal` (not `exact`) so it degrades gracefully on cameras that can't hit 1080p.
          videoConstraints: {
            facingMode: 'environment',
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
        },
        (decodedText: string) => this.onScanSuccess(decodedText),
        () => {
          // Per-frame decode failure — expected constantly while aiming the camera, not an error.
        },
      );
      this.state = 'scanning';
    } catch (err: any) {
      this.state = this.classifyError(err);
      this.errorMessage = this.messageForState(this.state, err);
    } finally {
      if (poll) clearInterval(poll);
      this.starting = false;
      this.cdr.detectChanges();
    }
  }

  private onScanSuccess(decodedText: string): void {
    this.scanned.emit(decodedText);
    if (!this.continuous) {
      this.close();
      return;
    }
    // The scanned code is still in frame right after a hit — pause the decode loop briefly so it
    // isn't fired again before the operator moves to the next code, then resume automatically.
    this.scanner?.pause(true);
    if (this.resumeTimer) clearTimeout(this.resumeTimer);
    this.resumeTimer = setTimeout(() => {
      this.resumeTimer = null;
      try {
        this.scanner?.resume();
      } catch {
        // Dialog may have closed (unrelated navigation) during the pause window — no-op.
      }
    }, 1200);
  }

  private async stopScanning(): Promise<void> {
    if (this.resumeTimer) {
      clearTimeout(this.resumeTimer);
      this.resumeTimer = null;
    }
    const scanner = this.scanner;
    if (!scanner) return;
    try {
      if (scanner.isScanning) {
        await scanner.stop();
      }
      scanner.clear();
    } catch {
      // Already stopped/cleared, or the video element is gone (dialog closed mid-request) — no-op.
    } finally {
      this.scanner = null;
      this.state = 'idle';
      this.cdr.detectChanges();
    }
  }

  /**
   * `html5-qrcode` wraps `getUserMedia` errors but doesn't guarantee a stable error taxonomy
   * across browsers, so classify by the standard `DOMException.name` first and fall back to a
   * message-text match for the cases where the library re-throws a plain string/Error instead.
   */
  private classifyError(err: any): ScannerState {
    const name = err?.name ?? '';
    const message = String(err?.message ?? err ?? '').toLowerCase();

    if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || message.includes('permission')) {
      return 'denied';
    }
    if (
      name === 'NotFoundError' ||
      name === 'DevicesNotFoundError' ||
      message.includes('no camera') ||
      message.includes('requested device not found')
    ) {
      return 'no-camera';
    }
    return 'error';
  }

  private messageForState(state: ScannerState, err: any): string {
    switch (state) {
      case 'denied':
        return 'Permiso de cámara denegado. Habilitalo en la configuración del navegador o escribí el valor a mano.';
      case 'no-camera':
        return 'No se encontró ninguna cámara disponible en este dispositivo. Escribí el valor a mano.';
      default:
        return `No se pudo iniciar la cámara (${err?.message ?? err ?? 'error desconocido'}). Escribí el valor a mano.`;
    }
  }
}
