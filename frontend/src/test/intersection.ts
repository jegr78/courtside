export class FakeIntersectionObserver {
  static latest: FakeIntersectionObserver | undefined;
  observed: Element[] = [];
  constructor(readonly report: IntersectionObserverCallback, readonly options?: IntersectionObserverInit) {
    FakeIntersectionObserver.latest = this;
  }
  observe(element: Element) { this.observed.push(element); }
  disconnect() { this.observed = []; }
  intersect(isIntersecting: boolean) {
    this.report(this.observed.map((target) => ({ target, isIntersecting }) as IntersectionObserverEntry), this as never);
  }
}
