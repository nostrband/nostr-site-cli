import { EventEmitter } from "tseep";
import {
  CacheStrategy,
  CachedRelayQuery,
  Event,
  Filter,
  QueryEventMap,
  RelayQuery,
  Scope,
  Subscription,
} from "..";
import { matchFilter } from "nostr-tools";
import { bytesToHex } from "@noble/hashes/utils";
import { sha256 } from "@noble/hashes/sha256";
import { normalizeFilter } from "../utils/utils";

export interface RelayQueryOptions {
  cacheStrategy: CacheStrategy;
}

export class RelayQueryImpl implements RelayQuery {
  private _filter: Filter;
  private _relay: string;
  private _id: string;
  private _scope: Scope;
  private _cached?: CachedRelayQuery;
  private _opts: RelayQueryOptions;
  private _events: Event[] = [];
  private _activeSubs = new Set<Subscription>();
  private _updated = false;
  private _emitter = new EventEmitter<QueryEventMap>();

  constructor(
    filter: Filter,
    relay: string,
    scope: Scope,
    options: RelayQueryOptions = {
      cacheStrategy: "cache",
    }
  ) {
    this._filter = { ...filter };
    this._relay = relay;
    this._id = this.createId();
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

  private createId() {
    return bytesToHex(
      sha256(`${this._relay}:${JSON.stringify(normalizeFilter(this._filter))}`)
    );
  }

  private put(e: Event) {
    const index = this._cached!.put(e);
    this._events.splice(index, 0, e);
    this._updated = true;
  }

  private subscribe(filter: Filter) {
    const relay = this._scope.pool.relay(this._relay);
    return relay.put(filter);
  }

  private fetchFilter(filter: Filter) {
    const sub = this.subscribe(filter);
    this._activeSubs.add(sub);

    sub.addEventListener("event", (e: Event) => {
      this.put(e);
      this.emitEvents();
    });

    return new Promise<Subscription>((ok, err) => {
      sub.addEventListener("eose", () => {
        ok(sub);
      });

      sub.addEventListener("closed", (error: string) => {
        // FIXME is this right???
        err(error);
      });

      sub.addEventListener("error", (error: string) => {
        // FIXME is this right???
        err(error);
      });
    });
  }

  private async fetchFilterDispose(filter: Filter) {
    const sub = await this.fetchFilter(filter);
    this._activeSubs.delete(sub);
    sub.dispose();
  }

  private fetch(id: string) {
    return this.fetchFilterDispose({
      ids: [id],
    });
  }

  private fetchMany(ids: string[]) {
    const reqs: Promise<void>[] = [];
    for (const id of ids) reqs.push(this.fetch(id));
    return Promise.allSettled(reqs);
  }

  private async syncIdsFilter() {
    // check cache - events might be there
    // from other queries
    const fetchIds: string[] = [];
    for (const id of this._filter.ids!) {
      if (this._cached!.has(id)) continue;

      const e = await this._scope.cache.get(id, this._relay);
      if (e) {
        // check it matches other filter fields
        if (matchFilter(this._filter, e)) this.put(e);
      } else {
        fetchIds.push(id);
      }
    }

    // notify if hit cache
    if (fetchIds.length < this._filter.ids!.length) this.emitEvents();

    // fetch missing ids
    if (fetchIds.length) await this.fetchMany(fetchIds);
  }

  private async syncFull() {
    // start the fetch, block until eose, keep
    // the sub active to receive updates
    await this.fetchFilter(this._filter);
  }

  private async syncAround(since: number, until: number) {
    const beforeFilter = { ...this.filter, until: since };
    const afterFilter = { ...this.filter, since: until };
    await Promise.allSettled([
      this.fetchFilterDispose(beforeFilter),
      this.fetchFilter(afterFilter),
    ]);
  }

  private async syncFilter() {
    // if we had cached this query already we
    // will assume full coverage in [since,until] range
    const cachedQuery = this._cached!.ids.length > 0;

    // first - match from cache,
    // but these events don't count in [since,until] range
    // bcs they might be scattered and we return them
    // just to reduce latency, but not to save on sync costs
    const cachedEvents = await this._scope.cache.req(this._filter, this._relay);
    for (const e of cachedEvents) this.put(e);
    if (cachedEvents.length) this.emitEvents();

    if (cachedQuery) {
      // if we already loaded this filter from this relay
      // we do forward and backward sync only
      await this.syncAround(this._cached!.since, this._cached!.until);
    } else {
      // first time we're fetching this filter from this relay
      await this.syncFull();
    }
  }

  private async sync() {
    if (this._filter.ids?.length) {
      await this.syncIdsFilter();
    } else {
      await this.syncFilter();
    }
    this.emitLoaded();
  }

  get id() {
    return this._id;
  }

  get filter() {
    return this._filter;
  }

  get relay() {
    return this._relay;
  }

  get events() {
    return this._events;
  }

  [Symbol.dispose]() {
    for (const sub of this._activeSubs.values()) sub.dispose();

    // we created it, we should dispose it!
    this._cached?.dispose();

    // we're done, tell everyone
    this.emitDisposed();
  }

  dispose() {
    this[Symbol.dispose]();
  }

  start() {
    (async () => {
      if (this._cached) throw new Error("Query already started");

      // fetch matching event ids from cache
      this._cached = await this._scope.cache.createQuery(this);

      // check cached ids first
      if (this._opts.cacheStrategy !== "resync") {
        // fetch matching events from cache,
        // not all will be there as some might have been
        // evicted
        const ids = this._cached.ids();
        const fetchIds: string[] = [];
        for (const id of ids) {
          const e = await this._scope.cache.get(id, this._relay);
          if (e) this._events.push(e);
          else fetchIds.push(id);
        }

        // set flag if got events from cached ids
        this._updated = this._events.length > 0;
        this.emitEvents();

        if (fetchIds) await this.fetchMany(fetchIds);
      }

      // network sync
      await this.sync();
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
