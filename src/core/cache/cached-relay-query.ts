import { CachedRelayQuery, Event } from "..";
import { EventCacheImpl } from "./event-cache";

export class CachedRelayQueryImpl implements CachedRelayQuery {
  private _queryId: string;
  private _cache: EventCacheImpl;
  private _ids: string[] = [];
  private _timestamps: number[] = [];

  constructor(queryId: string, cache: EventCacheImpl) {
    this._queryId = queryId;
    this._cache = cache;
  }

  get queryId() {
    return this._queryId;
  }

  has(id: string) {
    return this._ids.includes(id);
  }

  ids(): string[] {
    // make sure client can't modify it
    return [...this._ids];
  }

  get since() {
    return this._timestamps.length
      ? this._timestamps[this._timestamps.length - 1]
      : 0;
  }

  get until() {
    return this._timestamps.length ? this._timestamps[0] : 0;
  }

  get(id: string) {
    return this._cache.get(id);
  }

  put(event: Event) {
    const index = this._timestamps.findIndex((t) => t > event.created_at);
    let targetIndex = index;
    if (index < 0) {
      targetIndex = this._ids.length;
    } else {
      const nextTimestamp = this._timestamps[index];
      if (nextTimestamp == event.created_at) {
        const nextId = this._ids[index];
        if (nextId > event.id) targetIndex--;
      }
    }
    this._timestamps.splice(targetIndex, 0, event.created_at);
    this._ids.splice(targetIndex, 0, event.id);
    return targetIndex;
  }

  [Symbol.dispose]() {
    this._cache.deleteQuery(this);
  }

  dispose() {
    this[Symbol.dispose]();
  }
}
