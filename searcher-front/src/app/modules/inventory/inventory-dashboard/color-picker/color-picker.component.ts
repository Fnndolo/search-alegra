import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { InputTextModule } from 'primeng/inputtext';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged, switchMap, catchError } from 'rxjs/operators';
import { of } from 'rxjs';
import { InventoryApiService } from '../../services/inventory-api.service';
import { Color } from '../../models/inventory.models';

export interface ColorSelectedEvent {
  /** Set when the user typed a new name that doesn't match any existing color (find-or-create). */
  color?: string;
  /** Set when the user picked an existing color from the suggestions. */
  colorId?: string;
  /** Best-effort preview of the resulting color (for showing a swatch immediately). */
  preview: Color | null;
}

/**
 * Small color autocomplete: searches the shared color catalog as the user types (debounced),
 * shows a swatch + name per suggestion, and lets the user either pick an existing color
 * (emits `colorId`) or confirm a brand-new name on blur/Enter (emits `color`).
 */
@Component({
  selector: 'app-color-picker',
  standalone: true,
  imports: [CommonModule, FormsModule, InputTextModule],
  templateUrl: './color-picker.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ColorPickerComponent implements OnInit, OnChanges, OnDestroy {
  @Input() initialColor: Color | null = null;
  @Input() placeholder = 'Buscar o escribir color...';
  @Output() colorSelected = new EventEmitter<ColorSelectedEvent>();

  query = '';
  suggestions: Color[] = [];
  showSuggestions = false;
  searching = false;

  private selectedColor: Color | null = null;
  private readonly querySubject = new Subject<string>();

  constructor(private readonly api: InventoryApiService, private readonly cdr: ChangeDetectorRef) {}

  ngOnInit(): void {
    this.applyInitialColor();

    this.querySubject
      .pipe(
        debounceTime(250),
        distinctUntilChanged(),
        switchMap((term) => {
          if (!term.trim()) return of<Color[]>([]);
          this.searching = true;
          return this.api.searchColors(term).pipe(catchError(() => of<Color[]>([])));
        }),
      )
      .subscribe((results) => {
        this.searching = false;
        this.suggestions = results;
        this.cdr.markForCheck();
      });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['initialColor'] && !changes['initialColor'].firstChange) {
      this.applyInitialColor();
    }
  }

  ngOnDestroy(): void {
    this.querySubject.complete();
  }

  private applyInitialColor(): void {
    this.selectedColor = this.initialColor;
    this.query = this.initialColor?.name ?? '';
  }

  onQueryChange(value: string): void {
    this.query = value;
    this.showSuggestions = true;
    // Any manual edit invalidates the previously selected color until confirmed again.
    if (this.selectedColor && this.selectedColor.name !== value) {
      this.selectedColor = null;
    }
    this.querySubject.next(value);
  }

  onFocus(): void {
    if (this.query.trim()) {
      this.showSuggestions = true;
      this.querySubject.next(this.query);
    }
  }

  /** mousedown (not click) fires before the input's blur, so the selection isn't lost. */
  selectColor(color: Color, event: MouseEvent): void {
    event.preventDefault();
    this.selectedColor = color;
    this.query = color.name;
    this.showSuggestions = false;
    this.colorSelected.emit({ colorId: color.id, preview: color });
  }

  onEnter(): void {
    this.confirm();
    this.showSuggestions = false;
  }

  onBlur(): void {
    // Delay so a suggestion mousedown can run first.
    setTimeout(() => {
      this.showSuggestions = false;
      this.confirm();
      this.cdr.markForCheck();
    }, 150);
  }

  private confirm(): void {
    const trimmed = this.query.trim();
    if (!trimmed) {
      this.selectedColor = null;
      return;
    }
    if (this.selectedColor && this.selectedColor.name === trimmed) {
      // Already emitted via selectColor — nothing new to confirm.
      return;
    }
    // New free-typed name — find-or-create on the backend.
    this.selectedColor = null;
    this.colorSelected.emit({ color: trimmed, preview: null });
  }

  swatchStyle(color: Color): Record<string, string> {
    return { background: color.hexCode || '#e5e7eb' };
  }
}
