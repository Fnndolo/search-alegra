import { ApplicationConfig, importProvidersFrom, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import Aura from '@primeng/themes/aura';

import { routes } from './app.routes';
import { providePrimeNG } from 'primeng/config';
import { HttpClientModule } from '@angular/common/http';

export const appConfig: ApplicationConfig = {
  providers: [provideZoneChangeDetection({ eventCoalescing: true }), provideRouter(routes), providePrimeNG({
            theme: {
                preset: Aura,
                options: {
                    prefix: 'p',
                    darkModeSelector: 'none',
                    cssLayer: false
                }
            }
        }),
    importProvidersFrom(HttpClientModule)
],
        
};
