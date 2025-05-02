import { Filter } from "..";
import { AbstractRelay, Subscription } from "../nostr-tools/abstract-relay";
import { RelayPool } from "./relay-pool";

export class Relay {
  private _url: string;
  private _pool: RelayPool;
  private _relay: AbstractRelay;
  private _subs = new Map<string, Subscription>();

  private _disposed = false;

  constructor(url: string, pool: RelayPool) {
    this._url = url;
    this._pool = pool;
    this._relay = new AbstractRelay(url, {
      onmessage: this.onMessage.bind(this),
    });
    this._relay.onclose = () => {
      // FIXME retry after a pause,
      // and re-run all active subs
    };
    this._relay.onnotice = (msg: string) => {
      this._pool.onNotice(this._url, msg);
    };
  }

  private onMessage() {
    this._pool.onRelayMessage(this._url);
  }

  async waitReady() {
    if (!this._relay.connected) await this._relay.connect();

    // FIXME check maxActiveReqs
    return Promise.resolve();
  }

  processNext() {
    return this._relay.handleNext();
  }

  get url() {
    return this._url;
  }

  sendReq(subId: string, filter: Filter) {
    const self = this;
    const sub = this._relay.subscribe([filter], {
      id: subId,
      onReceivedEvent(relay, id) {
        return self._pool.onNewEvent(self._url, subId, id, filter);
      },
      onevent(e) {
        self._pool.onEvent(self._url, subId, e);
      },
      oneose() {
        self._pool.onEose(self._url, subId);
      },
      onclose(reason) {
        self._pool.onClosed(self._url, subId, reason);
      },
    });
    this._subs.set(subId, sub);
  }

  sendClose(subId: string) {
    const sub = this._subs.get(subId);
    sub?.close();
    if (sub) this._subs.delete(subId);
  }

  // [Symbol.dispose]() {
  //   this._pool.disposeRelay(this);
  //   this._disposed = true;

  //   // FIXME notify pool that we're done
  // }

  // dispose() {
  //   this[Symbol.dispose]();
  // }
}
