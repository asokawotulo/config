export interface ProgressTimers {
  set(callback: () => void, delayMs: number): unknown;
  clear(handle: unknown): void;
}

const defaultTimers: ProgressTimers = {
  set: (callback, delayMs) => setTimeout(callback, delayMs),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Coalesce transient stream activity while allowing durable transitions through immediately. */
export class CoalescedProgress {
  private pending: unknown;
  private disposed = false;

  constructor(
    private readonly commit: () => void,
    private readonly delayMs = 100,
    private readonly timers: ProgressTimers = defaultTimers,
  ) {}

  transient(): void {
    if (this.disposed || this.pending !== undefined) return;
    this.pending = this.timers.set(() => {
      this.pending = undefined;
      if (!this.disposed) this.commit();
    }, this.delayMs);
  }

  immediate(): void {
    if (this.disposed) return;
    this.cancel();
    this.commit();
  }

  flush(): void {
    if (this.disposed || this.pending === undefined) return;
    this.cancel();
    this.commit();
  }

  cancel(): void {
    if (this.pending === undefined) return;
    this.timers.clear(this.pending);
    this.pending = undefined;
  }

  /** Permanently suppress progress after a terminal lifecycle boundary. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancel();
  }
}
