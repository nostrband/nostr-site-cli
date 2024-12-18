import { sha256 } from "@noble/hashes/sha256";
import NDK, {
  NDKEvent,
  NDKPrivateKeySigner,
  NDKRelaySet,
  NDKSigner,
  NostrEvent,
} from "@nostr-dev-kit/ndk";
import {
  KIND_PROFILE,
  KIND_SITE,
  OUTBOX_RELAYS,
  SITE_RELAY,
  tv,
  // @ts-ignore
} from "libnostrsite";
import {
  Event,
  getPublicKey,
  nip04,
  nip19,
  verifySignature,
} from "nostr-tools";
import { countLeadingZeros, minePow } from "../common/pow";
import { AddressPointer } from "nostr-tools/lib/types/nip19";
import { BROADCAST_RELAYS, KIND_DELETE, NPUB_PRO_API } from "../common/const";
import { bytesToHex } from "@noble/hashes/utils";

export async function fetchProfile(ndk: NDK, pubkey: string) {
  return ndk.fetchEvent(
    {
      kinds: [KIND_PROFILE],
      authors: [pubkey],
    },
    {
      groupable: false,
    },
    NDKRelaySet.fromRelayUrls(OUTBOX_RELAYS, ndk)
  );
}

export function parseNaddr(naddr: string) {
  if (!naddr) return undefined;
  try {
    const { type, data } = nip19.decode(naddr);
    if (type === "naddr") return data;
  } catch (e) {
    console.log("Bad naddr", naddr, e);
  }
  return undefined;
}

export async function createNip98AuthEvent(
  ndk: NDK,
  {
    pubkey,
    url,
    method,
    body,
    signer,
    pow,
  }: {
    pubkey: string;
    url: string;
    method: string;
    signer: NDKSigner;
    body?: string;
    pow?: number;
  }
) {
  let authEvent = new NDKEvent(ndk, {
    pubkey,
    kind: 27235,
    created_at: Math.floor(Date.now() / 1000),
    content: "",
    tags: [
      ["u", url],
      ["method", method],
    ],
  });
  if (body)
    authEvent.tags.push(["payload", Buffer.from(sha256(body)).toString("hex")]);

  // generate pow on auth event
  if (pow) {
    const start = Date.now();
    const powEvent = authEvent.rawEvent();
    const minedEvent = minePow(powEvent, pow);
    console.log(
      "mined pow of",
      pow,
      "in",
      Date.now() - start,
      "ms",
      minedEvent
    );
    authEvent = new NDKEvent(ndk, minedEvent);
  }

  authEvent.sig = await authEvent.sign(signer);

  return authEvent;
}

export async function publishSiteDeleteEvent(
  ndk: NDK,
  {
    addr,
    id,
    privkey,
    relays,
  }: {
    addr: AddressPointer;
    id: string | null;
    privkey: string;
    relays: string[];
  }
) {
  const serverPubkey = getPublicKey(privkey);

  const delReq = {
    kind: KIND_DELETE,
    pubkey: serverPubkey,
    created_at: Math.floor(Date.now() / 1000),
    content: "",
    tags: [["a", `${KIND_SITE}:${addr.pubkey}:${addr.identifier}`]],
  };

  if (id) delReq.tags.push(["e", id]);

  // sign event
  const signer = new NDKPrivateKeySigner(privkey);
  const ne = new NDKEvent(ndk, delReq);
  await ne.sign(signer);
  console.log("signed site deletion request", ne.rawEvent());

  try {
    const r = await ne.publish(
      NDKRelaySet.fromRelayUrls(
        [SITE_RELAY, ...BROADCAST_RELAYS, ...relays],
        ndk
      ),
      10000
    );
    console.log(
      Date.now(),
      "Published site deletion request event",
      ne.id,
      "for",
      addr.identifier,
      "to",
      [...r].map((r) => r.url)
    );
    if (!r.size) throw new Error("Failed to publish deletion request");
  } catch (e) {
    console.log("Failed to publish site event", ne.id, ne.pubkey);
    return false;
  }

  return true;
}

export async function verifyNip98AuthEvent({
  authorization,
  method,
  body,
  npub,
  path,
  minPow = 0,
}: {
  authorization?: string;
  method?: string;
  body?: string;
  npub: string | null;
  path: string;
  minPow?: number;
}) {
  try {
    if (!npub) return false;
    const { type, data: pubkey } = nip19.decode(npub);
    if (type !== "npub") return false;

    console.log("req authorization", pubkey, authorization);
    if (!authorization || !authorization.startsWith("Nostr ")) return false;
    const data = authorization.split(" ")[1].trim();
    if (!data) return false;

    const json = Buffer.from(data, "base64");
    const event: Event = JSON.parse(json.toString("utf8"));
    // console.log("req authorization event", event);

    const now = Math.floor(Date.now() / 1000);
    if (event.pubkey !== pubkey) return false;
    if (event.kind !== 27235) return false;
    if (event.created_at < now - 60 || event.created_at > now + 60)
      return false;

    if (minPow) {
      const pow = countLeadingZeros(event.id);
      console.log("pow", pow, "min", minPow, "id", event.id);
      if (pow < minPow) return false;
    }

    const u = event.tags.find((t) => t.length === 2 && t[0] === "u")?.[1];
    if (!u) return false;

    const tagMethod = event.tags.find(
      (t) => t.length === 2 && t[0] === "method"
    )?.[1];
    const payload = event.tags.find(
      (t) => t.length === 2 && t[0] === "payload"
    )?.[1];
    if (tagMethod !== method) return false;

    const url = new URL(u);
    console.log({ url });
    if (url.origin !== NPUB_PRO_API || url.pathname !== path) return false;

    if (body && body.length > 0) {
      const hash = bytesToHex(sha256(body));
      // console.log({ hash, payload, body: req.rawBody.toString() })
      if (hash !== payload) return false;
    } else if (payload) {
      return false;
    }

    // finally after all cheap checks are done,
    // verify the signature
    if (!verifySignature(event)) return false;
    return true;
  } catch (e) {
    console.log("auth error", e);
    return false;
  }
}

export async function sendOTP(
  ndk: NDK,
  {
    pubkey,
    code,
    relays,
    privkey,
  }: { pubkey: string; code: string; relays: string[]; privkey: string }
) {
  const signer = new NDKPrivateKeySigner(privkey);
  const dm = new NDKEvent(ndk, {
    kind: 4,
    pubkey: getPublicKey(privkey),
    created_at: Math.floor(Date.now() / 1000),
    content: await nip04.encrypt(privkey, pubkey, "Npub.pro code: " + code),
    tags: [["p", pubkey]],
  });
  await dm.sign(signer);
  const r = await dm.publish(NDKRelaySet.fromRelayUrls(relays, ndk));
  console.log(
    Date.now(),
    "sent DM code",
    code,
    "for",
    pubkey,
    "to",
    [...r].map((r) => r.url)
  );
}

export async function signEvent(ndk: NDK, event: Event, privkey: string) {
  const signer = new NDKPrivateKeySigner(privkey);
  const ne = new NDKEvent(ndk, event);
  await ne.sign(signer);
  console.log("signed", ne.rawEvent());
  return ne;
}

export async function publishEvent(
  ndk: NDK,
  event: NDKEvent,
  relays: string[]
) {
  return await event.publish(NDKRelaySet.fromRelayUrls(relays, ndk), 10000);
}

export async function fetchRelayFilterSince(
  ndk: NDK,
  relays: string[],
  f: any,
  since: number,
  abortPromises: Promise<void>[]
) {
  console.log("fetch since", since, relays, f);
  let until: number | undefined;
  let queue: NDKEvent[] = [];
  do {
    const events = await Promise.race([
      ndk.fetchEvents(
        {
          ...f,
          since,
          until,
          limit: 1000, // ask as much as possible
        },
        { groupable: false },
        NDKRelaySet.fromRelayUrls(relays, ndk)
      ),
      ...abortPromises,
    ]);

    if (!events) {
      console.log("aborted", relays);
      break;
    }

    console.log(
      "filter",
      f,
      "since",
      since,
      "until",
      until,
      "got",
      events.size,
      "relay",
      relays
    );

    let newUntil: number | undefined;
    for (const e of events.values()) {
      if (!newUntil || newUntil >= e.created_at!) newUntil = e.created_at;
      queue.push(e);
    }

    // eof?
    if (!newUntil) until = undefined;
    // not moved?
    else if (until && newUntil >= until) until--;
    // moved
    else until = newUntil - 1;
  } while (until);

  return queue;
}

export function eventAddr(s: Event | NDKEvent) {
  return {
    identifier: tv(s, "d") || "",
    pubkey: s.pubkey,
    kind: s.kind!,
  };
}

export function eventId(e: Event | NDKEvent) {
  if (
    e.kind === 0 ||
    e.kind === 3 ||
    (e.kind! >= 10000 && e.kind! < 20000) ||
    (e.kind! >= 30000 && e.kind! < 40000)
  ) {
    return nip19.naddrEncode(eventAddr(e));
  } else {
    return nip19.noteEncode(e.id);
  }
}
