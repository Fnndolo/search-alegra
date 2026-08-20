import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  OnChanges,
  SimpleChanges,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Popover } from 'primeng/popover';
import { InventoryApiService } from '../../services/inventory-api.service';
import { Color } from '../../models/inventory.models';

export interface ColorSelectedEvent {
  colorId: string;
  preview: Color;
}

/**
 * Color picker used everywhere a color variant gets created (nuevo producto, importar producto,
 * editar variantes de un producto existente, ordenes de compra): a dropdown listing the full color
 * catalog (swatch + name) plus a "Crear nuevo" footer action. Every selection resolves to a real
 * colorId, so callers never need to handle a free-text/no-id case.
 *
 * The color list is a p-popover (appendTo="body") anchored to the trigger. Needed because this
 * component lives inside p-dialog modals (nuevo producto, importar producto) whose own
 * overflow/scroll container clipped/pushed around a locally-positioned panel.
 *
 * "Crear nuevo" is an absolutely-positioned overlay INSIDE that same popover (not a separate
 * p-dialog) — nesting it there means it stacks above the color list "for free" via normal DOM
 * layering instead of fighting two independent PrimeNG overlays (popover vs dialog) over z-index.
 */
@Component({
  selector: 'app-color-picker',
  standalone: true,
  imports: [CommonModule, FormsModule, Popover],
  templateUrl: './color-picker.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ColorPickerComponent implements OnInit, OnChanges {
  @Input() initialColor: Color | null = null;
  @Input() placeholder = 'Elegir color...';
  @Output() colorSelected = new EventEmitter<ColorSelectedEvent>();

  @ViewChild('op') private popover!: Popover;

  filterText = '';
  allColors: Color[] = [];
  loadingColors = false;
  private colorsLoaded = false;

  selectedColor: Color | null = null;

  creatingNew = false;
  newColorName = '';
  newColorHex = '#cccccc';
  creating = false;
  createError = '';

  constructor(
    private readonly api: InventoryApiService,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.selectedColor = this.initialColor;
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['initialColor'] && !changes['initialColor'].firstChange) {
      this.selectedColor = this.initialColor;
    }
  }

  get filteredColors(): Color[] {
    const term = this.filterText.trim().toLowerCase();
    if (!term) return this.allColors;
    return this.allColors.filter((c) => c.name.toLowerCase().includes(term));
  }

  toggle(event: Event): void {
    this.filterText = '';
    // The palette is small and rarely changes mid-session, fetch once, reuse on every reopen.
    if (!this.colorsLoaded) this.loadColors();
    this.popover.toggle(event);
  }

  private loadColors(): void {
    this.loadingColors = true;
    this.api.searchColors().subscribe({
      next: (colors) => {
        this.allColors = colors;
        this.colorsLoaded = true;
        this.loadingColors = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.loadingColors = false;
        this.cdr.markForCheck();
      },
    });
  }

  selectColor(color: Color): void {
    this.selectedColor = color;
    this.popover.hide();
    this.colorSelected.emit({ colorId: color.id, preview: color });
  }

  /** Opens the create-color dialog. The color-list popover behind it is left open on purpose. */
  startCreate(): void {
    this.newColorName = this.filterText.trim();
    this.newColorHex = '#cccccc';
    this.createError = '';
    this.creatingNew = true;
  }

  cancelCreate(): void {
    this.creatingNew = false;
  }

  saveNewColor(): void {
    const name = this.newColorName.trim();
    if (!name) {
      this.createError = 'El nombre es obligatorio';
      return;
    }
    this.creating = true;
    this.createError = '';
    this.api.createColor({ name, hexCode: this.newColorHex }).subscribe({
      next: (color) => {
        this.creating = false;
        this.allColors = [...this.allColors, color];
        this.creatingNew = false;
        this.selectColor(color);
      },
      error: () => {
        this.creating = false;
        this.createError = 'No se pudo crear el color';
        this.cdr.markForCheck();
      },
    });
  }

  swatchStyle(color: Color | null): Record<string, string> {
    // `color` sometimes arrives as a raw nested entity (e.g. `initialColor` set from an existing
    // variant's `color`) instead of the /colors endpoint's mapped DTO. The entity's column is
    // `hex_code`, not `hexCode`.
    const hex = color?.hexCode ?? color?.hex_code;
    return { background: hex || '#e5e7eb' };
  }
}
