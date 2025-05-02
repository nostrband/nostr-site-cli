import { Filter } from "..";
import { GroupedFilter } from "../query/grouped-filter";
import { SubscriptionImpl } from "../query/subscription";
import { addFilterToGroup, getStandardFilterFields, isStandardFilter, normalizeFilter } from "../utils/utils";

interface RelayNips {}

export class RelayReqBuilder {
  private _pending: [Filter, SubscriptionImpl][] = [];
  private _queue: GroupedFilter[] = [];
  private _value?: GroupedFilter;
  private _waitPromise?: Promise<void>;
  private _waitCallback?: () => void;
  private _scheduled = false;

  constructor(relay: string, nips?: RelayNips) {
    // FIXME save nips to drop filters that aren't
    // valid for this relay?
  }

  private buildGroupedFilter(filter: Filter, sub: SubscriptionImpl) {
    const valid = getStandardFilterFields();

    // non-standard filters aren't groupable
    if (!isStandardFilter(filter, valid))
      return new GroupedFilter(filter, [sub]);

    // all but one field must be same for filters to be groupable
    let groupedFilter = { ...filter };
    const subs = [sub];
    for (const [f, s] of this._pending) {
      const newGroupedFilter = addFilterToGroup(groupedFilter, f, valid);
      if (newGroupedFilter) {
        groupedFilter = newGroupedFilter;
        subs.push(s);
      }
    }

    return new GroupedFilter(groupedFilter, subs);
  }

  private build() {
    // closed queries may clear pending queue
    if (!this._pending.length) return;

    // take next one from queue
    const [filter, sub] = this._pending.shift()!;

    // find groupable pending filters
    // and produce a batched filter and
    // put into the queue
    this.buildGroupedFilter(filter, sub);

    // unblock 'wait' callers
    if (this._waitCallback) {
      const cb = this._waitCallback;
      this._waitCallback = undefined;
      this._waitPromise = undefined;
      cb();
    }
  }

  private scheduleBuild() {
    if (this._scheduled) return;

    this._scheduled = true;
    setTimeout(() => {
      // reset before calling build bcs
      // it might unblock waiters which might
      // put more to pending and we'd need
      // to reschedule again
      this._scheduled = false;
      this.build();
    }, 0);
  }

  // add a filter to the builder queue
  put(filter: Filter) {
    // normalize first
    filter = normalizeFilter(filter);

    const sub = new SubscriptionImpl(filter);

    // add to pending list
    this._pending.push([filter, sub]);

    // remove from pending if query is closed
    sub.addEventListener("disposed", () => {
      const index = this._pending.findIndex(
        ([f, s]) => f === filter && s === sub
      );
      if (index >= 0) this._pending.splice(index, 1);
    });

    // got waiters? schedule build
    if (this._waitPromise) this.scheduleBuild();

    return sub;
  }

  // wait until next query is built
  async wait() {
    if (this._queue.length) return;
    if (!this._waitPromise) {
      this._waitPromise = new Promise((ok) => {
        this._waitCallback = ok;
      });
    }

    return this._waitPromise;
  }

  get empty() {
    return !this._pending.length && !this._queue.length;
  }

  // dequeue next query if available
  next() {
    this._value = this._queue.shift();
    return Boolean(this._value);
  }

  // return the next query
  value() {
    if (!this._value) throw new Error("No value");
    return this._value;
  }
}
