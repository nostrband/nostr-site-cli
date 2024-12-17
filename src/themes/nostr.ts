import { NDKEvent } from "@nostr-dev-kit/ndk";
import {
  ENGINE,
  KIND_FILE,
  LABEL_ONTOLOGY,
  LABEL_THEME,
  OPENSATS_PUBKEY,
} from "../common/const";
import { cliPubkey, cliSigner } from "../auth/cli-auth";
import { KIND_PACKAGE, KIND_THEME } from "libnostrsite";

export async function fetchFileEvent({
  ndk,
  entry,
  pubkey,
  hash,
  blossomUrls,
}) {
  const filter = {
    kinds: [KIND_FILE],
    authors: [pubkey],
    "#x": [hash],
  };
  const events = await ndk.fetchEvents(filter);
  console.log(entry, "file meta events", events.size);

  // find event for this file with one of currently used blossom servers
  for (const e of events.values()) {
    if (
      e.pubkey === pubkey &&
      e.tags.find(
        (t: string[]) =>
          t.length >= 2 &&
          (t[0] === "url" || t[0] === "fallback") &&
          blossomUrls.includes(t[1])
      )
    ) {
      return e;
    }
  }

  return undefined;
}

export async function publishFileEvent({
  ndk,
  entry,
  mime,
  blossomUrls,
  hash,
  file,
}) {
  const event = new NDKEvent(ndk, {
    kind: KIND_FILE,
    content: "",
    pubkey: cliPubkey,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["url", blossomUrls[0]],
      ["m", mime],
      ["x", hash],
      ["ox", hash],
      ["size", file.size + ""],
    ],
  });
  for (let i = 1; i < blossomUrls.length; i++)
    event.tags.push(["fallback", blossomUrls[i]]);

  await event.sign(cliSigner);
  console.log(entry, "publishing file meta", event.id);
  await event.publish();
  console.log(entry, "published file meta event");

  return event;
}

export async function publishPackageEvent({
  ndk,
  readme,
  packageJson,
  themeAddr,
  pkg,
  packageHash,
}) {
  // prepare package event
  const event = new NDKEvent(ndk, {
    pubkey: cliPubkey,
    created_at: Math.floor(Date.now() / 1000),
    kind: KIND_PACKAGE,
    content: readme,
    tags: [
      [
        "alt",
        `Nostr site theme package: ${packageJson?.name} v.${packageJson?.version}`,
      ],
      ["title", packageJson?.name || ""],
      ["summary", packageJson?.description || ""],
      ["version", packageJson?.version || ""],
      ["license", packageJson?.license || ""],
      ["x", packageHash],
      ["l", LABEL_THEME, LABEL_ONTOLOGY],
      ["L", LABEL_ONTOLOGY],
      ["a", themeAddr, ndk.pool.relays.values().next().value.url],
      ["zap", OPENSATS_PUBKEY],
    ],
  });

  for (const kw of packageJson?.keywords) {
    event.tags.push(["t", kw]);
  }

  for (const entry of pkg) {
    event.tags.push(["f", entry.hash, entry.entry, entry.url]);
  }

  await event.sign(cliSigner);
  console.log("publishing package event", event.id);
  console.log("package event", event.rawEvent());
  await event.publish();
  console.log("published package event");
  return event.id;
}

export async function publishThemeEvent({
  ndk,
  readme,
  packageJson,
  packageEventId,
}) {
  // prepare theme event
  const event = new NDKEvent(ndk, {
    pubkey: cliPubkey,
    created_at: Math.floor(Date.now() / 1000),
    kind: KIND_THEME,
    content: readme,
    tags: [
      ["d", packageJson.name],
      ["alt", `Nostr site theme: ${packageJson?.name}`],
      ["title", packageJson?.name || ""],
      ["summary", packageJson?.description || ""],
      ["version", packageJson?.version || ""],
      ["license", packageJson?.license || ""],
      ["e", packageEventId, ndk.pool.relays.values().next().value.url],
      ["z", ENGINE],
      ["zap", OPENSATS_PUBKEY],
    ],
  });

  for (const kw of packageJson?.keywords) {
    event.tags.push(["t", kw]);
  }

  await event.sign(cliSigner);
  console.log("publishing theme event", event.id);
  console.log("theme event", event.rawEvent());
  await event.publish();
  console.log("published package event");
}
