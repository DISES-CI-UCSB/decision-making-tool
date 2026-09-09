import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  provideTranslateLoader,
  provideTranslateService,
  TranslateNoOpLoader,
} from '@ngx-translate/core';
import { TableHeaderTooltipComponent } from './table-header-tooltip';

describe('TableHeaderTooltipComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TableHeaderTooltipComponent],
      providers: [
        provideTranslateService({
          lang: 'en',
          fallbackLang: 'en',
          loader: provideTranslateLoader(TranslateNoOpLoader),
        }),
      ],
    }).compileComponents();
  });

  function createTooltip(
    align: 'start' | 'end' = 'start',
    idBase = 'table-header-tooltip-spec',
  ): {
    fixture: ComponentFixture<TableHeaderTooltipComponent>;
    trigger: HTMLButtonElement;
    panel: HTMLElement;
  } {
    const fixture = TestBed.createComponent(TableHeaderTooltipComponent);
    fixture.componentRef.setInput('idBase', idBase);
    fixture.componentRef.setInput('labelKey', 'column.label');
    fixture.componentRef.setInput('questionKey', 'column.help');
    fixture.componentRef.setInput('align', align);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    return {
      fixture,
      trigger: compiled.querySelector(`#${idBase}-help-trigger`) as HTMLButtonElement,
      panel: compiled.querySelector('[role="tooltip"]') as HTMLElement,
    };
  }

  it('keeps a closed tooltip out of ancestor overflow with display none', () => {
    const { panel, fixture } = createTooltip('start', 'table-header-tooltip-spec-closed');
    expect(panel).not.toBeNull();
    expect(panel.classList.contains('hidden')).toBe(true);
    expect(panel.classList.contains('block')).toBe(false);
    expect(panel.classList.contains('opacity-0')).toBe(false);
    expect(panel.classList.contains('left-0')).toBe(true);
    expect(panel.classList.contains('right-0')).toBe(false);
    fixture.destroy();
  });

  it('opens toward the requested edge and stays in the document when pinned', () => {
    const { panel, trigger, fixture } = createTooltip('end', 'table-header-tooltip-spec-pinned');
    expect(panel).not.toBeNull();
    expect(panel.classList.contains('right-0')).toBe(true);
    expect(panel.classList.contains('left-0')).toBe(false);

    trigger.click();
    fixture.detectChanges();

    expect(panel.classList.contains('block')).toBe(true);
    expect(panel.classList.contains('hidden')).toBe(false);
    expect(panel.classList.contains('right-0')).toBe(true);
    fixture.destroy();
  });

  it('sorts from the label button without opening help', () => {
    const fixture = TestBed.createComponent(TableHeaderTooltipComponent);
    fixture.componentRef.setInput('idBase', 'table-header-tooltip-spec-sort');
    fixture.componentRef.setInput('labelKey', 'column.label');
    fixture.componentRef.setInput('questionKey', 'column.help');
    fixture.componentRef.setInput('sortable', true);
    fixture.componentRef.setInput('sortDirection', 'none');
    fixture.componentRef.setInput('sortAriaLabel', 'Sort by Coverage');
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const sortButton = compiled.querySelector(
      '#table-header-tooltip-spec-sort-sort-button',
    ) as HTMLButtonElement;
    const helpTrigger = compiled.querySelector(
      '#table-header-tooltip-spec-sort-help-trigger',
    ) as HTMLButtonElement;
    const panel = compiled.querySelector('[role="tooltip"]') as HTMLElement;
    const emitSpy = vi.spyOn(fixture.componentInstance.sortClick, 'emit');

    sortButton.click();
    fixture.detectChanges();

    expect(emitSpy).toHaveBeenCalledTimes(1);
    expect(panel.classList.contains('hidden')).toBe(true);
    expect(sortButton.getAttribute('aria-label')).toBe('Sort by Coverage');

    helpTrigger.click();
    fixture.detectChanges();
    expect(emitSpy).toHaveBeenCalledTimes(1);
    expect(panel.classList.contains('block')).toBe(true);
    fixture.destroy();
  });
});
