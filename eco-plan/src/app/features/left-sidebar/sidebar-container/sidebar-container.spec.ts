import { TestBed } from '@angular/core/testing';
import {
  provideTranslateLoader,
  provideTranslateService,
  TranslateNoOpLoader,
} from '@ngx-translate/core';
import { SidebarContainerComponent } from './sidebar-container';

describe('SidebarContainerComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SidebarContainerComponent],
      providers: [
        provideTranslateService({
          lang: 'en',
          fallbackLang: 'en',
          loader: provideTranslateLoader(TranslateNoOpLoader),
        }),
      ],
    }).compileComponents();
  });

  it('renders onboarding content above the control sections', () => {
    const fixture = TestBed.createComponent(SidebarContainerComponent);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('#left-sidebar-onboarding-panel')).not.toBeNull();
    expect(compiled.querySelector('#left-sidebar-section-active-solution')).not.toBeNull();
  });

  it('emits when the onboarding get started button is clicked', () => {
    const fixture = TestBed.createComponent(SidebarContainerComponent);
    const component = fixture.componentInstance;
    const emitSpy = vi.spyOn(component.solutionFinderRequested, 'emit');

    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector(
      '#left-sidebar-onboarding-get-started-button',
    ) as HTMLButtonElement;
    button.click();

    expect(emitSpy).toHaveBeenCalled();
  });
});
