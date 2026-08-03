import type { ArmedDelete } from "./types.ts";

export const DELETE_WINDOW_MS = 2_000;

export class SessionManagerState {
  selectedIndex: number;
  private armedDelete?: ArmedDelete;

  constructor(selectedIndex = 0) {
    this.selectedIndex = Math.max(0, selectedIndex);
  }

  clamp(sessionCount: number): boolean {
    const next = Math.min(this.selectedIndex, Math.max(0, sessionCount - 1));
    if (next === this.selectedIndex) return false;
    this.selectedIndex = next;
    this.clearDelete();
    return true;
  }

  move(delta: number, sessionCount: number): boolean {
    const next = Math.max(
      0,
      Math.min(Math.max(0, sessionCount - 1), this.selectedIndex + delta),
    );
    this.clearDelete();
    if (next === this.selectedIndex) return false;
    this.selectedIndex = next;
    return true;
  }

  requestDelete(path: string, now: number): "armed" | "delete" {
    if (
      this.armedDelete?.path === path &&
      now - this.armedDelete.armedAt <= DELETE_WINDOW_MS
    ) {
      this.armedDelete = undefined;
      return "delete";
    }

    this.armedDelete = { path, armedAt: now };
    return "armed";
  }

  isDeleteArmed(path: string, now = Date.now()): boolean {
    return (
      this.armedDelete?.path === path &&
      now - this.armedDelete.armedAt <= DELETE_WINDOW_MS
    );
  }

  expireDelete(now: number): boolean {
    if (!this.armedDelete) return false;
    if (now - this.armedDelete.armedAt < DELETE_WINDOW_MS) return false;
    this.armedDelete = undefined;
    return true;
  }

  clearDelete(): void {
    this.armedDelete = undefined;
  }
}
