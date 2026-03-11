import { Pipe, PipeTransform } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

@Pipe({
  name: 'highlight',
  standalone: true
})
export class HighlightPipe implements PipeTransform {
  constructor(private sanitizer: DomSanitizer) {}

  transform(value: any, search: string): SafeHtml {
    if (!search || !value) {
      return value;
    }

    const valueStr = value.toString();
    const searchLower = search.trim().toLowerCase();
    
    if (searchLower === '') {
        return value;
    }

    const re = new RegExp(searchLower, 'gi');
    const match = valueStr.match(re);

    if (!match) {
      return value;
    }

    const highlightedValue = valueStr.replace(re, (m: string) => `<mark class="bg-yellow-200/50 text-inherit rounded-sm px-0.5">${m}</mark>`);
    return this.sanitizer.bypassSecurityTrustHtml(highlightedValue);
  }
}
