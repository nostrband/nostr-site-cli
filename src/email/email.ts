import NDK, { NDKEvent, NDKRelaySet, NDKUser } from "@nostr-dev-kit/ndk";
import { cliNdk, cliPubkey, cliSigner, ensureAuth } from "../auth/cli-auth";
import {
  generatePrivateKey,
  getPublicKey,
  validateEvent,
  verifySignature,
} from "nostr-tools";
import { PrivateKeySigner } from "../nostr/private-key-signer";
import { eventId, now, parseNaddr } from "../nostr";
import { DEFAULT_RELAYS, OUTBOX_RELAYS } from "../common/const";
import {
  fetchOutboxRelays,
  fetchInboxRelays,
  fetchEvents,
  fetchEvent,
  tv,
// @ts-ignore
} from "libnostrsite";

// requests are expiring events published
// by throwaway keys, by making them replaceable
// we kind-of enforce the use of throwaway keys
const KIND_NEWSLETTER_REQUEST = 10587;

// challenges aren't meant to be published
// so we're ensuring they don't pollute relays
const KIND_NEWSLETTER_COMMAND = 20587;

// confirms
const KIND_NEWSLETTER_CONFIRM = 587;

const KIND_NEWSLETTER = 30587; // 587 smpt submission port

// created by verifier
export async function verifierCreateEmailCommandToken(
  newsletterId: string,
  email: string,
  action: "sub" | "unsub"
) {
  await ensureAuth();

  const addr = parseNaddr(newsletterId);
  if (!addr || addr.kind !== KIND_NEWSLETTER)
    throw new Error("Bad newsletter id");

  const event = new NDKEvent(cliNdk, {
    kind: KIND_NEWSLETTER_COMMAND,
    pubkey: cliPubkey,
    created_at: now(),
    content: JSON.stringify({
      email,
      action,
      newsletter: `${addr.kind}:${addr.pubkey}:${addr.identifier}`
    }),
    tags: [],
  });
  await event.sign(cliSigner);
  console.log("event", event.rawEvent());

  // signed event encrypted to ourselves
  return cliSigner.encryptNip44(
    new NDKUser({ hexpubkey: cliPubkey }),
    JSON.stringify(event.rawEvent())
  );
}

export async function publishEmailRequest(
  newsletterId: string,
  email: string,
  action: "sub" | "unsub"
) {
  const addr = parseNaddr(newsletterId);
  if (!addr || addr.kind !== KIND_NEWSLETTER)
    throw new Error("Bad newsletter id");

  const ndk = new NDK({
    explicitRelayUrls: OUTBOX_RELAYS,
  });

  const newsletterRelays = await fetchOutboxRelays(ndk, [addr.pubkey]);

  const newsletter = await fetchEvent(
    ndk,
    {
      // @ts-ignore
      kinds: [KIND_NEWSLETTER],
      authors: [addr.pubkey],
      "#d": [addr.identifier],
    },
    newsletterRelays,
    10000
  );
  if (!newsletter) throw new Error("No newsletter event");

  const verifier = tv(newsletter, "p") || newsletter.pubkey;
  console.log("verifier", verifier);

  const key = generatePrivateKey();
  const signer = new PrivateKeySigner(key);
  const pubkey = getPublicKey(key);
  const req: any = {
    email,
    action,
    newsletter: `${addr.kind}:${addr.pubkey}:${addr.identifier}`,
    // name etc
  };
  console.log("req", JSON.stringify(req));

  const event = new NDKEvent(ndk, {
    kind: KIND_NEWSLETTER_REQUEST,
    pubkey,
    created_at: now(),
    content: await signer.encryptNip44(
      new NDKUser({ hexpubkey: verifier }),
      JSON.stringify(req)
    ),
    tags: [
      // make sure relays drop it after the mailer consumes it
      ["expiration", "" + (now() + 24 * 3600)],
      ["p", verifier],
    ],
  });
  await event.sign(signer);
  console.log("event", event.rawEvent());

  const relays = await fetchInboxRelays(ndk, [verifier]);
  console.log("relays", relays);
  const r = await event.publish(NDKRelaySet.fromRelayUrls(relays, ndk));
  console.log("published to", r.size);
}

export async function publishEmailConfirm(newsletterPubkey: string, commandToken: string) {
  const key = generatePrivateKey();
  const signer = new PrivateKeySigner(key);
  const pubkey = getPublicKey(key);

  const ndk = new NDK({
    explicitRelayUrls: OUTBOX_RELAYS,
  });
  const relays = await fetchInboxRelays(ndk, [newsletterPubkey]);

  const event = new NDKEvent(ndk, {
    kind: KIND_NEWSLETTER_CONFIRM,
    pubkey,
    created_at: now(),
    content: commandToken,
    tags: [["p", newsletterPubkey]],
  });
  await event.sign(signer);
  console.log("event", event.rawEvent());

  const r = await event.publish(NDKRelaySet.fromRelayUrls(relays, ndk));
  console.log("published to relays", r.size);

  return event;
}

export async function fetchEmailSubs() {
  await ensureAuth();

  const relays = await fetchInboxRelays(cliNdk, [cliPubkey]);
  console.log("relays", relays);

  const events = await fetchEvents(
    cliNdk,
    {
      // @ts-ignore
      kinds: [KIND_NEWSLETTER_CONFIRM],
      "#p": [cliPubkey],
    },
    relays,
    10000
  );

  const subs = new Map<string, [number, string]>();
  for (const e of events) {
    if (e.kind !== KIND_NEWSLETTER_CONFIRM) continue;

    try {
      const c = await cliSigner.decryptNip44(
        new NDKUser({ hexpubkey: cliPubkey }),
        e.content
      );
      const ce = JSON.parse(c);
      if (
        validateEvent(ce) &&
        verifySignature(ce) &&
        ce.pubkey === cliPubkey &&
        ce.kind === KIND_NEWSLETTER_COMMAND
      ) {
        const payload = JSON.parse(ce.content);
        const exists = subs.get(payload.email);
        if (!exists || exists[0] < ce.created_at) {
          subs.set(payload.email, [ce.created_at, payload.type]);
        }
      }
    } catch (err) {
      console.log("invalid event", err, e.rawEvent());
    }
  }

  for (const [e, [tm, type]] of subs.entries()) {
    console.log("e", e, tm, type);
  }
}

export async function verifierStartEmailConfirmDaemon(newsletterId: string) {
  await ensureAuth();

  const addr = parseNaddr(newsletterId);
  if (!addr || addr.kind !== KIND_NEWSLETTER)
    throw new Error("Bad newsletter id");
  const newsletterAddr = `${addr.kind}:${addr.pubkey}:${addr.identifier}`;

  const relays = await fetchInboxRelays(cliNdk, [cliPubkey]);
  relays.push(...DEFAULT_RELAYS);

  let since = now() - 24 * 3600;
  while (true) {
    const events = await fetchEvents(
      cliNdk,
      {
        kinds: [KIND_NEWSLETTER_REQUEST],
        "#p": [cliPubkey],
        since,
        limit: 100,
      },
      relays,
      10000
    );
    console.log(new Date(), "got requests since", since, events.length);
    for (const e of events) {
      if (e.created_at > since) since = e.created_at + 1;
      if (e.kind !== KIND_NEWSLETTER_REQUEST || tv(e, "p") !== cliPubkey) {
        console.log("skip invalid event", e.rawEvent());
        continue;
      }

      let req: any | undefined;
      try {
        const payload = await cliSigner.decryptNip44(
          new NDKUser({ hexpubkey: e.pubkey }),
          e.content
        );
        req = JSON.parse(payload);
        if (
          !req.email ||
          (req.action !== "sub" && req.action !== "unsub") ||
          req.newsletter !== newsletterAddr
        )
          throw new Error("Invalid req");
      } catch (err) {
        console.log("bad event", err, req, e.rawEvent());
        continue;
      }

      console.log("req", req);

      const c = await verifierCreateEmailCommandToken(
        newsletterId,
        req.email,
        req.action
      );
      console.log("send to ", req.email, c);
    }

    if (!events.length) await new Promise((ok) => setTimeout(ok, 10000));
  }
}

export async function createEmailNewsletter(
  id: string,
  title: string,
  description: string,
  icon: string,
  verifier: string
) {
  await ensureAuth();

  const event = new NDKEvent(cliNdk, {
    kind: KIND_NEWSLETTER,
    pubkey: cliPubkey,
    created_at: now(),
    content: "",
    tags: [
      ["d", id],
      ["title", title],
      ["description", description],
      ["icon", icon],
      ["type", "email"],
      ["type", "dm"],
      ["verifier", verifier],
    ],
  });

  await event.sign(cliSigner);

  console.log("signed", event.rawEvent());
  const relays = await fetchInboxRelays(cliNdk, [cliPubkey]);
  relays.push(...DEFAULT_RELAYS);

  const r = await event.publish(NDKRelaySet.fromRelayUrls(relays, cliNdk));
  console.log("published to relays", r.size);

  console.log("id", eventId(event));

  return event.rawEvent();
}
