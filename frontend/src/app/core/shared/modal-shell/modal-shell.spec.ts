import { TestBed } from '@angular/core/testing';
import {
  provideTranslateLoader,
  provideTranslateService,
  TranslateNoOpLoader,
} from '@ngx-translate/core';
import { ModalShellComponent } from './modal-shell';

describe('ModalShellComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ModalShellComponent],
      providers: [
        provideTranslateService({
          lang: 'en',
          fallbackLang: 'en',
          loader: provideTranslateLoader(TranslateNoOpLoader),
        }),
      ],
    }).compileComponents();
  });

  it('keeps the native dialog out of the tab order', () => {
    const fixture = TestBed.createComponent(ModalShellComponent);
    fixture.componentRef.setInput('isOpen', true);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const dialog = host.querySelector('dialog') as HTMLDialogElement;

    expect(dialog).not.toBeNull();
    expect(dialog.getAttribute('tabindex')).toBe('-1');
    expect(host.querySelector('#modal-shell-root-panel')?.getAttribute('tabindex')).toBe('-1');
  });

  it('activates an opened dialog without changing its tabindex', () => {
    vi.useFakeTimers();
    const fixture = TestBed.createComponent(ModalShellComponent);
    fixture.componentRef.setInput('isOpen', true);
    fixture.detectChanges();

    vi.runAllTimers();
    fixture.detectChanges();

    const dialog = (fixture.nativeElement as HTMLElement).querySelector('dialog');
    expect(dialog?.getAttribute('tabindex')).toBe('-1');
    expect(dialog?.classList.contains('flex')).toBe(true);
  });
});
