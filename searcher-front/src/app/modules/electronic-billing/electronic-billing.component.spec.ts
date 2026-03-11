import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ElectronicBillingComponent } from './electronic-billing.component';

describe('ElectronicBillingComponent', () => {
  let component: ElectronicBillingComponent;
  let fixture: ComponentFixture<ElectronicBillingComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ElectronicBillingComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ElectronicBillingComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
