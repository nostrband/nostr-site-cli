import fs from "fs";
import { cliPubkey, cliSigner, ensureAuth } from "../auth/cli-auth";
import { DEFAULT_BLOSSOM_SERVERS, DEFAULT_RELAYS } from "../common/const";
import NDK, { NDKEvent, NDKRelaySet } from "@nostr-dev-kit/ndk";
import { prepareContentBuffer } from "./utils";
import { getMime, toArrayBuffer } from "../common/utils";
import {
  fetchFileEvent,
  publishFileEvent,
  publishPackageEvent,
  publishThemeEvent,
} from "./nostr";
import { bytesToHex } from "@noble/hashes/utils";
import { sha256 } from "@noble/hashes/sha256";
import {
  KIND_PACKAGE,
  KIND_THEME,
  OUTBOX_RELAYS,
  SITE_RELAY,
  fetchNostrSite,
  fetchOutboxRelays,
  parseATag,
  parseAddr,
  tv,
  // @ts-ignore
} from "libnostrsite";
import { Blossom } from "../blossom";

// publish a theme
export async function publishTheme(
  dir: string,
  {
    latest = false,
    reupload = false,
    includeFonts = false,
  }: {
    latest?: boolean;
    reupload?: boolean;
    includeFonts?: boolean;
  } = {}
) {
  await ensureAuth();

  console.log("publishing", dir);

  const entries: string[] = [];
  fs.readdirSync(dir, { encoding: "utf8", recursive: true }).forEach((file) => {
    const stat = fs.statSync(dir + "/" + file);
    if (!stat.isFile()) return;
    if (file.startsWith(".")) return;
    if (file.endsWith(".lock")) return;
    if (file.endsWith(".zip")) return;
    if (file === "package-lock.json") return;
    if (file.startsWith(".")) return;
    if (file.startsWith("node_modules")) return;
    // FIXME include later when we start supporting i18n
    if (file.startsWith("locales")) return;
    if (file.startsWith("src/")) return;
    if (file.startsWith("docs") && file.endsWith(".md")) return;

    // sass should be built into css
    if (file.endsWith(".scss")) return;
    if (file.endsWith(".sass")) return;

    // fonts should be inlined
    if (!includeFonts) {
      if (file.endsWith(".woff")) return;
      if (file.endsWith(".woff2")) return;
      if (file.endsWith(".otf")) return;
      if (file.endsWith(".eot")) return;
      if (file.endsWith(".ttf")) return;
    }

    // if (
    //   file.startsWith("assets/") &&
    //   !(
    //     file.startsWith("assets/built/")
    //     // file.startsWith("assets/images/") ||
    //     // file.startsWith("assets/fonts/")
    //   )
    // )
    //   return;
    entries.push(file);
  });

  console.log("theme has files: ", entries);

  const blossomServers = DEFAULT_BLOSSOM_SERVERS;
  const relays = DEFAULT_RELAYS;
  const pubkey = cliPubkey;

  const ndk = new NDK({
    explicitRelayUrls: relays,
  });
  await ndk.connect();

  const blossom = new Blossom();
  console.log("BlossomClient", blossom);

  let readme = "";
  let packageJson: any = undefined;
  const pkg: { entry: string; hash: string; url: string }[] = [];
  for (const entry of entries) {
    const name = entry.split("/").pop();
    if (!name) continue;
    const path = dir + "/" + entry;
    const content = await prepareContentBuffer(path);
    const file = new File([toArrayBuffer(content)], name);
    if (name.toLowerCase() === "readme" || name.toLowerCase() === "readme.md")
      readme = content.toString("utf-8");
    if (name === "package.json") {
      packageJson = JSON.parse(content.toString("utf-8"));
      console.log("package", packageJson);
    }

    const mime = getMime(name);
    const hash = await blossom.getFileHash(file);
    console.log(entry, "processing", hash);

    const blossomUrls: string[] = [];
    for (const server of blossomServers) {
      console.log(entry, "checking server", server);
      // find existing published event for this file
      // with same url
      let uploaded = await blossom.checkFile({
        entry,
        server,
        hash,
        pubkey,
      });

      if (uploaded && reupload) {
        await blossom.deleteFile({ server, hash, pubkey });
        console.log(entry, "deleted previous file from", server);
        uploaded = false;
      }

      // upload
      if (!uploaded) {
        uploaded = await blossom.uploadFile({
          entry,
          server,
          file,
          mime,
          pubkey,
          hash,
        });
      }

      // store
      if (uploaded) blossomUrls.push(new URL("/" + hash, server).href);
    }
    console.log(entry, "publish file meta event with urls", blossomUrls);
    if (!blossomUrls.length) throw new Error("Failed to upload file " + entry);

    // check if file meta event is already published
    let file_event = await fetchFileEvent({
      ndk,
      entry,
      pubkey: cliPubkey,
      hash,
      blossomUrls,
    });
    console.log(entry, "file event existing", file_event?.id);

    // publish file event if not found
    if (!file_event || reupload) {
      file_event = await publishFileEvent({
        ndk,
        entry,
        mime,
        blossomUrls,
        hash,
        file,
      });
    }

    if (!file_event)
      throw new Error("Failed to publish meta event for file " + entry);

    pkg.push({
      entry,
      hash,
      url: blossomUrls[0],
      //      relay: file_event.relay?.url || "wss://relay.nostr.band",
    });

    console.log(entry, "added to package, total files", pkg.length);
  }

  if (!packageJson) throw new Error("No package.json");

  // sort by file hash, prepare package hash
  pkg.sort((a, b) => (a.hash > b.hash ? 1 : a.hash === b.hash ? 0 : -1));
  const packageHash = bytesToHex(
    sha256(pkg.map((e) => e.hash + e.entry).join(","))
  );
  console.log("packageHash", packageHash);

  // addr
  const themeAddr = `${KIND_THEME}:${cliPubkey}:${packageJson.name}`;

  // package first
  const packageEventId = await publishPackageEvent({
    ndk,
    readme,
    packageJson,
    themeAddr,
    pkg,
    packageHash,
  });

  // update theme if it's latest release
  if (latest) {
    await publishThemeEvent({
      ndk,
      readme,
      packageJson,
      packageEventId,
    });
  }
}

export async function updateTheme(siteId: string) {
  await ensureAuth();

  const pubkey = cliPubkey;

  const ndk = new NDK({
    explicitRelayUrls: [SITE_RELAY, ...OUTBOX_RELAYS],
  });
  ndk.connect();

  const addr = parseAddr(siteId);
  const event = new NDKEvent(ndk, await fetchNostrSite(addr));
  if (event.pubkey !== pubkey) throw new Error("Not your event");

  const themePackageId = tv(event, "x");
  const pkg = await ndk.fetchEvent(
    {
      // @ts-ignore
      kinds: [KIND_PACKAGE],
      ids: [themePackageId],
    },
    { groupable: false },
    NDKRelaySet.fromRelayUrls([SITE_RELAY], ndk)
  );
  if (!pkg) throw new Error("Bad package");

  const a = tv(pkg, "a");
  const aTag = parseATag(a);
  if (!aTag) throw new Error("No theme in package");

  console.log("current theme package", pkg.id, "theme", a);
  const theme = await ndk.fetchEvent(
    {
      kinds: [aTag.kind],
      authors: [aTag.pubkey],
      "#d": [aTag.identifier],
    },
    { groupable: false },
    NDKRelaySet.fromRelayUrls([SITE_RELAY], ndk)
  );
  if (!theme) throw new Error("No theme by package");

  const e = tv(theme, "e");
  if (!e) throw new Error("No package in theme");

  console.log("current theme", theme.id, "latest package", e);

  if (e === pkg.id) {
    console.log("already latest theme version");
    return;
  }

  const newPkg = await ndk.fetchEvent(
    {
      // @ts-ignore
      kinds: [KIND_PACKAGE],
      ids: [e],
    },
    { groupable: false },
    NDKRelaySet.fromRelayUrls([SITE_RELAY], ndk)
  );
  if (!newPkg) throw new Error("No new package");

  const title = tv(newPkg, "title") || "";
  const version = tv(newPkg, "version") || "";
  const name = title + (version ? " v." + version : "");

  event.tags = event.tags.filter((t) => t.length < 2 || t[0] !== "x");
  event.tags.push(["x", newPkg.id, SITE_RELAY, tv(newPkg, "x") || "", name]);

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
