import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./features/home/home-page.component').then(m => m.HomePageComponent),
  },
  {
    path: 'search',
    loadComponent: () =>
      import('./features/search/search-page.component').then(m => m.SearchPageComponent),
  },
  {
    path: 'church/:slug',
    loadComponent: () =>
      import('./features/church-detail/church-detail.component').then(m => m.ChurchDetailComponent),
  },
  { path: '**', redirectTo: '' },
];
