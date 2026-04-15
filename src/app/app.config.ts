import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withViewTransitions } from '@angular/router';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { providePrimeNG } from 'primeng/config';
import Aura from '@primeng/themes/aura';
import { definePreset } from '@primeng/themes';
import { routes } from './app.routes';

const SanctuaryPreset = definePreset(Aura, {
  semantic: {
    primary: {
      50:  '{stone.50}',
      100: '{stone.100}',
      200: '{stone.200}',
      300: '{stone.300}',
      400: '{stone.400}',
      500: '{stone.500}',
      600: '{stone.600}',
      700: '{stone.700}',
      800: '{stone.800}',
      900: '{stone.900}',
      950: '{stone.950}',
    },
    colorScheme: {
      light: {
        surface: {
          0:   '#ffffff',
          50:  '#faf9f7',
          100: '#f5f4f0',
          200: '#ede9e4',
          300: '#ddd8d2',
          400: '#c4bdb6',
          500: '#a89e96',
          600: '#8a7f78',
          700: '#6b6259',
          800: '#4a4440',
          900: '#2d2926',
          950: '#1a1714',
        },
        primary: {
          color: '{stone.900}',
          contrastColor: '#ffffff',
          hoverColor: '{stone.700}',
          activeColor: '{stone.800}',
        },
        highlight: {
          background: '#fdf4e7',
          focusBackground: '#fde8c8',
          color: '#92400e',
          focusColor: '#78350f',
        },
      },
    },
  },
});

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withViewTransitions()),
    provideAnimationsAsync(),
    providePrimeNG({
      theme: {
        preset: SanctuaryPreset,
        options: { darkModeSelector: '.app-dark', cssLayer: false },
      },
      ripple: true,
    }),
  ],
};
