import { EventEmitter } from "tseep";
import { Event, Filter, FilterEventMap, Subscription } from "..";
import { matchFilter } from "nostr-tools";

export class SubscriptionImpl implements Subscription {
  private _filter: Filter;
  private _emitter = new EventEmitter<FilterEventMap>();

  constructor(filter: Filter) {
    this._filter = filter;
  }

  onEvent(e: Event) {
    if (matchFilter(this._filter, e)) this._emitter.emit("event", e);
  }

  onEose() {
    this._emitter.emit("eose");
  }

  onClosed(error: string) {
    this._emitter.emit("closed", error);
  }

  onError(error: string) {
    this._emitter.emit("error", error);
  }

  [Symbol.dispose]() {
    this._emitter.emit("disposed");
  }

  dispose() {
    this[Symbol.dispose]();
  }

  addEventListener<EventKey extends keyof FilterEventMap>(
    event: EventKey,
    listener: FilterEventMap[EventKey]
  ) {
    this._emitter.on(event, listener);
  }

  removeEventListener<EventKey extends keyof FilterEventMap>(
    event: EventKey,
    listener: FilterEventMap[EventKey]
  ) {
    this._emitter.off(event, listener);
  }
}
