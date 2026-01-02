import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PotionDropComponent } from './potion-drop.component';

describe('PotionDropComponent', () => {
  let component: PotionDropComponent;
  let fixture: ComponentFixture<PotionDropComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PotionDropComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(PotionDropComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});