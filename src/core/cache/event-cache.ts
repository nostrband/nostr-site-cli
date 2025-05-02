import { Event, EventCache, Filter, RelayQuery } from "..";
import { CachedRelayQueryImpl } from "./cached-relay-query";

export class EventCacheImpl implements EventCache {
  private _queries = new Map<string, CachedRelayQueryImpl>();
  private _events = new Map<string, Event>();
  private _eventRelays = new Map<string, Set<string>>();

  async get(id: string, relay?: string) {
    const event = this._events.get(id);
    if (event && relay) {
      // check if it came from this relay
      if (!this._eventRelays.has(relay)) return undefined;
    }
    return Promise.resolve(event);
  }

  async put(event: Event, relay: string) {
    this._events.set(event.id, event);
    let relays = this._eventRelays.get(event.id);
    if (relays) {
      relays.add(relay)
    } else {
      const relays = new Set<string>();
      relays.add(relay);
      this._eventRelays.set(event.id, relays);
    }
  }

  async createQuery(query: RelayQuery) {
    let cachedQuery = this._queries.get(query.id);
    if (!cachedQuery) {
      cachedQuery = new CachedRelayQueryImpl(query.id, this);
      this._queries.set(query.id, cachedQuery);
    }
    return Promise.resolve(cachedQuery);
  }

  async deleteQuery(cachedQuery: CachedRelayQueryImpl) {
    this._queries.delete(cachedQuery.queryId);
  }

  async req(filter: Filter, relay: string): Promise<Event[]> {
    // FIXME match filter against all known events
    return []
  }
}
