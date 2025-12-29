import { Routes } from '@angular/router';
import { Home } from './home/home';
import { Projects } from './projects/projects';
import { Hobbies } from './hobbies/hobbies';
import { Contact } from './contact/contact';
import { NumberCrunch } from './projects/number-crunch/number-crunch';
import { navigationResolver } from './navigation-resolver';

export const routes: Routes = [
  { path: '', redirectTo: '/home', pathMatch: 'full' },
  {
    path: 'home',
    component: Home,
    resolve: { navigationData: navigationResolver }
  },
  {
    path: 'projects',
    component: Projects,
    resolve: { navigationData: navigationResolver }
  },
  {
    path: 'projects/interactable/number-crunch',
    component: NumberCrunch
  },
  {
    path: 'hobbies',
    component: Hobbies,
    resolve: { navigationData: navigationResolver }
  },
  {
    path: 'contact',
    component: Contact,
    resolve: { navigationData: navigationResolver }
  },
];
