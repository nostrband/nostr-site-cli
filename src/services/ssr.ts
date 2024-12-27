import NDK, { NDKEvent } from "@nostr-dev-kit/ndk";
import { ApiDB } from "../db/api";
import { BLACKLISTED_RELAYS, SITE_RELAY } from "../common/const";
import { EventSync } from "../nostr/sync";
import { eventAddr, eventId, fetchRelayFilterSince } from "../nostr";
import {
  KIND_SITE,
  KIND_PINNED_TO_SITE,
  KIND_SITE_SUBMIT,
  tv,
  NostrParser,
  parseAddr,
  NostrStore,
  // @ts-ignore
} from "libnostrsite";
import { nip19 } from "nostr-tools";
import { AddressPointer } from "nostr-tools/lib/types/nip19";
import { spawnService } from "../common/utils";
import { DeployedDomain } from "../common/types";

async function watch() {
  const db = new ApiDB();

  const ndk = new NDK({
    explicitRelayUrls: [SITE_RELAY],
    blacklistRelayUrls: BLACKLISTED_RELAYS,
  });
  ndk.connect().catch((e) => console.log("connect error", e));

  type SiteEvent = NDKEvent & {
    addr?: { identifier: string; pubkey: string; kind: number };
    store?: NostrStore;
  };
  const sites = new Map<string, SiteEvent>();
  const events = new Map<string, NDKEvent>();
  const eventSync = new EventSync(ndk);

  // buffer for relay delays
  const SYNC_BUFFER_SEC = 60; // 1 minute

  let last_site_tm = 0;
  while (true) {
    // list of deployed sites, all the rest are ignored
    const deployed = await db.listDeployedDomains();
    console.log("deployed", deployed.length);

    const getDomain = (addr: AddressPointer) => {
      const d = deployed.find(
        (d) =>
          d.addr!.identifier === addr.identifier &&
          d.addr!.pubkey === addr.pubkey
      );
      return d;
    };

    const tm = Math.floor(Date.now() / 1000);

    // sites are fetched from a single dedicated relay,
    // for each site we check last rerender time, and if it's > event.created_at then
    // we don't do full re-render
    const newSites: SiteEvent[] = await fetchRelayFilterSince(
      ndk,
      [SITE_RELAY],
      { kinds: [KIND_SITE] },
      last_site_tm,
      // timeout
      [new Promise((ok) => setTimeout(ok, 30000))]
    );
    last_site_tm = Math.floor(Date.now() / 1000) - SYNC_BUFFER_SEC;

    for (const s of newSites) {
      if (s.kind !== KIND_SITE) continue;

      s.addr = eventAddr(s);

      const d = getDomain(s.addr);
      if (!d) {
        console.log("site event ignored", s.id);
        continue;
      }
      console.log("site event", s.rawEvent(), d);

      // already rerendered this site update?
      if (d.rendered && d.rendered >= s.created_at!) {
        console.log("site event already rendered", s.rawEvent());
      } else {
        console.log("schedule rerender", s.rawEvent());
        await db.setRerenderDomain(d.domain, s.created_at!);
      }

      const naddr = nip19.naddrEncode(s.addr);
      const wasSite = sites.get(naddr);
      if (wasSite && wasSite.created_at! >= s.created_at!) {
        console.log("site event already subscribed", s.rawEvent());
      } else {
        sites.set(naddr, s);
        eventSync.addSite(naddr, s, wasSite, Number(d.fetched));
      }
    }

    // let event syncer do it's job
    const fetchedTm = Math.floor(Date.now() / 1000) - SYNC_BUFFER_SEC;
    const newEvents = await eventSync.process();
    for (const e of newEvents) {
      // convert to note/naddr
      const id = eventId(e);
      const existing = events.get(id);
      if (existing && existing.created_at! >= e.created_at!) continue;

      events.set(id, e);

      const siteNaddrs = eventSync.getAuthorSites(e.pubkey);
      console.log("scheduling new event", id, "sites", siteNaddrs.length);
      for (const naddr of siteNaddrs) {
        const s = sites.get(naddr);
        if (!s) {
          console.log("no site for", naddr);
          continue;
        }
        if (!s.addr) throw new Error("No site addr");

        const d = getDomain(s.addr);
        if (!d) {
          console.log("no domain for", s.addr);
          continue;
        }

        const url = tv(s, "r");
        const parser = new NostrParser(url);

        // full rerender for changed pins
        if (e.kind === KIND_PINNED_TO_SITE) {
          const d_tag = `${KIND_SITE}:${s.addr.pubkey}:${s.addr.identifier}`;
          if (tv(e, "d") !== d_tag) {
            console.log("rerender of pins skip for", d.domain);
            continue;
          }
          console.log(
            "scheduling rerender for changed pins",
            d.domain,
            e.rawEvent()
          );
          await db.setRerenderDomain(d.domain, e.created_at!);
        } else if (e.kind === KIND_SITE_SUBMIT) {
          const s_tag = `${KIND_SITE}:${s.addr.pubkey}:${s.addr.identifier}`;
          if (tv(e, "s") !== s_tag) {
            console.log("rerender of submits skip for", d.domain);
            continue;
          }

          const submit = await parser.parseSubmitEvent(e);
          if (submit) {
            console.log(
              "scheduling new submit",
              submit.eventAddress,
              "site",
              naddr,
              "domain",
              d.domain
            );

            await db.addEventToQueue(d.domain, submit.eventAddress);
          }
        } else {
          if (!s.store) {
            // load to check if event matches our filters
            const addr = parseAddr(naddr);
            const site = parser.parseSite(addr, s);
            parser.setSite(site);
            s.store = new NostrStore("preview", ndk, site, parser);
          }
          if (!s.store.matchObject(e)) continue;

          console.log(
            "scheduling new event",
            id,
            "site",
            naddr,
            "domain",
            d.domain
          );
          await db.addEventToQueue(d.domain, id);
        }
      }
    }

    await db.setUpdatedSites(
      fetchedTm,
      deployed.filter((d) => !d.fetched).map((d) => d.domain)
    );

    const passed = Date.now() / 1000 - tm;
    const pause = passed < 10 ? 10 : 0;
    console.log("updated last_tm", tm, "pause", pause);
    await new Promise((ok) => setTimeout(ok, pause * 1000));
  }
}

async function render() {
  const db = new ApiDB();

  const process = async (d: DeployedDomain, full = false) => {
    const render = async (paths: string[]) => {
      const addr = parseAddr(d.site);
      const naddr = nip19.naddrEncode({
        identifier: addr.identifier,
        pubkey: addr.pubkey,
        kind: KIND_SITE,
        relays: [SITE_RELAY],
      });
      console.log("rendering", d.domain, naddr, "paths", paths.length);
      await spawnService("cli", "release_website_zip", [
        naddr,
        "domain:" + d.domain,
        ...paths,
      ]);
    };

    // full rerender?
    if (full) {
      // d.updated >= d.rendered

      // get current last eventQueue.id,
      // then after we're done remove all events
      // scheduled for this site w/ id <= last_id
      const lastEvent = await db.getLastEventQueue(d.domain);

      const tm = Math.floor(Date.now() / 1000);

      // full rerender
      await render([]);

      // clear event queue before this render
      if (lastEvent) {
        console.log(
          "delete events queue until",
          lastEvent.id,
          "site",
          d.domain
        );
        await db.deleteEventQueueUntil(d.domain, lastEvent.id);
      }

      // mark as rendered
      await db.setDomainRendered(d.domain, tm);
    } else {
      // fetch events from queue
      const events = await db.listEventQueue(d.domain);

      let lastId = 0;
      const paths = ["/"];
      for (const e of events) {
        if (e.id > lastId) lastId = e.id;
        paths.push(`/post/${e.eventId}`);
        // FIXME also author page, also hashtag page, also kind page!
      }

      if (lastId) {
        // rerender new events
        await render(paths);

        console.log("delete events queue until", lastId, "site", d.domain);
        await db.deleteEventQueueUntil(d.domain, lastId);
      }
    }
  };

  while (true) {
    const sites = await db.listDeployedDomains();

    // find a site for full re-render, start with oldest ones
    const rerender = sites
      .filter(
        (d) =>
          d.rendered === undefined || (!!d.updated && d.updated >= d.rendered)
      )
      .sort((a, b) => Number(b.updated) - Number(a.updated))
      .shift();

    // find an updated site
    const event = await db.getEventQueue();
    if (event) {
      const site = sites.find((s) => s.domain === event.domain);
      if (site) {
        console.log(new Date(), Date.now(), "ssr new posts", event.domain);
        await process(site);
      } else {
        console.error("No site for queue event", event);
        // must delete it otherwise we'll get stuck on it
        await db.deleteEventQueue(event.id);
      }
    } else if (rerender) {
      // next full rerender
      console.log(new Date(), Date.now(), "ssr rerender", rerender.domain);
      await process(rerender, true);
    } else {
      // idle
      console.log(new Date(), Date.now(), "ssr idle, sleeping");
      await new Promise((ok) => setTimeout(ok, 3000));
    }
  }
}

export async function ssrMain(argv: string[]) {
  console.log("ssr", argv);

  const method = argv[0];
  if (method === "watch") {
    return watch();
  } else if (method === "render") {
    return render();
  }
}
