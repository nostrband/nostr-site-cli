import NDK, { NDKEvent, NDKRelay, NDKRelayStatus } from "@nostr-dev-kit/ndk";
import {
  KIND_PINNED_TO_SITE,
  KIND_NOTE,
  KIND_LONG_NOTE,
  KIND_SITE_SUBMIT,
  tags,
  tv,
  fetchOutboxRelays,
  // @ts-ignore
} from "libnostrsite";
import { BLACKLISTED_RELAYS } from "../common/const";
import { shuffleArray } from "../common/utils";
import { fetchRelayFilterSince } from ".";

interface Author {
  pubkey: string;
  sites: string[];
  relays?: Map<string, number>;
  fetched?: number;
}

interface Relay {
  pubkeys: string[];
  fetched?: number;
}

export class EventSync {
  private ndk: NDK;
  // pubkey => site
  private authors = new Map<string, Author>();

  constructor(ndk: NDK) {
    this.ndk = ndk;
  }

  public getAuthorSites(pubkey: string) {
    return this.authors.get(pubkey)?.sites || [];
  }

  private contributors(site: NDKEvent) {
    const pubkeys = tags(site, "p").map((t: string) => t[1]);
    const user = tv(site, "u");
    if (!pubkeys.length) {
      if (user) pubkeys.push(user);
      else pubkeys.push(site.pubkey);
    }
    return pubkeys;
  }

  private addSiteAuthor(pubkey: string, naddr: string, fetched?: number) {
    console.log(
      "add author",
      pubkey,
      fetched,
      "new",
      !this.authors.get(pubkey),
      naddr
    );
    const author: Author = this.authors.get(pubkey) || {
      pubkey,
      sites: [],
    };
    author.sites.push(naddr);
    // remember earliest fetch time
    if (fetched && (!author.fetched || author.fetched > fetched))
      author.fetched = fetched;
    console.log("add author", pubkey, fetched, " => ", author.fetched);
    this.authors.set(pubkey, author);
  }

  private removeSiteAuthor(pubkey: string, naddr: string) {
    const author = this.authors.get(pubkey);
    if (author) {
      author.sites = author.sites.filter((s) => s !== naddr);
      if (!author.sites.length) this.authors.delete(pubkey);
    }
  }

  public addSite(
    naddr: string,
    site: NDKEvent,
    wasSite?: NDKEvent,
    fetched?: number
  ) {
    console.log(
      "eventSync add site",
      naddr,
      "contributors",
      this.contributors(site),
      "wasSite",
      !!wasSite,
      fetched,
      site.rawEvent()
    );

    // remove old contributors
    if (wasSite) {
      for (const p of this.contributors(wasSite)) {
        this.removeSiteAuthor(p, naddr);
      }
    }

    // add new contributors
    for (const p of this.contributors(site)) {
      this.addSiteAuthor(p, naddr, fetched);
    }
  }

  public async process() {
    // run a cycle of fetches on all relays
    // in [last_tm:now] range
    const tm = Math.floor(Date.now() / 1000);

    console.log(Date.now(), "processing authors", this.authors.size);

    // fetch outbox relays, build relay map
    const relays = new Map<string, Relay>();
    for (const [pubkey, author] of this.authors.entries()) {
      if (!author.relays) {
        let relays = await fetchOutboxRelays(this.ndk, [pubkey]);

        // drop bad relays
        relays = relays!.filter(
          (r: string) => !BLACKLISTED_RELAYS.find((b) => r.startsWith(b))
        );

        author.relays = new Map();
        for (const r of relays) author.relays.set(r, Number(author.fetched));

        // our current scanning approach works fine with any number
        // of relays per author
        // if (author.relays.length > 5) {
        //   // only use 5 random outbox relays
        //   shuffleArray(author.relays);
        //   author.relays.length = 5;
        // }
        console.log("outbox relays", pubkey, relays);
      }

      for (const r of author.relays.keys()) {
        const fetched = author.relays.get(r);
        const relay: Relay = relays.get(r) || {
          pubkeys: [],
        };
        relay.pubkeys.push(pubkey);
        if (!relay.fetched || relay.fetched > (fetched || 0))
          relay.fetched = fetched;
        relays.set(r, relay);
      }
    }
    console.log(Date.now(), "relays", relays.size);

    // for each relay, fetch using batches of pubkeys,
    // do that in parallel to save latency
    const results: NDKEvent[] = [];
    const promises = new Set<Promise<void>>();
    const MAX_CONNS = 100;
    for (const [url, relay] of relays.entries()) {
      const todo = [...relay.pubkeys];
      console.log("starting relay", url, "pubkeys", relay.pubkeys.length);

      if (promises.size >= MAX_CONNS) {
        try {
          console.log("waiting for relay slot");
          await Promise.race(promises);
          console.log("got relay slot, promises", promises.size);
        } catch (e) {
          console.log("WTF error waiting for relay slot", e);
        }
      }

      const promise = new Promise<void>(async (ok) => {
        const newFetched = Math.floor(Date.now() / 1000);
        try {
          let authPolicy: (() => Promise<void>) | undefined;
          let aborted = false;
          const authPromise = new Promise<void>((onAuth) => {
            authPolicy = async () => {
              console.log("onAuth", url);
              aborted = true;
              this.ndk.pool.removeRelay(url);
              onAuth();
            };
          });

          let r = this.ndk.pool.relays.get(url);
          if (!r) {
            r = new NDKRelay(url, authPolicy);
            try {
              await Promise.race([
                r.connect(),
                new Promise((_, err) => setTimeout(err, 3000)),
              ]);
              this.ndk.pool.addRelay(r);
            } catch (e) {
              console.log("failed to connect to", url);
            }
          }
          if (r.connectivity.status !== NDKRelayStatus.CONNECTED) {
            console.log("still not connected to", url);
            throw new Error("Not connected");
          }

          console.log("relay", url, "pubkeys", relay.pubkeys.length);
          while (!aborted && todo.length > 0) {
            const batchSize = Math.min(todo.length, 100);
            const batch = todo.splice(0, batchSize);
            const events = await fetchRelayFilterSince(
              this.ndk,
              [url],
              {
                kinds: [
                  KIND_NOTE,
                  KIND_LONG_NOTE,
                  KIND_PINNED_TO_SITE,
                  KIND_SITE_SUBMIT,
                ],
                authors: batch,
              },
              Number(relay.fetched),
              // abort on timeout or auth request
              [authPromise, new Promise((ok) => setTimeout(ok, 20000))]
            );
            results.push(...events);
          }
        } catch (e) {
          console.log(
            "Error fetching from",
            url,
            "pubkeys",
            relay.pubkeys.length,
            e
          );
        }

        console.log(
          "DONE relay",
          url,
          newFetched,
          "pubkeys",
          relay.pubkeys.length
        );

        for (const p of relay.pubkeys) {
          const author = this.authors.get(p);
          if (!author) continue;
          author.relays!.set(url, newFetched);
          // author.fetched = Math.max(author.fetched, newFetched);
        }

        // drop it to make sure we reconnect next time
        this.ndk.pool.removeRelay(url);

        // remove from promise list
        const r = promises.delete(promise);
        if (!r) console.log("no promise!!!");
        else console.log("deleted promise", promises.size);

        ok();
      });
      promises.add(promise);
    }

    // wait for all relays
    try {
      await Promise.all(promises);
    } catch (e) {
      console.log("WTF error waiting for relays", e);
    }

    console.log(
      Date.now(),
      new Date(),
      "event sync authors",
      this.authors.size,
      "relays",
      relays.size,
      "new events",
      results.length,
      "by",
      results.map((e) => e.pubkey)
    );

    return results;
  }
}
