import { TestBed } from '@angular/core/testing';
import { SidebarContainerComponent } from './sidebar-container';

describe('SidebarContainerComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SidebarContainerComponent],
    }).compileComponents();
  });

  it('renders the map layers panel shell', () => {
    const fixture = TestBed.createComponent(SidebarContainerComponent);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('#left-sidebar-map-layers-panel')).not.toBeNull();
    expect(compiled.querySelector('#map-layers-sidebar-title')?.textContent).toContain(
      'Map Layers',
    );
  });

  it('emits when the select solution button is clicked', () => {
    const fixture = TestBed.createComponent(SidebarContainerComponent);
    const component = fixture.componentInstance;
    const emitSpy = vi.spyOn(component.solutionFinderRequested, 'emit');

    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector(
      '#map-layers-select-solution-button',
    ) as HTMLButtonElement;
    button.click();

    expect(emitSpy).toHaveBeenCalled();
  });
});
