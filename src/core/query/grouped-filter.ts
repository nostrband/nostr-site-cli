import { bytesToHex, randomBytes } from "@noble/hashes/utils";
import { DisposableEventMap, Event, Filter, QueryEventMap, RelayQuery } from "..";
import { EventEmitter } from "tseep";
import { SubscriptionImpl } from "./subscription";

export class GroupedFilter {
  private _id: string;
  private _filter: Filter;
  private _subs: SubscriptionImpl[];
  private _emitter = new EventEmitter<DisposableEventMap>();

  constructor(filter: Filter, subs: SubscriptionImpl[]) {
    this._id = bytesToHex(randomBytes(8));
    this._filter = filter;
    this._subs = subs;

    // monitor state of queries to send CLOSE
    // when the whole group is closed
    for (const s of subs)
      s.addEventListener("disposed", () => this.close(s));
  }

  private close(sub: SubscriptionImpl) {
    this._subs = this._subs.filter((s) => s !== sub);

    // all queries closed?
    if (!this._subs.length) this._emitter.emit("disposed");
  }

  get id() {
    return this._id;
  }

  get filter() {
    return this._filter;
  }

  onEvent(e: Event) {
    for (const s of this._subs) s.onEvent(e);
  }

  onEose() {
    for (const s of this._subs) s.onEose();
  }

  onClosed(error: string) {
    for (const s of this._subs) s.onClosed(error);
  }

  onError(error: string) {
    for (const s of this._subs) s.onError(error);
  }

  addEventListener<EventKey extends keyof DisposableEventMap>(
    event: EventKey,
    listener: QueryEventMap[EventKey]
  ) {
    this._emitter.on(event, listener);
  }

  removeEventListener<EventKey extends keyof DisposableEventMap>(
    event: EventKey,
    listener: QueryEventMap[EventKey]
  ) {
    this._emitter.off(event, listener);
  }
}
