export function ensureResizeObserverSupport() {
  if (typeof window === 'undefined' || typeof window.ResizeObserver !== 'undefined') {
    return;
  }

  class ResizeObserverFallback {
    private readonly callback: ResizeObserverCallback;
    private readonly targets = new Set<Element>();
    private readonly notify = () => {
      if (this.targets.size === 0) return;
      const entries = Array.from(this.targets).map((target) => ({
        target,
        contentRect: target.getBoundingClientRect(),
      })) as ResizeObserverEntry[];
      this.callback(entries, this as unknown as ResizeObserver);
    };

    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
      window.addEventListener('resize', this.notify);
      window.visualViewport?.addEventListener('resize', this.notify);
    }

    observe(target: Element) {
      this.targets.add(target);
      this.notify();
    }

    unobserve(target: Element) {
      this.targets.delete(target);
    }

    disconnect() {
      this.targets.clear();
      window.removeEventListener('resize', this.notify);
      window.visualViewport?.removeEventListener('resize', this.notify);
    }
  }

  (window as Window & typeof globalThis & { ResizeObserver: typeof ResizeObserver }).ResizeObserver = ResizeObserverFallback as unknown as typeof ResizeObserver;
}