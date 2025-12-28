import { inject } from '@angular/core';
import { ResolveFn } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { NavigationService, NavigationData } from './navigation';
import { Observable, of } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';

export const navigationResolver: ResolveFn<NavigationData> = (route, state) => {
  const http = inject(HttpClient);
  const navigationService = inject(NavigationService);

  // Check if data is already loaded
  if (navigationService.getNavigationData()) {
    return of(navigationService.getNavigationData()!);
  }

  return http.get<NavigationData>('/navigation.json').pipe(
    tap(data => navigationService.setNavigationData(data)),
    catchError(error => {
      console.error('Error loading navigation data:', error);
      // Return empty data on error to prevent navigation blocking
      const emptyData: NavigationData = { navigation: [] };
      navigationService.setNavigationData(emptyData);
      return of(emptyData);
    })
  );
};
