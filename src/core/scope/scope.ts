import { EventCache, Filter, Query, QueryOptions, RelayManager, RelayPool, RelayQuery, Scope, ScopeOptions, Signer } from "..";
import { EventCacheImpl } from "../cache/event-cache";
import { QueryImpl } from "../query/query";
import { RelayQueryImpl } from "../query/relay-query";
import { RelayManagerImpl } from "../relays/relay-manager";
import { RelayPoolClient } from "../relays/relay-pool-client";

class ScopeImpl {

  private _cache: EventCache;
  private _signer: Signer;
  private _pool: RelayPool;
  private _relayManager: RelayManager;
  private _defaultReadRelays?: string[];
  private _defaultWriteRelays?: string[];

  constructor(options: ScopeOptions) {
    this._cache = options.cache || new EventCacheImpl();
    // FIXME default signer please!
    this._signer = options.signer!;
    this._pool = options.pool || new RelayPoolClient(this);
    this._relayManager = options.relayManager || new RelayManagerImpl(this);
    this._defaultReadRelays = options.defaultReadRelays;
    this._defaultWriteRelays = options.defaultWriteRelays;
  }

  get cache() {
    return this._cache;
  }

  get signer() {
    return this._signer;
  }

  get pool() {
    return this._pool;
  }

  get relayManager() {
    return this._relayManager;
  }

  get defaultReadRelays() {
    return this._defaultReadRelays;
  }

  get defaultWriteRelays() {
    return this._defaultWriteRelays;
  }

  createQuery(filter: Filter, opts?: QueryOptions): Query {
    return new QueryImpl(filter, this, opts);
  }

  createRelayQuery(
    filter: Filter,
    relay: string,
    opts?: QueryOptions
  ): RelayQuery {
    return new RelayQueryImpl(filter, relay, this, opts);
  }
}

export function createScope(opts?: ScopeOptions): Scope {
  return new ScopeImpl(opts || {});
}
