import { RelayPoolClient } from "./relay-pool-client";
import { RelayReqBuilder } from "./relay-req-builder";
import { Filter } from "nostr-tools";

export class RelayClient {
  private _url: string;
  private _pool: RelayPoolClient;
  private _reqBuilder: RelayReqBuilder;
  private _disposed = false;

  constructor(url: string, pool: RelayPoolClient) {
    this._url = url;
    this._pool = pool;
    this._reqBuilder = new RelayReqBuilder(url);
  }

  private async loop() {
    while (!this._disposed) {
      await this._reqBuilder.wait();
      if (this._reqBuilder.next()) {
        const groupedFilter = this._reqBuilder.value();

        // if query closed - send close,
        // NOTE: add this "disposed" handler now
        // so that if server is busy and blocks
        // on 'req' we could still send CLOSE
        groupedFilter.addEventListener("disposed", () => {
          this._pool.sendClose(this._url, groupedFilter);
        });

        // try to submit to worker, will
        // block if relay is busy
        await this._pool.sendReq(this._url, groupedFilter);
      }
    }
  }

  get url() {
    return this._url;
  }

  start() {
    // start the loop
    this.loop();
  }

  put(filter: Filter) {
    return this._reqBuilder.put(filter);
  }

  [Symbol.dispose]() {
    // FIXME what about all active queries???
    this._disposed = true;
    this._pool.deleteRelay(this._url);
  }

  dispose() {
    this[Symbol.dispose]();
  }
}
