export class AsyncMutex {
  private queue: {
    cb: () => Promise<void>;
    ok: any;
    err: any;
  }[] = [];
  private running = false;

  private async execute() {
    const { cb, ok, err } = this.queue.shift()!;
    this.running = true;
    try {
      ok(await cb());
    } catch (e) {
      err(e);
    }
    this.running = false;
    if (this.queue.length > 0) this.execute();
  }

  public async run(cb: () => Promise<void>) {
    return new Promise<void>(async (ok, err) => {
      this.queue.push({ cb, ok, err });
      if (!this.running && this.queue.length === 1) this.execute();
    });
  }
}
