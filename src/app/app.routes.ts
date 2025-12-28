import { Routes } from '@angular/router';
import { Home } from './home/home';
import { Projects } from './projects/projects';
import { Hobbies } from './hobbies/hobbies';
import { Contact } from './contact/contact';

export const routes: Routes = [
  { path: '', redirectTo: '/home', pathMatch: 'full' },
  { path: 'home', component: Home },
  { path: 'projects', component: Projects },
  { path: 'hobbies', component: Hobbies },
  { path: 'contact', component: Contact },
];
