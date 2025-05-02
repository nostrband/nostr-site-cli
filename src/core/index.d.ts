import {
  Filter as NostrToolsFilter,
  Event as NostrToolsEvent,
  UnsignedEvent as NostrToolsUnsignedEvent,
} from "nostr-tools";

export type Event = NostrToolsEvent;
export type Filter = NostrToolsFilter;
export type UnsignedEvent = NostrToolsUnsignedEvent;

export type CacheStrategy = "cache" | "resync";

export interface QueryOptions {
  cacheStrategy: CacheStrategy;
}

export interface Signer {
  sign(event: UnsignedEvent): Promise<string>;
}

export type WorkerEventMap = {
  message: (data: any) => void;
};

export interface Worker {
  postMessage(data: any);
  addEventListener: <EventKey extends keyof WorkerEventMap = string>(event: EventKey, listener: WorkerEventMap[EventKey]) => void;
  removeEventListener: <EventKey extends keyof WorkerEventMap = string>(event: EventKey, listener: WorkerEventMap[EventKey]) => void;
}

export interface Scope {
  get cache(): EventCache;
  get signer(): Signer;
  get pool(): RelayPool;
  get relayManager(): RelayManager;
  get defaultReadRelays(): string[] | undefined;
  get defaultWriteRelays(): string[] | undefined;
  get worker(): Worker;

  createQuery(filter: Filter, opts?: QueryOptions): Query;
  createRelayQuery(
    filter: Filter,
    relay: string,
    opts?: QueryOptions
  ): RelayQuery;
}

export interface ScopeOptions {
  // if not set we'll try to rely on outbox,
  // but might fail if no relay guesses could
  // be made for a particular filter
  defaultReadRelays?: string[];
  defaultWriteRelays?: string[];

  // override if necessary, or reuse from
  // another scope
  cache?: EventCache;
  signer?: Signer;
  pool?: RelayPool;
  relayManager?: RelayManager;
}

// generic
export function createScope(opts?: ScopeOptions): Scope;

// fetch user's outbox relays and set them as default
export function createScopeForUser(pubkey: string, opts?: ScopeOptions): Scope;

export interface RelayScore {
  // 1 - obligatory, <1 - less likely to have the data
  score: number;
  url: string;
}

export interface RelayManager {
  getFilterRelays(filter: Filter): Promise<RelayScore[]>;

  // separate methods to get read or write relays,
  // because these calculations might be expensive

  // the more often we see other people mention this pubkey
  // on these relays, the higher the score (plus their nip65 event)
  getPubkeyReadRelays(pubkey: string): Promise<RelayScore[]>;

  // the more often we see their posts on these relays,
  // the higher the score (plus their nip65 event)
  getPubkeyWriteRelays(pubkey: string): Promise<RelayScore[]>;
}

export type DisposableEventMap = {
  disposed: () => void;
};

export type FilterEventMap = {
  event: (event: Event) => void;
  eose: () => void;
  closed: (error: string) => void;
  error: (error: string) => void;
  disposed: () => void;
};

export interface Subscription {
  // relay to subscription to query
  addEventListener: <EventKey extends keyof FilterEventMap = string>(event: EventKey, listener: FilterEventMap[EventKey]) => void;
  removeEventListener: <EventKey extends keyof FilterEventMap = string>(event: EventKey, listener: FilterEventMap[EventKey]) => void;

  // query to listener
  [Symbol.dispose](): void;
  dispose(): void;
}

export interface Relay {
  get url(): string;

  put(filter: Filter): Subscription;

  [Symbol.dispose](): void;
  dispose(): void;
}

export interface RelayPool {
  // the main reason: group websockets to reuse,
  // to separate a set of connections for privacy reasons.
  // doesn't allow to manually manage relays,
  // API only used to read active relay states etc

  // returns relay matching the url, creates relay object if needed
  relay(url: string): Relay;
}

export type QueryEventMap = {
  events: (events: Event[]) => void;
  loaded: (events: Event[]) => void;
  disposed: () => void;
  error: (error: string) => void;
};

export interface Query {
  get filter(): Filter;
  get events(): Event[];

  start(): void;

  addEventListener: <EventKey extends keyof QueryEventMap = string>(event: EventKey, listener: QueryEventMap[EventKey]) => void;
  removeEventListener: <EventKey extends keyof QueryEventMap = string>(event: EventKey, listener: QueryEventMap[EventKey]) => void;

  [Symbol.dispose](): void;
  dispose(): void;
}

export interface RelayQuery {
  get id(): string;
  get relay(): string;
  get filter(): Filter;
  get events(): Event[];

  start(): void;

  addEventListener: <EventKey extends keyof QueryEventMap = string>(event: EventKey, listener: QueryEventMap[EventKey]) => void;
  removeEventListener: <EventKey extends keyof QueryEventMap = string>(event: EventKey, listener: QueryEventMap[EventKey]) => void;

  [Symbol.dispose](): void;
  dispose(): void;
}

export interface EventCache {
  get(id: string, relay?: string): Promise<Event | undefined>;

  put(event: Event, relay: string): Promise<void>;

  req(filter: Filter, relay?: string): Promise<Event[]>;

  createQuery(query: RelayQuery): Promise<CachedRelayQuery>;

  deleteQuery(cachedQuery: CachedRelayQuery): void;
}

export interface CachedRelayQuery {
  // internal query id
  get queryId(): string;

  // check if id is cached
  has(id: string): boolean;

  // list of cached event ids ordered by event.created_at
  ids(): string[];

  // created_at of oldest cached event, or 0 if empty
  get since(): number;

  // created_at of newest cached event, or current UNIX timestamp if empty
  get until(): number;

  // add event to cached list, returns index in ids array
  put(event: Event): number;

  // dispose
  [Symbol.dispose](): void;

  // alias for dispose
  dispose(): void;
}
