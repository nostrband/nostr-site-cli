import NDK, { NDKEvent, NDKRelay, NDKRelayStatus } from "@nostr-dev-kit/ndk";
import {
  KIND_PINNED_TO_SITE,
  KIND_NOTE,
  KIND_LONG_NOTE,
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
  relays?: string[];
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

  getAuthorSites(pubkey: string) {
    return this.authors.get(pubkey)?.sites || [];
  }

  contributors(site: NDKEvent) {
    const pubkeys = tags(site, "p").map((t: string) => t[1]);
    const user = tv(site, "u");
    if (!pubkeys.length) {
      if (user) pubkeys.push(user);
      else pubkeys.push(site.pubkey);
    }
    return pubkeys;
  }

  addAuthor(pubkey: string, naddr: string, fetched?: number) {
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

  removeAuthor(pubkey: string, naddr: string) {
    const author = this.authors.get(pubkey);
    if (author) {
      author.sites = author.sites.filter((s) => s !== naddr);
      if (!author.sites.length) this.authors.delete(pubkey);
    }
  }

  addSite(naddr: string, site: NDKEvent, wasSite: NDKEvent, fetched?: number) {
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
        this.removeAuthor(p, naddr);
      }
    }

    // add new contributors
    for (const p of this.contributors(site)) {
      this.addAuthor(p, naddr, fetched);
    }
  }

  async process() {
    // run a cycle of fetches on all relays
    // in [last_tm:now] range
    const tm = Math.floor(Date.now() / 1000);

    console.log(Date.now(), "processing authors", this.authors.size);

    // fetch outbox relays, build relay map
    const relays = new Map<string, Relay>();
    for (const [pubkey, author] of this.authors.entries()) {
      if (!author.relays) {
        author.relays = await fetchOutboxRelays(this.ndk, [pubkey]);

        // drop bad relays
        author.relays = author.relays!.filter(
          (r) => !BLACKLISTED_RELAYS.find((b) => r.startsWith(b))
        );

        if (author.relays.length > 5) {
          // only use 5 random outbox relays
          shuffleArray(author.relays);
          author.relays.length = 5;
        }
        console.log("outbox relays", pubkey, author.relays);
      }

      for (const r of author.relays) {
        const relay: Relay = relays.get(r) || {
          pubkeys: [],
        };
        relay.pubkeys.push(pubkey);
        if (!relay.fetched || relay.fetched > (author.fetched || 0))
          relay.fetched = author.fetched;
        relays.set(r, relay);
      }
    }
    console.log(Date.now(), "relays", relays.size);

    // for each relay, fetch using batches of pubkeys,
    // do that in parallel to save latency
    const results: NDKEvent[] = [];
    const promises: Promise<void>[] = [];
    for (const [url, relay] of relays.entries()) {
      promises.push(
        new Promise<void>(async (ok) => {
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
              await r.connect();
              this.ndk.pool.addRelay(r);
            } catch (e) {
              console.log("failed to connect to", url);
            }
          }
          if (r.connectivity.status !== NDKRelayStatus.CONNECTED) {
            console.log("still not connected to", url);
            ok();
          }

          console.log("relay", url, "pubkeys", relay.pubkeys.length);
          while (!aborted && relay.pubkeys.length > 0) {
            const batchSize = Math.min(relay.pubkeys.length, 100);
            const batch = relay.pubkeys.splice(0, batchSize);
            const events = await fetchRelayFilterSince(
              this.ndk,
              [url],
              {
                kinds: [KIND_NOTE, KIND_LONG_NOTE, KIND_PINNED_TO_SITE],
                authors: batch,
              },
              Number(relay.fetched),
              // abort on timeout or auth request
              [authPromise, new Promise((ok) => setTimeout(ok, 10000))]
            );
            results.push(...events);
          }
          console.log("DONE relay", url);
          ok();
        })
      );
    }

    // wait for all relays
    try {
      await Promise.all(promises);
    } catch (e) {
      console.log("error", e);
      throw e;
    }

    console.log(
      "event sync authors",
      this.authors.size,
      "relays",
      relays.size,
      "new events",
      results.length
    );

    return results;
  }
}
