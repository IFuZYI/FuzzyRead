export class AsyncTaskQueue {
  private running = 0;
  private pending: Array<() => void> = [];

  constructor(private readonly concurrency = 2) {}

  add<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        this.running += 1;
        task().then(resolve, reject).finally(() => {
          this.running -= 1;
          this.flush();
        });
      };
      this.pending.push(run);
      this.flush();
    });
  }

  private flush(): void {
    while (this.running < this.concurrency && this.pending.length > 0) {
      this.pending.shift()?.();
    }
  }
}

export const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));
