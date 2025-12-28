// Carousel functionality
let currentSlideIndex = 0;
let slides = [];
let dots = [];
let carouselInterval = null;

function moveSlide(direction) {
    // Bounds checking
    if (slides.length === 0 || dots.length === 0) return;
    
    // Remove active class from current slide and dot
    slides[currentSlideIndex].classList.remove('active');
    dots[currentSlideIndex].classList.remove('active');
    
    // Update slide index
    currentSlideIndex += direction;
    
    // Wrap around if needed
    if (currentSlideIndex >= slides.length) {
        currentSlideIndex = 0;
    } else if (currentSlideIndex < 0) {
        currentSlideIndex = slides.length - 1;
    }
    
    // Add active class to new slide and dot
    slides[currentSlideIndex].classList.add('active');
    dots[currentSlideIndex].classList.add('active');
}

function currentSlide(index) {
    // Bounds checking
    if (slides.length === 0 || dots.length === 0 || index < 0 || index >= slides.length) return;
    
    // Remove active class from current slide and dot
    slides[currentSlideIndex].classList.remove('active');
    dots[currentSlideIndex].classList.remove('active');
    
    // Update to selected slide
    currentSlideIndex = index;
    
    // Add active class to new slide and dot
    slides[currentSlideIndex].classList.add('active');
    dots[currentSlideIndex].classList.add('active');
}

// Navigation functionality
document.addEventListener('DOMContentLoaded', function() {
    // Cache DOM elements
    slides = document.querySelectorAll('.carousel-slide');
    dots = document.querySelectorAll('.dot');
    
    const navLinks = document.querySelectorAll('.nav-links a');
    const sections = document.querySelectorAll('.section');
    
    navLinks.forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            
            // Remove active class from all links and sections
            navLinks.forEach(l => l.classList.remove('active'));
            sections.forEach(s => s.classList.remove('active'));
            
            // Add active class to clicked link
            this.classList.add('active');
            
            // Show corresponding section
            const targetId = this.getAttribute('href').substring(1);
            const targetSection = document.getElementById(targetId);
            if (targetSection) {
                targetSection.classList.add('active');
            }
        });
    });
    
    // Auto-advance carousel every 5 seconds
    carouselInterval = setInterval(() => {
        moveSlide(1);
    }, 5000);
});
