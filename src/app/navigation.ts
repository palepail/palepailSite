import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map, catchError, throwError, BehaviorSubject } from 'rxjs';

export interface CarouselItem {
  image: string;
  caption: string;
}

export interface Project {
  title: string;
  description: string;
  technologies: string[];
  image: string;
  link: string;
  status: { name: string }[];
}

export interface Activity {
  title: string;
  description: string;
  image: string;
  details: string;
  skillLevel?: string;
  status: string;
}

export interface Subtab {
  id: string;
  name: string;
  description: string;
  projects?: Project[];
  activities?: Activity[];
}

export interface TabContent {
  title?: string;
  intro?: string;
  carousel?: CarouselItem[];
}

export interface NavigationTab {
  id: string;
  name: string;
  route: string;
  hasSubtabs: boolean;
  subtabs?: Subtab[];
  content?: TabContent;
}

export interface NavigationData {
  navigation: NavigationTab[];
  projects?: Subtab[];
  hobbies?: Subtab[];
}

@Injectable({
  providedIn: 'root',
})
export class NavigationService {
  private navigationData: NavigationData | null = null;

  constructor() {}

  setNavigationData(data: NavigationData) {
    this.navigationData = data;
  }

  getNavigationData(): NavigationData | null {
    return this.navigationData;
  }

  getTabData(tabId: string): NavigationTab | undefined {
    return this.navigationData?.navigation.find(tab => tab.id === tabId);
  }

  getAllTabs(): NavigationTab[] {
    return this.navigationData?.navigation || [];
  }
}
