import { Routes } from '@angular/router';
import { Home } from './home/home';
import { Projects } from './projects/projects';
import { Hobbies } from './hobbies/hobbies';
import { Contact } from './contact/contact';
import { navigationResolver } from './navigation-resolver';

export const routes: Routes = [
  { path: '', redirectTo: '/home', pathMatch: 'full' },
  {
    path: 'home',
    component: Home,
    resolve: { navigationData: navigationResolver },
  },
  {
    path: 'projects',
    component: Projects,
    resolve: { navigationData: navigationResolver },
  },
  {
    path: 'projects/interactable/number-crunch',
    loadComponent: () =>
      import('./projects/number-crunch/number-crunch').then((m) => m.NumberCrunch),
  },
  {
    path: 'projects/interactable/potion-drop',
    loadComponent: () =>
      import('./projects/potion-drop/potion-drop.component').then((m) => m.PotionDropComponent),
  },
  {
    path: 'projects/interactable/monkeys',
    loadComponent: () =>
      import('./projects/monkeys/monkeys.component').then((m) => m.MonkeysComponent),
  },
  {
    path: 'hobbies',
    component: Hobbies,
    resolve: { navigationData: navigationResolver },
  },
  {
    path: 'contact',
    component: Contact,
    resolve: { navigationData: navigationResolver },
  },
];
