import {
  provideBrowserGlobalErrorListeners,
  provideAppInitializer,
  inject,
  type ApplicationConfig,
} from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';

import { routes } from './app.routes';
import { authInterceptor } from './core/interceptors/auth.interceptor';
import { errorInterceptor } from './core/interceptors/error.interceptor';
import { refreshInterceptor } from './core/interceptors/refresh.interceptor';
import { AuthStore } from './features/auth/data/auth.store';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),

    // withComponentInputBinding: route params and `data` arrive as component
    // input() signals, so no component in this app injects ActivatedRoute.
    provideRouter(routes, withComponentInputBinding()),

    provideHttpClient(
      // fetch is the default in Angular 22; withFetch() is deprecated.
      // Order is the request order: attach the token, then normalise errors,
      // then let refresh see a typed AppError and retry.
      withInterceptors([authInterceptor, errorInterceptor, refreshInterceptor]),
    ),

    // Restore the session from the httpOnly refresh cookie before the first
    // route resolves, so a hard refresh never flashes the signed-out state.
    provideAppInitializer(() => inject(AuthStore).restore()),
  ],
};
