import fs from "fs";
import NDK, { NDKEvent, NDKRelaySet } from "@nostr-dev-kit/ndk";
import { releaseWebsite, renderWebsite } from "../nostrsite";
import {
  DOMAINS_BUCKET,
  NPUB_PRO_DOMAIN,
  OUTBOX_RELAYS,
  SITE_RELAY,
} from "../common/const";
import {
  tv,
  prepareSite,
  prepareSiteByContent,
  fetchOutboxRelays,
  NostrParser,
  NostrStore,
  KIND_SITE,
  KIND_SITE_FILE,
  parseAddr,
  fetchNostrSite,
  // @ts-ignore
} from "libnostrsite";
import { eventId, parseNaddr } from "../nostr";
import { cliPubkey, cliSigner, ensureAuth } from "../auth/cli-auth";
import { nip19 } from "nostr-tools";
import {
  checkDomain,
  deploySite,
  getAdminSessionToken,
  getSessionToken,
  reserveSite,
} from "../client";
import { bytesToHex } from "@noble/hashes/utils";
import { randomBytes } from "crypto";
import { zipSiteDir } from "../zip";
import { generateOTP } from "../auth/token";
import {
  dnsResolveNoCache,
  getMime,
  now,
  toArrayBuffer,
} from "../common/utils";
import { S3 } from "../aws/s3";
import { ApiDB } from "../db/api";
import { BillingDB } from "../db/billing";
import { Blossom } from "../blossom";
import { prepareContentBuffer } from "../themes/utils";
import { Price } from "../common/types";

async function getThemeByName(name: string, ndk?: NDK) {
  ndk =
    ndk ||
    new NDK({
      explicitRelayUrls: [...OUTBOX_RELAYS, SITE_RELAY],
    });
  ndk.connect();

  const themeSet = await ndk.fetchEvents(
    {
      // @ts-ignore
      kinds: [KIND_THEME],
      "#d": [name],
    },
    { groupable: false },
    NDKRelaySet.fromRelayUrls([SITE_RELAY], ndk)
  );
  const themes = [...themeSet];
  console.log(
    "themes",
    themes.map((t) => ({
      name: tv(t, "d"),
      pubkey: t.pubkey,
    }))
  );
  if (!themes.length) throw new Error("Theme not found");
  if (themes.length > 1) throw new Error("More than 1 theme");

  const themeId = tv(themes[0], "e");

  console.log("theme package id", themeId, "theme addr", eventId(themes[0]));
  return themeId;
}

async function publishSiteEvent(
  pubkey: string,
  kinds: number[],
  hashtags: string[],
  themeId: string,
  domain: string,
  d_tag = ""
) {
  await ensureAuth();

  const adminPubkey = cliPubkey;

  const ndk = new NDK({
    explicitRelayUrls: [...OUTBOX_RELAYS, SITE_RELAY],
  });
  ndk.connect();

  const relays = await fetchOutboxRelays(ndk, [adminPubkey]);
  console.log("admin relays", relays);

  if (themeId.length !== 64) themeId = await getThemeByName(themeId, ndk);

  const theme = await ndk.fetchEvent(
    {
      // @ts-ignore
      kinds: [KIND_PACKAGE],
      ids: [themeId],
    },
    { groupable: false },
    NDKRelaySet.fromRelayUrls([SITE_RELAY], ndk)
  );
  if (!theme) throw new Error("Theme not found");

  console.log("theme", theme.id);

  const site = await prepareSite(ndk, adminPubkey, {
    contributorPubkeys: [pubkey],
    kinds,
    hashtags,
    theme: {
      id: theme.id,
      hash: tv(theme, "x"),
      relay: SITE_RELAY,
      name: tv(theme, "title"),
    },
  });

  // d_tag
  const identifier = d_tag || tv(site, "d");
  site.tags = site.tags.filter((t: string[]) => t.length < 2 || t[0] !== "d");
  site.tags.push(["d", d_tag]);

  // to figure out the hashtags and navigation we have to load the
  // site posts first, this is kinda ugly and slow but easier to reuse
  // the fetching logic this way
  const parser = new NostrParser(`https://${identifier}.${NPUB_PRO_DOMAIN}/`);
  const settings = await parser.parseSite(
    {
      identifier,
      pubkey: adminPubkey,
      relays: [],
    },
    new NDKEvent(ndk, site)
  );
  const store = new NostrStore("preview", ndk, settings, parser);
  await store.load(50);
  await prepareSiteByContent(site, store);

  // ask for sub-domain
  const requestedDomain = domain || identifier;
  const naddrDomain = nip19.naddrEncode({
    identifier,
    kind: KIND_SITE,
    pubkey: adminPubkey,
  });
  console.log("naddrDomain", naddrDomain);
  console.log("requesting domain", requestedDomain);

  const reply = await reserveSite(requestedDomain, naddrDomain);
  console.log(Date.now(), "got domain", reply);

  const subdomain = reply.domain.split("." + NPUB_PRO_DOMAIN)[0];
  console.log("received domain", subdomain);
  const origin = `https://${reply.domain}/`;
  site.tags.push(["r", origin]);

  // now we're ready
  console.log("final site event", site);

  const siteEvent = new NDKEvent(ndk, site);
  await siteEvent.sign(cliSigner);

  console.log("signed", siteEvent.rawEvent());

  const r = await siteEvent.publish(
    // make sure we publish to our SITE_RELAY
    NDKRelaySet.fromRelayUrls([...relays, SITE_RELAY], ndk)
  );
  const publishedRelays = [...r].map((r) => r.url);
  console.log("published at relays", publishedRelays);
  if (!publishedRelays.includes(SITE_RELAY))
    throw new Error("Failed to publish site to site relay");

  const naddr = nip19.naddrEncode({
    identifier,
    kind: KIND_SITE,
    pubkey: adminPubkey,
    relays: publishedRelays,
  });

  console.log("naddr", naddr);
}

async function changeWebsiteUser(naddr: string, pubkey: string) {
  await ensureAuth();

  const userPubkey = cliPubkey;
  console.log("userPubkey", userPubkey);

  const ndk = new NDK({
    explicitRelayUrls: [SITE_RELAY, ...OUTBOX_RELAYS],
  });
  ndk.connect();

  const addr = parseAddr(naddr);
  const event = new NDKEvent(ndk, await fetchNostrSite(addr));
  console.log("naddr", naddr, "event", event);

  if (event.pubkey !== userPubkey) throw new Error("Not your site");

  event.tags = event.tags.filter((t) => t.length < 2 || t[0] !== "u");
  event.tags.push(["u", pubkey]);
  event.created_at = 0;

  await event.sign(cliSigner);
  console.log("signed", event.rawEvent());

  const relays = await fetchOutboxRelays(ndk, [pubkey]);
  console.log("relays", relays);

  const r = await event.publish(
    NDKRelaySet.fromRelayUrls([SITE_RELAY, ...relays], ndk)
  );
  console.log(
    "published to",
    [...r].map((r) => r.url)
  );
}

async function resyncLocalDb() {
  const s3 = new S3();
  const db = new ApiDB();

  const keys = await s3.listBucketKeys(DOMAINS_BUCKET);
  console.log("keys", keys);

  for (const key of keys) {
    const domain = key.split("/").pop()!.split(".json")[0];
    if (!domain) continue;
    console.log("domain", domain);
    const info = await s3.fetchDomainInfo(domain, false);
    if (!info) throw new Error("Failed to fetch info for " + domain);
    await db.upsertDomainInfo(info);
  }

  console.log("done");
}

async function deleteDomainFilesS3(domain: string) {
  const s3 = new S3();
  return s3.deleteDomainFiles(domain);
}

async function blossomUpload(server: string, path: string) {
  await ensureAuth();

  const blossom = new Blossom();

  const name = path.split("/").pop()!;
  const content = await prepareContentBuffer(path);
  const file = new File([toArrayBuffer(content)], name);

  const mime = getMime(name);
  const hash = await blossom.getFileHash(file);
  console.log(path, "processing", hash);

  const pubkey = cliPubkey;

  console.log(path, "checking server", server);
  const uploaded = await blossom.checkFile({
    entry: path,
    server,
    hash,
    pubkey,
    debug: true,
  });
  console.log("uploaded", uploaded);

  const r = await blossom.uploadFile({
    entry: path,
    server,
    file,
    mime,
    pubkey,
    hash,
  });
  console.log("result", r);
}

async function createPrice(price: Price) {
  const db = new BillingDB();
  await db.createPrice({ ...price, timestamp: now() });
}

async function publishNostrJson(siteId: string) {
  await ensureAuth();

  const ndk = new NDK({
    explicitRelayUrls: [...OUTBOX_RELAYS, SITE_RELAY],
  });
  ndk.connect();

  const addr = parseNaddr(siteId);
  const s_tag = `${KIND_SITE}:${addr!.pubkey}:${addr!.identifier}`;
  const d_tag = `${"/.well-known/nostr.json"}:${s_tag}`;

  // read from stdin
  const jsonString = fs.readFileSync(0).toString();
  const json = JSON.parse(jsonString);
  const event = new NDKEvent(ndk, {
    kind: KIND_SITE_FILE,
    pubkey: cliPubkey,
    content: JSON.stringify(json),
    created_at: now(),
    tags: [
      ["d", d_tag],
      ["s", s_tag],
    ],
  });

  await event.sign(cliSigner);
  console.log("signed", event.rawEvent());

  const relays = await fetchOutboxRelays(ndk, [addr!.pubkey]);
  const r = await event.publish(NDKRelaySet.fromRelayUrls(relays, ndk));
  console.log("published at", r);
}

export async function cliMain(argv: string[]) {
  console.log("cli", argv);

  const method = argv[0];
  if (method === "render_website") {
    const dir = argv[1];
    const naddr = argv[2];
    const limit = argv.length > 3 ? parseInt(argv[3]) : 0;
    return renderWebsite(dir, naddr, limit);
  } else if (method.startsWith("release_website")) {
    const naddr = argv[1];
    const zip = method.includes("zip");
    const preview = method.includes("preview");
    let paths: string[] | number = [];
    let domain: string | undefined;
    for (let i = 2; i < argv.length; i++) {
      if (argv[i].startsWith("domain:")) {
        domain = argv[i].split("domain:")[1];
      } else {
        paths.push(argv[i]);
      }
    }
    if (paths.length === 1 && !paths[0].startsWith("/"))
      paths = parseInt(paths[0]);
    return releaseWebsite(naddr, paths, { zip, preview, domain });
  } else if (method === "publish_site_event") {
    const pubkey = argv[1];
    const kinds = argv[2].split(",").map((k) => parseInt(k));
    const hashtags = argv[3].split(",").filter((k) => k.trim() !== "");
    const themeId = argv[4];
    const domain = argv?.[5] || "";
    const d_tag = argv?.[6] || "";
    return publishSiteEvent(pubkey, kinds, hashtags, themeId, domain, d_tag);
  } else if (method === "deploy_site") {
    const domain = argv[1];
    const naddr = argv[2];
    return deploySite(domain, naddr, argv.length >= 3 ? argv[3] : undefined);
  } else if (method.startsWith("reserve_site")) {
    const domain = argv[1];
    const naddr = argv[2];
    const noRetry = method.includes("no_retry");
    return reserveSite(domain, naddr, noRetry);
  } else if (method === "generate_key") {
    console.log(bytesToHex(randomBytes(32)));
    return;
  } else if (method === "get_session_token") {
    return getSessionToken();
  } else if (method === "get_admin_session_token") {
    const pubkey = argv[1];
    return getAdminSessionToken(pubkey);
  } else if (method === "theme_by_name") {
    const name = argv[1];
    return getThemeByName(name);
  } else if (method === "zip_dir") {
    const dir = argv[1];
    const path = argv[1];
    return zipSiteDir(dir, path);
  } else if (method === "check_domain") {
    const domain = argv[1];
    const site = argv[2];
    return checkDomain(domain, site);
  } else if (method === "change_website_user") {
    const siteId = argv[1];
    const pubkey = argv[2];
    return changeWebsiteUser(siteId, pubkey);
  } else if (method === "generate_otp") {
    console.log("otp", generateOTP());
    return;
  } else if (method === "resync_local_db") {
    return resyncLocalDb();
  } else if (method === "delete_domain_files") {
    const domain = argv[1];
    return deleteDomainFilesS3(domain);
  } else if (method === "blossom_upload") {
    const server = argv[1];
    const path = argv[2];
    return blossomUpload(server, path);
  } else if (method === "dns_nocache") {
    const domain = argv[1];
    const type = argv[2];
    return dnsResolveNoCache(domain, type);
  } else if (method === "create_price") {
    const price = JSON.parse(argv[1]);
    return createPrice(price);
  } else if (method === "publish_nostr_json") {
    const siteId = argv[1];
    return publishNostrJson(siteId);
  }
}
