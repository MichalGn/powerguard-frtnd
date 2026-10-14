import { APP_INITIALIZER, ApplicationConfig, provideBrowserGlobalErrorListeners, provideZoneChangeDetection } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { TranslationService } from './shared/i18n/translation.service';

function initializeTranslations(i18n: TranslationService): () => Promise<void> {
  return () => i18n.initialize();
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideHttpClient(),
    { provide: APP_INITIALIZER, useFactory: initializeTranslations, deps: [TranslationService], multi: true },
  ]
};
