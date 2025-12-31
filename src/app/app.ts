import { Component, signal } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive, Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  protected readonly title = signal('palepailSite');
  sidebarOpen = false;
  isNumberCrunchPage = false;

  constructor(private router: Router) {
    // Listen to navigation events
    this.router.events.pipe(
      filter(event => event instanceof NavigationEnd)
    ).subscribe((event: NavigationEnd) => {
      console.log('Navigation event:', event.url);
      this.isNumberCrunchPage = event.url.includes('number-crunch');
      console.log('isNumberCrunchPage:', this.isNumberCrunchPage);
      
      // Add/remove class from body for global styling
      if (this.isNumberCrunchPage) {
        document.body.classList.add('number-crunch-active');
        console.log('Added number-crunch-active class to body');
      } else {
        document.body.classList.remove('number-crunch-active');
        console.log('Removed number-crunch-active class from body');
      }
      console.log('Body classes:', document.body.className);
    });
  }

  onNavClick(route: string) {
    console.log('Navigation link clicked:', route);
    // Close sidebar on mobile when navigation occurs
    if (window.innerWidth <= 768) {
      this.sidebarOpen = false;
    }
  }

  toggleSidebar() {
    this.sidebarOpen = !this.sidebarOpen;
  }
}
