import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { NavigationTab } from '../navigation';

@Component({
  selector: 'app-contact',
  imports: [],
  templateUrl: './contact.html',
  styleUrl: './contact.css',
})
export class Contact implements OnInit {
  contactData: NavigationTab | undefined;

  constructor(private route: ActivatedRoute) {}

  ngOnInit() {
    // Data is already resolved by the route resolver
    const navigationData = this.route.snapshot.data['navigationData'];
    if (navigationData) {
      this.contactData = navigationData.navigation.find((tab: NavigationTab) => tab.id === 'contact');
    }
  }
}
