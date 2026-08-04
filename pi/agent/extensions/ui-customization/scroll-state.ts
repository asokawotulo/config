export class ChatScrollState {
  scrollTop = 0;
  followingBottom = true;
  maximum = 0;
  pageSize = 1;

  scrollBy(delta: number): void {
    this.scrollTop = clamp(this.scrollTop + delta, 0, this.maximum);
    this.followingBottom = this.scrollTop === this.maximum;
  }

  scrollPage(direction: -1 | 1): void {
    this.scrollBy(direction * Math.max(1, this.pageSize - 1));
  }

  reconcile(contentLines: number, viewportLines: number): void {
    this.pageSize = Math.max(1, viewportLines);
    this.maximum = Math.max(0, contentLines - viewportLines);
    this.scrollTop = this.followingBottom
      ? this.maximum
      : clamp(this.scrollTop, 0, this.maximum);
    this.followingBottom = this.scrollTop === this.maximum;
  }

  reset(): void {
    this.scrollTop = 0;
    this.followingBottom = true;
    this.maximum = 0;
    this.pageSize = 1;
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(value, maximum));
}
