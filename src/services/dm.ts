import NDK, { NDKEvent, NDKRelaySet, NDKUser } from "@nostr-dev-kit/ndk";
import { cliPubkey, cliSigner, ensureAuth } from "../auth/cli-auth";
import {
  DEFAULT_RELAYS,
  KIND_ZAP_SPLIT,
  NPUB_PRO_PUBKEY,
  OPENSATS_PUBKEY,
} from "../common/const";
import {
  KIND_SITE,
  tv,
  parseNaddr,
  fetchEvent,
  fetchEvents,
  fetchInboxRelays,
  // @ts-ignore
} from "libnostrsite";
import { Event, nip19 } from "nostr-tools";
import { fetchProfile } from "../nostr";

async function createZapSplit({
  siteId,
  pubkey: targetPubkey,
  ndk,
}: {
  siteId?: string;
  pubkey: string;
  ndk?: NDK;
}) {
  await ensureAuth();

  const pubkey = cliPubkey;

  ndk =
    ndk ||
    new NDK({
      explicitRelayUrls: DEFAULT_RELAYS,
    });
  await ndk.connect();

  const siteNames: string[] = [];
  const addSite = (s: Event) => {
    const title = tv(s, "title") || tv(s, "name");
    if (title) siteNames.push(title);
  };

  if (siteId && !targetPubkey) {
    const siteAddr = parseNaddr(siteId);
    const site = await fetchEvent(
      ndk,
      {
        kinds: [siteAddr.kind],
        authors: [siteAddr.pubkey],
        "#d": [siteAddr.identifier],
      },
      DEFAULT_RELAYS,
      3000
    );
    console.log("site", siteId, site.rawEvent());
    if (!site) throw new Error("No site");

    targetPubkey = tv(site, "u") || site.pubkey;
    addSite(site);
  } else {
    const sites = await fetchEvents(
      ndk,
      [
        {
          kinds: [KIND_SITE],
          authors: [targetPubkey],
        },
        {
          kinds: [KIND_SITE],
          authors: [NPUB_PRO_PUBKEY],
          "#u": [targetPubkey],
        },
      ],
      DEFAULT_RELAYS,
      3000
    );
    for (const s of [...sites]) addSite(s);
    console.log("sites", siteNames);
  }
  console.log("target pubkey", targetPubkey);

  const receivers: any = {};
  receivers[NPUB_PRO_PUBKEY] = "Npub.pro team";
  receivers[OPENSATS_PUBKEY] = "funding to FOSS projects, for Ghost themes";
  receivers[
    "726a1e261cc6474674e8285e3951b3bb139be9a773d1acf49dc868db861a1c11"
  ] = "zapthreads plugin";
  receivers[
    "604e96e099936a104883958b040b47672e0f048c98ac793f37ffe4c720279eb2"
  ] = "nostr-zap plugin";

  let content = `#Value4Value support for the nostr-site${
    siteNames.length > 1 ? "s" : ""
  } titled "${siteNames[0]}"${
    siteNames.length >= 2
      ? `${siteNames.length > 2 ? "," : " and"} "${siteNames[1]}"`
      : ""
  }${
    siteNames.length >= 3
      ? `${siteNames.length > 3 ? "," : " and"} "${siteNames[2]}"`
      : ""
  }${
    siteNames.length >= 4 ? ` and ${siteNames.length - 3} more` : ""
  } to these amazing contributors:\n`;
  for (const pubkey in receivers) {
    const profile = await fetchProfile(ndk, pubkey);
    let info: any = undefined;
    try {
      info = JSON.parse(profile!.content);
    } catch (e) {
      console.log("Bad profile for", pubkey);
    }

    const name = info?.display_name || info?.name || "";
    content += ` nostr:${nip19.npubEncode(pubkey)} ${
      name ? `(${name})` : ""
    }: ${receivers[pubkey]};\n`;
  }

  const event = new NDKEvent(ndk, {
    kind: KIND_ZAP_SPLIT,
    pubkey,
    created_at: Math.floor(Date.now() / 1000),
    content,
    tags: [
      ["alt", content],
      ["p", targetPubkey],
      //['e', site.id],
      //["a", `${siteAddr.kind}:${siteAddr.pubkey}:${siteAddr.identifier}`],
    ],
  });

  const pubkeys = Object.keys(receivers);
  for (const pubkey of pubkeys) {
    let split = 0;
    if (pubkey === NPUB_PRO_PUBKEY) {
      split = pubkeys.length - 1;
    } else {
      split = 1;
    }
    event.tags.push(["zap", pubkey, "wss://relay.nostr.band/", "" + split]);
  }

  await event.sign(cliSigner);
  console.log("signed", event.rawEvent());

  const inboxRelays = await fetchInboxRelays(ndk, [targetPubkey]);
  console.log("inbox relays", targetPubkey, inboxRelays);

  const r = await event.publish(
    NDKRelaySet.fromRelayUrls([...DEFAULT_RELAYS, inboxRelays], ndk)
  );
  console.log("published to ", r.size);

  return event.id;
}

async function sendValue4ValueDM(targetPubkey: string) {
  await ensureAuth();

  const pubkey = cliPubkey;

  const ndk = new NDK({
    explicitRelayUrls: DEFAULT_RELAYS,
  });
  await ndk.connect();

  const zapSplitId = await createZapSplit({ pubkey: targetPubkey, ndk });
  const nevent = nip19.neventEncode({ id: zapSplitId, relays: DEFAULT_RELAYS });
  // convert the last char to percent-encoded version to make sure clients don't try to
  // convert this nevent string into an event preview (nostrudel wtf??)
  const neventParam =
    nevent.slice(0, nevent.length - 1) +
    "%" +
    nevent.charCodeAt(nevent.length - 1).toString(16);
  console.log("neventParam", neventParam);

  const updates = `Here is a summary of updates we released since the launch:\n
  - custom domains can be attached to your sites;\n
  - pinned/featured posts;\n
  - several new themes;\n
  - visitors on your sites can send all kinds of reactions, highlights, quotes, comments, can follow the post author, can send them DMs;\n
  - a better designed admin panel for your convenience;\n
  - multiple authors can be added to your site;\n
  - customize your main call-to-action (Zap, Like, etc);\n
  - homepage settings (hashtags, kinds);\n
  - geohashes: shows a map under posts with a geohash;\n
  - RSS feeds on your site, usable as a podcast feed;\n
  - an improved smooth signup flow for your visitors;\n
  - many bug fixes and small improvements;
  \n\n`;

  const message = `Hello!\n\n
Looks like you've been using Npub.pro for a while, and we are very happy to serve you!\n\n
Our website publishing tools are free to use, but not free to create and improve. If you find them valuable, consider supporting us in the spirit of #Value4Value.\n\n
Here is a convenient link with a zap-split, directing 50% of your tips to several contributors that made your websites work: https://zapper.fun/zap?id=${neventParam}\n\n
${updates}
Thank you for your support!\n\n
- Npub.pro team.
(If you don't like this message, please reply and let us know)\n\n
`;

  const dm = new NDKEvent(ndk, {
    kind: 4,
    pubkey: pubkey,
    created_at: Math.floor(Date.now() / 1000),
    content: await cliSigner.encrypt(
      new NDKUser({ pubkey: targetPubkey }),
      message
    ),
    tags: [["p", targetPubkey]],
  });

  await dm.sign(cliSigner);
  console.log("signed dm", dm.rawEvent());

  const inboxRelays = await fetchInboxRelays(ndk, [targetPubkey]);
  console.log("inbox relays", targetPubkey, inboxRelays);

  const r = await dm.publish(
    NDKRelaySet.fromRelayUrls([...DEFAULT_RELAYS, inboxRelays], ndk)
  );
  console.log("published to ", r.size);
}

export async function dmMain(argv: string[]) {
  console.log("dm", argv);

  const method = argv[0];
  if (method === "create_zap_split") {
    const pubkey = process.argv[1];
    return createZapSplit({ pubkey });
  } else if (method === "send_v4v_dm") {
    const pubkey = process.argv[1];
    return sendValue4ValueDM(pubkey);
  }
}
