import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { NavigationTab, Subtab } from '../navigation';

@Component({
  selector: 'app-projects',
  imports: [CommonModule],
  templateUrl: './projects.html',
  styleUrl: './projects.css',
})
export class Projects implements OnInit {
  projectsData: NavigationTab | undefined;
  subtabs: Subtab[] = [];

  constructor(private route: ActivatedRoute) {}

  ngOnInit() {
    // Data is already resolved by the route resolver
    const navigationData = this.route.snapshot.data['navigationData'];
    if (navigationData) {
      const projectsTab = navigationData.navigation.find((tab: NavigationTab) => tab.id === 'projects');
      this.projectsData = projectsTab;
      this.subtabs = navigationData.projects || [];
    }
  }
}
