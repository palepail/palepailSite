import { inject } from '@angular/core';
import { ResolveFn } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { NavigationService, NavigationData } from './navigation';
import { Observable, of, forkJoin } from 'rxjs';
import { catchError, tap, map } from 'rxjs/operators';

export const navigationResolver: ResolveFn<NavigationData> = (route, state) => {
  const http = inject(HttpClient);
  const navigationService = inject(NavigationService);

  // Check if data is already loaded
  if (navigationService.getNavigationData()) {
    return of(navigationService.getNavigationData()!);
  }

  return forkJoin({
    navigation: http.get('/assets/navigation.json'),
    projects: http.get('/assets/projects.json'),
    hobbies: http.get('/assets/hobbies.json')
  }).pipe(
    map(data => {
      // Combine the data
      const navigationData: NavigationData = {
        ...data.navigation as NavigationData,
        projects: (data.projects as any).projects,
        hobbies: (data.hobbies as any).hobbies
      };
      return navigationData;
    }),
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
