import {
  DestroyRef,
  NgZone,
  Signal,
  WritableSignal,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';

interface UseOverlayScrollbarOptions {
  hideDelayMs?: number;
}

export interface OverlayScrollbarController {
  scrollRef: WritableSignal<HTMLElement | null>;
  isScrolling: Signal<boolean>;
  thumbHeight: Signal<number>;
  thumbTop: Signal<number>;
  recalculate: () => void;
}

export function useOverlayScrollbar(
  options: UseOverlayScrollbarOptions = {},
): OverlayScrollbarController {
  const destroyRef = inject(DestroyRef);
  const ngZone = inject(NgZone);
  const hideDelayMs = options.hideDelayMs ?? 650;

  const scrollRef = signal<HTMLElement | null>(null);
  const scrolling = signal(false);
  const thumbHeightValue = signal(0);
  const thumbTopValue = signal(0);

  let hideTimerId: ReturnType<typeof setTimeout> | null = null;

  const clearHideTimer = (): void => {
    if (!hideTimerId) {
      return;
    }
    clearTimeout(hideTimerId);
    hideTimerId = null;
  };

  const scheduleHide = (): void => {
    clearHideTimer();
    hideTimerId = setTimeout(() => {
      scrolling.set(false);
    }, hideDelayMs);
  };

  const recalculate = (): void => {
    const scrollElement = scrollRef();
    if (!scrollElement) {
      thumbHeightValue.set(0);
      thumbTopValue.set(0);
      return;
    }

    const { scrollHeight, clientHeight, scrollTop } = scrollElement;
    if (scrollHeight <= clientHeight + 1) {
      thumbHeightValue.set(0);
      thumbTopValue.set(0);
      return;
    }

    const calculatedThumbHeight = Math.max(28, (clientHeight / scrollHeight) * clientHeight);
    const scrollableDistance = scrollHeight - clientHeight;
    const thumbTravelDistance = clientHeight - calculatedThumbHeight;
    const calculatedThumbTop =
      scrollableDistance <= 0 ? 0 : thumbTravelDistance * (scrollTop / scrollableDistance);

    thumbHeightValue.set(calculatedThumbHeight);
    thumbTopValue.set(calculatedThumbTop);
  };

  effect((onCleanup) => {
    const scrollElement = scrollRef();
    if (!scrollElement) {
      return;
    }

    const onScroll = (): void => {
      ngZone.run(() => {
        recalculate();
        scrolling.set(true);
        scheduleHide();
      });
    };

    const onWindowResize = (): void => {
      ngZone.run(recalculate);
    };

    const resizeObserver = new ResizeObserver(() => {
      ngZone.run(recalculate);
    });

    ngZone.runOutsideAngular(() => {
      scrollElement.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('resize', onWindowResize);
      resizeObserver.observe(scrollElement);
      const contentElement = scrollElement.firstElementChild;
      if (contentElement instanceof HTMLElement) {
        resizeObserver.observe(contentElement);
      }
    });

    recalculate();

    onCleanup(() => {
      scrollElement.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onWindowResize);
      resizeObserver.disconnect();
      clearHideTimer();
    });
  });

  destroyRef.onDestroy(clearHideTimer);

  return {
    scrollRef,
    isScrolling: computed(() => scrolling()),
    thumbHeight: computed(() => thumbHeightValue()),
    thumbTop: computed(() => thumbTopValue()),
    recalculate,
  };
}
