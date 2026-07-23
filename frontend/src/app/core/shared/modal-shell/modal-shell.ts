import { CommonModule } from '@angular/common';
import {
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

const MODAL_TRANSITION_MS = 220;
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export type ModalShellMode = 'standard' | 'wide' | 'full-screen';
export type ModalCloseSource = 'backdrop' | 'escape' | 'button';
export type ModalHeaderAlign = 'center' | 'start';
export type ModalInitialFocus = 'first-focusable' | 'panel';

@Component({
  selector: 'app-modal-shell',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  templateUrl: './modal-shell.html',
})
export class ModalShellComponent implements OnChanges, OnDestroy {
  @Input() rootId = 'modal-shell-root';
  @Input() isOpen = false;
  @Input() mode: ModalShellMode = 'standard';
  @Input() titleKey = '';
  @Input() ariaLabelKey = '';
  @Input() closeOnBackdrop = true;
  @Input() closeOnEscape = true;
  @Input() showCloseButton = true;
  @Input() headerAlign: ModalHeaderAlign = 'center';
  @Input() initialFocus: ModalInitialFocus = 'first-focusable';

  @Output() readonly requestClose = new EventEmitter<ModalCloseSource>();

  @ViewChild('panelElement') private readonly panelElement?: ElementRef<HTMLElement>;
  @ViewChild('dialogElement') private readonly dialogElement?: ElementRef<HTMLDialogElement>;

  protected isRendered = false;
  protected isActive = false;
  protected isDialogOpen = false;

  private openTimer: ReturnType<typeof setTimeout> | null = null;
  private closeTimer: ReturnType<typeof setTimeout> | null = null;
  private bodyOverflowBeforeLock = '';
  private bodyScrollLocked = false;
  private previouslyFocusedElement: HTMLElement | null = null;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen']) {
      this.syncModalState();
    }
  }

  ngOnDestroy(): void {
    this.clearOpenTimer();
    this.clearCloseTimer();
    const dialog = this.dialogElement?.nativeElement;
    if (dialog?.open) {
      if (typeof dialog.close === 'function') {
        dialog.close();
      } else {
        dialog.removeAttribute('open');
      }
    }
    this.isDialogOpen = false;
    this.unlockBodyScroll();
    this.restorePreviousFocus();
  }

  protected onBackdropClick(event: MouseEvent): void {
    if (!this.closeOnBackdrop || event.target !== event.currentTarget) {
      return;
    }

    this.requestClose.emit('backdrop');
  }

  protected onBackdropKeydown(event: KeyboardEvent): void {
    if (!this.closeOnBackdrop || (event.key !== 'Enter' && event.key !== ' ')) {
      return;
    }

    event.preventDefault();
    this.requestClose.emit('backdrop');
  }

  protected onCloseButtonClick(): void {
    this.requestClose.emit('button');
  }

  protected onNativeCancel(event: Event): void {
    event.preventDefault();
    if (this.closeOnEscape) {
      this.requestClose.emit('escape');
    }
  }

  protected onPanelKeydown(event: KeyboardEvent): void {
    if (event.key === 'Tab') {
      this.trapFocus(event);
      return;
    }

    if (event.key === 'Escape' && this.closeOnEscape) {
      event.preventDefault();
      this.requestClose.emit('escape');
    }
  }

  private syncModalState(): void {
    if (this.isOpen) {
      this.openModal();
      return;
    }

    this.closeModal();
  }

  private openModal(): void {
    this.clearOpenTimer();
    this.clearCloseTimer();

    if (!this.isRendered) {
      this.previouslyFocusedElement =
        typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      this.isRendered = true;
    }

    this.openTimer = setTimeout(() => {
      const dialog = this.dialogElement?.nativeElement;
      if (dialog && !dialog.open) {
        if (typeof dialog.showModal === 'function') {
          dialog.showModal();
        } else {
          dialog.setAttribute('open', '');
        }
        this.isDialogOpen = true;
      }
      this.isActive = true;
      this.lockBodyScroll();
      this.focusInitialElement();
      this.openTimer = null;
    }, 0);
  }

  private closeModal(): void {
    this.clearOpenTimer();
    this.isActive = false;
    this.clearCloseTimer();

    this.closeTimer = setTimeout(() => {
      const dialog = this.dialogElement?.nativeElement;
      if (dialog?.open) {
        if (typeof dialog.close === 'function') {
          dialog.close();
        } else {
          dialog.removeAttribute('open');
        }
      }
      this.isDialogOpen = false;
      this.isRendered = false;
      this.unlockBodyScroll();
      this.restorePreviousFocus();
    }, MODAL_TRANSITION_MS);
  }

  private clearOpenTimer(): void {
    if (!this.openTimer) {
      return;
    }

    clearTimeout(this.openTimer);
    this.openTimer = null;
  }

  private clearCloseTimer(): void {
    if (!this.closeTimer) {
      return;
    }

    clearTimeout(this.closeTimer);
    this.closeTimer = null;
  }

  private focusInitialElement(): void {
    const panel = this.panelElement?.nativeElement;
    if (!panel) {
      return;
    }

    if (this.initialFocus === 'panel') {
      panel.focus();
      return;
    }

    const [firstFocusable] = this.getFocusableElements(panel);
    (firstFocusable ?? panel).focus();
  }

  private trapFocus(event: KeyboardEvent): void {
    const panel = this.panelElement?.nativeElement;
    if (!panel) {
      return;
    }

    const focusableElements = this.getFocusableElements(panel);
    if (focusableElements.length === 0) {
      event.preventDefault();
      panel.focus();
      return;
    }

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];
    const activeElement = document.activeElement;

    if (event.shiftKey && activeElement === firstElement) {
      event.preventDefault();
      lastElement.focus();
      return;
    }

    if (!event.shiftKey && activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus();
    }
  }

  private getFocusableElements(panel: HTMLElement): HTMLElement[] {
    return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
      (element) => element.offsetParent !== null,
    );
  }

  private lockBodyScroll(): void {
    if (this.bodyScrollLocked || typeof document === 'undefined') {
      return;
    }

    this.bodyOverflowBeforeLock = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    this.bodyScrollLocked = true;
  }

  private unlockBodyScroll(): void {
    if (!this.bodyScrollLocked || typeof document === 'undefined') {
      return;
    }

    document.body.style.overflow = this.bodyOverflowBeforeLock;
    this.bodyScrollLocked = false;
  }

  private restorePreviousFocus(): void {
    const element = this.previouslyFocusedElement;
    this.previouslyFocusedElement = null;
    if (element?.isConnected) {
      element.focus();
    }
  }
}
