import { Component, ElementRef, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { NavigationService, NavigationTab, CarouselItem } from '../navigation';

@Component({
  selector: 'app-home',
  imports: [CommonModule],
  templateUrl: './home.html',
  styleUrl: './home.css',
})
export class Home implements OnInit, OnDestroy {
  private currentSlideIndex = 0;
  private slides: HTMLElement[] = [];
  private dots: HTMLElement[] = [];
  private carouselInterval: any;
  homeData: NavigationTab | undefined;
  carouselItems: CarouselItem[] = [];

  constructor(private el: ElementRef, private route: ActivatedRoute) {}

  ngOnInit() {
    // Data is already resolved by the route resolver
    const navigationData = this.route.snapshot.data['navigationData'];
    if (navigationData) {
      const homeTab = navigationData.navigation.find((tab: NavigationTab) => tab.id === 'home');
      this.homeData = homeTab;
      if (homeTab?.content?.carousel) {
        this.carouselItems = homeTab.content.carousel;
        // Wait for template to render, then initialize carousel
        setTimeout(() => this.initializeCarousel(), 0);
      }
    }
  }

  ngOnDestroy() {
    if (this.carouselInterval) {
      clearInterval(this.carouselInterval);
    }
  }

  private initializeCarousel() {
    this.slides = Array.from(this.el.nativeElement.querySelectorAll('.carousel-slide'));
    this.dots = Array.from(this.el.nativeElement.querySelectorAll('.dot'));
    // Auto-advance carousel every 5 seconds
    this.carouselInterval = setInterval(() => {
      this.moveSlide(1);
    }, 5000);
  }

  moveSlide(direction: number) {
    if (this.slides.length === 0 || this.dots.length === 0) return;

    // Remove active class from current slide and dot
    this.slides[this.currentSlideIndex].classList.remove('active');
    this.dots[this.currentSlideIndex].classList.remove('active');

    // Update slide index
    this.currentSlideIndex += direction;

    // Wrap around if needed
    if (this.currentSlideIndex >= this.slides.length) {
      this.currentSlideIndex = 0;
    } else if (this.currentSlideIndex < 0) {
      this.currentSlideIndex = this.slides.length - 1;
    }

    // Add active class to new slide and dot
    this.slides[this.currentSlideIndex].classList.add('active');
    this.dots[this.currentSlideIndex].classList.add('active');
  }

  currentSlide(index: number) {
    if (this.slides.length === 0 || this.dots.length === 0 || index < 0 || index >= this.slides.length) return;

    // Remove active class from current slide and dot
    this.slides[this.currentSlideIndex].classList.remove('active');
    this.dots[this.currentSlideIndex].classList.remove('active');

    // Update to selected slide
    this.currentSlideIndex = index;

    // Add active class to new slide and dot
    this.slides[this.currentSlideIndex].classList.add('active');
    this.dots[this.currentSlideIndex].classList.add('active');
  }
}
