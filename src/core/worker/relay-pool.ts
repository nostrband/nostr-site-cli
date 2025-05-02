import { LRUCache } from "mnemonist";
import { Event, Filter, Worker } from "..";
import { Relay } from "./relay";
import { matchFilter } from "nostr-tools";

export class RelayPool {
  private _global: Worker;
  private _relays = new Map<string, Relay>();
  private _relayUrls: string[] = [];
  private _processing = false;
  private _cache = new LRUCache<string, Event>(10000);

  constructor(global: Worker) {
    this._global = global;

    this._global.addEventListener("message", async (msg: any) => {
      // process messages from frames
      await this.onClientMessage(msg);

      // notify frame that we sent the req
      if (msg.type === "req") {
        // FIXME map subId to msg.sender
        this._global.postMessage({
          type: "req_sent",
          url: msg.url,
          subId: msg.subId,
        });
      }
    });
  }

  private relay(url: string): Relay {
    let r = this._relays.get(url);
    if (r) return r;

    r = new Relay(url, this);
    this._relayUrls.push(url);
    this._relays.set(url, r);
    return r;
  }

  private async sendReq(url: string, subId: string, filter: Filter) {
    const relay = this.relay(url);
    await relay.waitReady();
    relay.sendReq(subId, filter);
  }

  private sendClose(url: string, subId: string) {
    const relay = this.relay(url);
    relay.sendClose(subId);
  }

  onNewEvent(url: string, subId: string, id: string, filter: Filter) {
    // check if event is in lru-cache, if so
    // use that one to pass to onEvent, this
    // way we'll only parse/validate/verify an
    // event once per a set of relays
    const event = this._cache.get(id);
    if (event) {
      // if relay is misbehaving it might send irrelevant ids
      if (matchFilter(filter, event)) this.onEvent(url, subId, event);
    }
    return !!event;
  }

  onEvent(url: string, subId: string, e: Event) {
    // update cache
    this._cache.set(e.id, e);

    // FIXME send up to the tab
  }

  onEose(url: string, subId: string) {}

  onClosed(url: string, subId: string, reason: string) {}

  onNotice(url: string, msg: string) {}

  onRelayMessage(url: string) {
    if (this._processing) return;
    this._processing = true;

    // fair-queue, check every relay until _all_ return false
    let more = false;
    do {
      // process one message from each relay
      for (let i = 0; i < this._relayUrls.length; i++) {
        const url = this._relayUrls[i];
        const done = this._relays.get(url)!.processNext() === false;
        more = more || !done;
      }
      // at least one relay had a message? try again
    } while (more);

    this._processing = false;
  }

  onClientMessage(msg: {
    type: string;
    url?: string;
    subId?: string;
    event?: Event;
    filter?: Filter;
  }) {
    switch (msg.type) {
      case "req": {
        return this.sendReq(msg.url!, msg.subId!, msg.filter!);
      }
      case "close": {
        return this.sendClose(msg.url!, msg.subId!);
      }
    }
  }
}
