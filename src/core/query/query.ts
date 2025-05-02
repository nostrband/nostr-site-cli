import { EventEmitter } from "tseep";
import {
  Event,
  Filter,
  Query,
  QueryEventMap,
  QueryOptions,
  RelayQuery,
  Scope,
} from "..";
import { matchFilter } from "nostr-tools";
import { RelayQueryOptions } from "./relay-query";

export class QueryImpl implements Query {
  private _filter: Filter;
  private _scope: Scope;
  private _opts: QueryOptions;
  private _events: Event[] = [];
  private _updated = false;
  private _emitter = new EventEmitter<QueryEventMap>();
  private _relayQueries = new Map<string, RelayQuery>();

  constructor(
    filter: Filter,
    scope: Scope,
    options: QueryOptions = {
      cacheStrategy: "cache",
    }
  ) {
    this._filter = { ...filter };
    this._scope = scope;
    this._opts = options;
  }

  private emitEvents() {
    if (this._updated) {
      this._updated = false;
      this._emitter.emit("events", this._events);
    }
  }

  private emitLoaded() {
    this._updated = false;
    this._emitter.emit("loaded", this._events);
  }

  private emitDisposed() {
    this._updated = false;
    this._emitter.emit("disposed");
  }

  private emitError(error: string) {
    this._emitter.emit("error", error);
  }

  private put(e: Event) {
    const index = this._cached!.put(e);
    this._events.splice(index, 0, e);
    this._updated = true;
  }

  get filter() {
    return this._filter;
  }

  get events() {
    return this._events;
  }

  [Symbol.dispose]() {
    // dispose relay queries
    for (const q of this._relayQueries.values()) q.dispose();

    // we're done, tell everyone
    this.emitDisposed();
  }

  dispose() {
    this[Symbol.dispose]();
  }

  start() {
    (async () => {
      // merge on events and emit,
      // send loaded when all loaded,
      // if existing relays return nother add more if needed

      const relayScores = await this._scope.relayManager.getFilterRelays(
        this._filter
      );
      if (!relayScores.length) return this.emitError("No relays for filter");

      for (const rs of relayScores) {
        // FIXME check score to decide if this is needed

        const rqo: RelayQueryOptions = { ...this._opts };
        const query = this._scope.createRelayQuery(this._filter, rs.url, rqo);
        this._relayQueries.set(rs.url, query);

        // FIXME merge to our events
        query.addEventListener("events", (events: Event[]) => {});
        query.addEventListener("loaded", (events: Event[]) => {});
        query.addEventListener("error", (error: string) => {});
      }
    })();
  }

  addEventListener<EventKey extends keyof QueryEventMap>(
    event: EventKey,
    listener: QueryEventMap[EventKey]
  ) {
    this._emitter.on(event, listener);
  }

  removeEventListener<EventKey extends keyof QueryEventMap>(
    event: EventKey,
    listener: QueryEventMap[EventKey]
  ) {
    this._emitter.off(event, listener);
  }
}
