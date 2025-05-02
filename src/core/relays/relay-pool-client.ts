import { EventEmitter } from "tseep";
import { RelayPool, Scope } from "..";
import { GroupedFilter } from "../query/grouped-filter";
import { RelayClient } from "./relay-client";

export type RelayPoolClientEventMap = {
  event: (url: string, subId: string, event: Event) => void;
  req_sent: (url: string, subId: string) => void;
  closed: (url: string, subId: string, reason: string) => void;
  eose: (url: string, subId: string) => void;
  notice: (url: string, error: string) => void;
  error: (url: string, error: string) => void;
};

export class RelayPoolClient implements RelayPool {
  private _relays = new Map<string, RelayClient>();
  private _scope: Scope;
  private _emitter = new EventEmitter<RelayPoolClientEventMap>();

  constructor(scope: Scope) {
    this._scope = scope;

    this._scope.worker.addEventListener("message", (data: any) => {
      switch (data.type) {
        case "event":
          return this._emitter.emit("event", data.url, data.subId, data.event);
        case "req_sent":
          return this._emitter.emit("req_sent", data.url, data.subId);
        case "eose":
          return this._emitter.emit("eose", data.url, data.subId);
        case "closed":
          return this._emitter.emit("closed", data.url, data.subId, data.error);
        case "notice":
          return this._emitter.emit("notice", data.url, data.error);
        case "error":
          return this._emitter.emit("error", data.url, data.error);
      }
    });
  }

  // relay no longer needed
  deleteRelay(url: string) {
    // FIXME release all
    this._relays.delete(url);
  }

  private send(data: any) {
    this._scope.worker.postMessage(data);
  }

  async sendReq(relay: string, filter: GroupedFilter) {
    this.send({
      type: "req",
      url: relay,
      subId: filter.id,
      filter: filter.filter,
    });
  }

  async sendClose(relay: string, filter: GroupedFilter) {
    this.send({
      type: "close",
      url: relay,
      subId: filter.id,
    });
  }

  // new relay
  relay(url: string): RelayClient {
    let relay = this._relays.get(url);
    if (!relay) {
      relay = new RelayClient(url, this);
      this._relays.set(url, relay);
      relay.start();
    }
    return relay;
  }

  addEventListener<EventKey extends keyof RelayPoolClientEventMap>(
    event: EventKey,
    listener: RelayPoolClientEventMap[EventKey]
  ) {
    this._emitter.on(event, listener);
  }

  removeEventListener<EventKey extends keyof RelayPoolClientEventMap>(
    event: EventKey,
    listener: RelayPoolClientEventMap[EventKey]
  ) {
    this._emitter.off(event, listener);
  }
}
