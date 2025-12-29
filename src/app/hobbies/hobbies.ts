import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { NavigationTab, Subtab } from '../navigation';

@Component({
  selector: 'app-hobbies',
  imports: [CommonModule],
  templateUrl: './hobbies.html',
  styleUrl: './hobbies.css',
})
export class Hobbies implements OnInit {
  hobbiesData: NavigationTab | undefined;
  subtabs: Subtab[] = [];

  constructor(private route: ActivatedRoute) {}

  ngOnInit() {
    // Data is already resolved by the route resolver
    const navigationData = this.route.snapshot.data['navigationData'];
    if (navigationData) {
      const hobbiesTab = navigationData.navigation.find((tab: NavigationTab) => tab.id === 'hobbies');
      this.hobbiesData = hobbiesTab;
      this.subtabs = navigationData.hobbies || [];
    }
  }
}
