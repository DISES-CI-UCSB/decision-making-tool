class TestResizeObserver implements ResizeObserver {
  disconnect(): void {
    // Test shim: observation has no browser layout work to release.
  }

  observe(): void {
    // Test shim: specs control dimensions without native observation.
  }

  unobserve(): void {
    // Test shim: no observations are retained.
  }
}

globalThis.ResizeObserver ??= TestResizeObserver;
