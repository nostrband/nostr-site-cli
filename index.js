import dotenv from "dotenv";
dotenv.config({ path: "./.env.local" });

import WebSocket from "ws";
global.WebSocket ??= WebSocket;

import { File, Blob } from "@web-std/file";
global.File = File;
global.Blob = Blob;

import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils";
import { randomBytes, managedNonce } from "@noble/ciphers/webcrypto";
import { xchacha20poly1305 } from "@noble/ciphers/chacha";
import mime from "mime-types";
import postcss from "postcss";
import postcssUrl from "postcss-url";
import postcssImport from "postcss-import";
import postcssNestedImport from "postcss-nested-import";
import path from "path";
import slugifyExt from "slugify";
import http from "http";
import { PrismaClient } from "@prisma/client";
import childProcess from "child_process";
import archiver from "archiver";
import {
  ACMClient,
  DescribeCertificateCommand,
  RequestCertificateCommand,
} from "@aws-sdk/client-acm"; // ES Modules import

// guides https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/s3/
import {
  S3Client,
  PutBucketPolicyCommand,
  CreateBucketCommand,
  GetObjectCommand,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  GetBucketPolicyCommand,
} from "@aws-sdk/client-s3";
import {
  CloudFrontClient,
  CreateDistributionCommand,
  ListDistributionsCommand,
} from "@aws-sdk/client-cloudfront";
import {
  parseAddr,
  NostrSiteRenderer,
  NostrStore,
  NostrParser,
  tv,
  tvs,
  prepareSite,
  prepareSiteByContent,
  toRGBString,
  KIND_PINNED_TO_SITE,
  tags,
  fetchEvents,
  fetchEvent,
} from "libnostrsite";

import fs from "fs";
import os from "os";
import NDK, {
  NDKNip46Signer,
  NDKPrivateKeySigner,
  NDKEvent,
  NDKRelaySet,
  NDKRelay,
  NDKRelayStatus,
  NDKUser,
} from "@nostr-dev-kit/ndk";
import {
  nip19,
  getEventHash,
  generatePrivateKey,
  verifySignature,
  getPublicKey,
  nip04,
} from "nostr-tools";
import readline from "node:readline";
import { minePow } from "./pow.js";
import {
  getProfileSlug,
  fetchNostrSite,
  fetchInboxRelays,
  fetchOutboxRelays,
} from "libnostrsite";
import {
  AddListenerCertificatesCommand,
  DescribeListenersCommand,
  ElasticLoadBalancingV2Client,
} from "@aws-sdk/client-elastic-load-balancing-v2";

const AWSRegion = "eu-north-1";
const AWSEdgeRegion = "us-east-1";

const STATUS_DEPLOYED = "deployed";
const STATUS_RESERVED = "reserved";
const STATUS_RELEASED = "released";

const KIND_PROFILE = 0;
const KIND_CONTACTS = 3;
const KIND_DELETE = 5;
const KIND_RELAYS = 10002;
const KIND_FILE = 1063;
const KIND_PACKAGE = 1036;
const KIND_SITE = 30512;
const KIND_THEME = 30514;
const KIND_PLUGIN = 30515;
const KIND_ZAP_SPLIT = 1512;
const KIND_NOTE = 1;
const KIND_LONG_NOTE = 30023;

const LABEL_THEME = "theme";
const LABEL_ONTOLOGY = "org.nostrsite.ontology";

const OPENSATS_PUBKEY =
  "787338757fc25d65cd929394d5e7713cf43638e8d259e8dcf5c73b834eb851f2";
const NPUB_PRO_PUBKEY =
  "08eade50df51da4a42f5dc045e35b371902e06d6a805215bec3d72dc687ccb04";

const ENGINE = "pro.npub.v1";

const SITES_BUCKET = "npub.pro";
const DOMAINS_BUCKET = "domains.npub.pro";
const CUSTOM_BUCKET = "custom.npub.pro";

const LAMBDA_DOMAIN_TO_PATH =
  "arn:aws:lambda:us-east-1:945458476897:function:subDomainToS3Path:17";
const LAMBDA_HANDLE_403 =
  "arn:aws:lambda:us-east-1:945458476897:function:subDomain403Handler:11";

const CF_OAC_ID = "E36XDTETWYD652";
const CF_CACHE_POLICY_ID = "658327ea-f89d-4fab-a63d-7e88639e58f6";
const CF_RESPONSE_HEADER_POLICY_ID = "5cc3b908-e619-4b99-88e5-2cf7f45965bd";

const AWS_GLOBAL_ACCEL_IPS = ["75.2.103.62", "35.71.169.8"];

const LB_LISTENER_ARN =
  "arn:aws:elasticloadbalancing:us-east-1:945458476897:listener/app/TestEC2/f1119f64affd9926/de35c314bced9a29";

const NPUB_PRO_API = "https://api.npubpro.com";
const NPUB_PRO_DOMAIN = "npub.pro";

const OTP_TTL = 300000; // 5 minutes

const DEFAULT_BLOSSOM_SERVERS = [
  // trying it as default server
  "https://blossom.npubpro.com/",
  "https://cdn.nostrcheck.me/",
  // kieran
  //  "https://nostr.download/",
  // our server, w/ discovery enabled
  //"https://blossom.npubpro.com/",
  // doesn't return proper mime type
  // "https://cdn.satellite.earth/",
  // no longer accepts non-media uploads
  //  "https://files.v0l.io/",
  // dropped our files
  //  "https://blossom.nostr.hu/",
  // doesn't whitelist our pubkey :(
  //  "https://cdn.hzrd149.com/",
  // doesn't whitelist our pubkey :(
  //  "https://media-server.slidestr.net/",
];

const DEFAULT_RELAYS = [
  "wss://relay.damus.io/",
  "wss://nos.lol/",
  "wss://relay.npubpro.com/",
];

const OUTBOX_RELAYS = [
  "wss://purplepag.es",
  "wss://user.kindpag.es",
  "wss://relay.nos.social",
];

const BLACKLISTED_RELAYS = [
  // doesn't return EOSE, always have to wait for timeout
  "wss://nostr.mutinywallet.com",
  "wss://brb.io",
  "wss://relay.current.fyi",
];

const BROADCAST_RELAYS = ["wss://nostr.mutinywallet.com/"];

const SITE_RELAY = "wss://relay.npubpro.com";
const SITE_RELAYS = [SITE_RELAY, "wss://relay.nostr.band/all"];

const INDEX_URL = "https://cdn.npubpro.com/index.js";

const homedir = os.homedir();

const POW_PERIOD = 3600000; // 1h
const MIN_POW = 11;
const SESSION_TTL = 30 * 24 * 3600; // 1 month

const DOMAINS_PERIOD = 3600000; // 1h
const MAX_DOMAINS_PER_IP = 10;

const ipPows = new Map();
const ipDomains = new Map();

let ncNdk;
let signer;

function toArrayBuffer(buffer) {
  const arrayBuffer = new ArrayBuffer(buffer.length);
  const view = new Uint8Array(arrayBuffer);
  for (let i = 0; i < buffer.length; ++i) {
    view[i] = buffer[i];
  }
  return arrayBuffer;
}

function getMime(name) {
  return mime.lookup(name) || "";
}

// make sure current user is authed
async function ensureAuth() {
  const file = homedir + "/.nostr-site-cli.json";
  try {
    const info = JSON.parse(fs.readFileSync(file));
    if (info.pubkey && info.nsec && info.relays) {
      const { type, data: privkey } = nip19.decode(info.nsec);
      if (type !== "nsec") throw new Error("Invalid nsec");
      console.log("authing as", info.pubkey);
      ncNdk = new NDK({
        explicitRelayUrls: info.relays,
      });
      await ncNdk.connect();
      console.log("connected to relays", info.relays);

      signer = new NDKNip46Signer(
        ncNdk,
        info.pubkey,
        new NDKPrivateKeySigner(privkey)
      );
      // if connect is blocked then we must re-auth
      await Promise.race([
        signer.blockUntilReady(),
        new Promise((_, err) => signer.once("authUrl", () => err())),
      ]);
      console.log("authed as", info.pubkey);

      signer.on("authUrl", (url) =>
        console.log("Open this url and confirm: ", url)
      );

      return;
    }
  } catch (e) {
    console.log("saved auth error", e);
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const bunkerUrl = await new Promise((ok) =>
    rl.question(`Enter bunker url: `, ok)
  );
  rl.close();

  console.log("Auth using", bunkerUrl);
  const url = new URL(bunkerUrl);
  if (
    url.protocol !== "bunker:" ||
    url.host.length != 64 ||
    !url.searchParams.get("relay")
  ) {
    throw new Error("Invalid bunker url");
  }

  const pubkey = url.host;
  const secret = url.searchParams.get("secret");
  const relays = [url.searchParams.get("relay")];
  console.log("info", { pubkey, secret, relays });

  ncNdk = new NDK({
    explicitRelayUrls: relays,
  });
  await ncNdk.connect();
  console.log("connected to relays", relays);

  const privkey = generatePrivateKey();
  signer = new NDKNip46Signer(ncNdk, pubkey, new NDKPrivateKeySigner(privkey));
  signer.token = secret;
  signer.on("authUrl", (url) =>
    console.log("Open this url and confirm: ", url)
  );

  await signer.blockUntilReady();

  console.log("authed as", pubkey);

  const info = {
    pubkey,
    nsec: nip19.nsecEncode(privkey),
    relays,
  };
  fs.writeFileSync(file, JSON.stringify(info));
}

function makeSignEvent(pubkey) {
  return async function (draft) {
    console.log("sign blossom auth as", pubkey);
    // add the pubkey to the draft event
    const event = { ...draft, pubkey };
    //    console.log("signing", event);
    // get the signature
    const sig = await signer.sign(event);
    //    console.log("signed", sig);

    // return the event + id + sig
    return { ...event, sig, id: getEventHash(event) };
  };
}

async function checkBlossomFile({
  entry,
  BlossomClient,
  server,
  hash,
  getAuth,
  debug = false,
}) {
  try {
    const blob = await BlossomClient.getBlob(server, hash, getAuth);
    if (!blob) return false;
    const data = new Uint8Array(await blob.arrayBuffer());
    const blobHash = bytesToHex(sha256(data));
    const exists = blobHash === hash;
    console.log(
      entry,
      "exists",
      exists,
      "server",
      server,
      "hash",
      hash,
      "blobHash",
      blobHash
    );
    if (!exists && debug)
      console.log("bad data", new TextDecoder().decode(data));
    return exists;
  } catch (e) {
    console.log(e);
  }
  return false;
}

async function uploadBlossomFile({
  entry,
  BlossomClient,
  server,
  file,
  mime,
  uploadAuth,
  hash,
}) {
  console.log(entry, "uploading to", server, mime);
  try {
    const res = await fetch(new URL("/upload", server), {
      method: "PUT",
      body: await file.arrayBuffer(),
      headers: {
        authorization: BlossomClient.encodeAuthorizationHeader(uploadAuth),
        "Content-Type": mime,
      },
    });

    const reply = await res.json();
    console.log(entry, "upload reply", reply);
    if (reply.sha256 !== hash || (mime !== "" && reply.type !== mime))
      console.log(
        entry,
        "failed to upload to",
        server,
        "wrong reply hash",
        reply.sha256,
        "expected",
        hash
      );
    else if (!reply.url)
      console.log(entry, "failed to upload to", server, reply);
    else return true;
  } catch (e) {
    console.log(entry, "failed to upload to", server, e);
  }
  return false;
}

async function fetchFileEvent({ ndk, entry, pubkey, hash, blossomUrls }) {
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
        (t) =>
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

async function publishFileEvent({ ndk, entry, mime, blossomUrls, hash, file }) {
  const event = new NDKEvent(ndk, {
    kind: KIND_FILE,
    content: "",
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

  await event.sign(signer);
  console.log(entry, "publishing file meta", event.id);
  await event.publish();
  console.log(entry, "published file meta event");

  return event;
}

async function publishPackageEvent({
  ndk,
  pubkey,
  readme,
  packageJson,
  themeAddr,
  pkg,
  packageHash,
}) {
  // prepare package event
  const event = new NDKEvent(ndk, {
    pubkey,
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

  await event.sign(signer);
  console.log("publishing package event", event.id);
  console.log("package event", event.rawEvent());
  await event.publish();
  console.log("published package event");
  return event.id;
}

async function publishThemeEvent({
  ndk,
  pubkey,
  readme,
  packageJson,
  packageEventId,
}) {
  // prepare theme event
  const event = new NDKEvent(ndk, {
    pubkey,
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

  await event.sign(signer);
  console.log("publishing theme event", event.id);
  console.log("theme event", event.rawEvent());
  await event.publish();
  console.log("published package event");
}

async function prepareContentBuffer(path) {
  const isCss = path.toLowerCase().endsWith(".css");
  if (isCss) {
    const bundle = await bundleCss(path);
    return Buffer.from(bundle, "utf-8");
  }
  return fs.readFileSync(path);
}

// publish a theme
async function publishTheme(
  dir,
  { latest = false, reupload = false, includeFonts = false }
) {
  await ensureAuth();

  console.log("publishing", dir);

  const entries = [];
  fs.readdirSync(dir, { recursive: true }).forEach((file) => {
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

  const pubkey = (await signer.user()).pubkey;
  const blossomServers = DEFAULT_BLOSSOM_SERVERS;
  const relays = DEFAULT_RELAYS;

  // blossom signer callback
  const signEvent = makeSignEvent(pubkey);

  const ndk = new NDK({
    explicitRelayUrls: relays,
  });
  await ndk.connect();

  const { BlossomClient } = await import("blossom-client-sdk/client");
  console.log("BlossomClient", BlossomClient);

  let readme = "";
  let packageJson = undefined;
  const pkg = [];
  for (const entry of entries) {
    const name = entry.split("/").pop();
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
    const hash = await BlossomClient.getFileSha256(file);
    console.log(entry, "processing", hash);

    const blossomUrls = [];
    const getAuth = await BlossomClient.getGetAuth(signEvent);
    const uploadAuth = await BlossomClient.getUploadAuth(file, signEvent);
    const deleteAuth = await BlossomClient.getDeleteAuth(hash, signEvent);
    for (const server of blossomServers) {
      console.log(entry, "checking server", server);
      // find existing published event for this file
      // with same url
      let uploaded = await checkBlossomFile({
        entry,
        BlossomClient,
        server,
        hash,
        getAuth,
      });

      if (uploaded && reupload) {
        await BlossomClient.deleteBlob(server, hash, deleteAuth);
        console.log(entry, "deleted previous file from", server);
        uploaded = false;
      }

      // upload
      if (!uploaded) {
        uploaded = await uploadBlossomFile({
          entry,
          BlossomClient,
          server,
          file,
          mime,
          uploadAuth,
          hash,
        });
      }

      // store
      if (uploaded) blossomUrls.push(new URL("/" + hash, server).href);
    }
    console.log(entry, "publish file meta event with urls", blossomUrls);
    if (!blossomUrls.length) throw new Error("Failed to upload file", entry);

    // check if file meta event is already published
    let file_event = await fetchFileEvent({
      ndk,
      entry,
      pubkey,
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
      throw new Error("Failed to publish meta event for file", entry);

    pkg.push({
      entry,
      hash,
      url: blossomUrls[0],
      //      relay: file_event.relay?.url || "wss://relay.nostr.band",
    });

    console.log(entry, "added to package, total files", pkg.length);
  }

  // sort by file hash, prepare package hash
  pkg.sort((a, b) => (a.hash > b.hash ? 1 : a.hash === b.hash ? 0 : -1));
  const packageHash = bytesToHex(
    sha256(pkg.map((e) => e.hash + e.entry).join(","))
  );
  console.log("packageHash", packageHash);

  // addr
  const themeAddr = `${KIND_THEME}:${pubkey}:${packageJson.name}`;

  // package first
  const packageEventId = await publishPackageEvent({
    ndk,
    pubkey,
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
      pubkey,
      readme,
      packageJson,
      packageEventId,
    });
  }
}

async function bundleCss(assetPath) {
  // const absPath = path.resolve(assetPath);
  const data = fs.readFileSync(assetPath, "utf-8");

  const result = await postcss()
    // must go first to merge all css into one
    .use(postcssImport())
    // same here
    .use(postcssNestedImport())
    // now we can inline urls of the merged css
    .use(
      postcssUrl({
        url: "inline",
      })
    )
    .process(data, {
      from: assetPath,
    });

  console.log(
    "bundled",
    assetPath,
    "from",
    data.length,
    "to",
    result.css.length
  );
  return result.css;
}

async function testBundle(dir) {
  const assetsDir = dir + "/assets/";

  const entries = [];
  fs.readdirSync(assetsDir, { recursive: true }).forEach((file) => {
    const stat = fs.statSync(assetsDir + "/" + file);
    if (!stat.isFile()) return;
    entries.push(file);
  });

  console.log("entries", entries);

  for (const e of entries) {
    if (e.toLowerCase().endsWith("built/screen.css")) {
      const assetPath = assetsDir + e;
      const newBody = await bundleCss(assetPath);
      if (newBody) {
        fs.writeFileSync(assetPath + ".bundled", newBody);
        console.log("bundled", assetPath);
      } else {
        console.log("nothing to bundle", assetPath);
      }
    }
  }
}

async function createWebsite(dist, naddr, dir) {
  const { type, data: addr } = nip19.decode(naddr);
  if (type !== "naddr" || addr.kind !== KIND_SITE) throw new Error("Bad addr");

  const ndk = new NDK({
    explicitRelayUrls: addr.relays,
  });
  await ndk.connect();

  // fetch site and author
  const siteFilter = {
    kinds: [KIND_SITE],
    authors: [addr.pubkey],
    "#d": [addr.identifier],
  };
  const siteEvent = await ndk.fetchEvent(siteFilter);
  console.log("site", siteEvent.rawEvent());
  const url = siteEvent.tags.find((t) => t.length >= 2 && t[0] === "r")?.[1];
  let path = url ? new URL(url).pathname : "/";
  if (!path.endsWith("/")) path += "/";
  console.log("path", path);

  // fs.copyFileSync(`${dist}/sw.js`, `${dir}/sw.js`);
  fs.copyFileSync(`${dist}/robots.txt`, `${dir}/robots.txt`);
  // const assets = fs.readdirSync(`${dist}`);

  // const index = assets.find((a) => a.startsWith("index-"));
  // console.log("index", index);

  const sw = fs
    .readFileSync(`${dist}/sw.js`, { encoding: "utf-8" })
    .replace(/\/index\.js/g, INDEX_URL || "/index.js");
  fs.writeFileSync(`${dir}/sw.js`, sw);

  const html = fs
    .readFileSync(`${dist}/index.html`, { encoding: "utf-8" })
    .replace(`/index.js`, INDEX_URL || "/index.js")
    .replace(`/manifest.webmanifest`, `${path}manifest.webmanifest`)
    .replace(
      /<meta[\s]+property="nostr:site"[\s]+content="(.*)"/,
      `<meta property="nostr:site" content="${naddr}"`
    );
  fs.writeFileSync(`${dir}/index.html`, html);

  const manifest = JSON.parse(
    fs.readFileSync(`${dist}/manifest.webmanifest`, { encoding: "utf-8" })
  );
  manifest.start_url = new URL(tv(siteEvent, "r")).pathname;
  manifest.scope = manifest.start_url;
  manifest.name = tv(siteEvent, "title");
  manifest.short_name = tv(siteEvent, "name") || tv(siteEvent, "d");
  manifest.description = tv(siteEvent, "summary");
  for (const icon of manifest.icons) {
    icon.src = tv(siteEvent, "icon");
    icon.type = mime.lookup(icon.src);
  }
  console.log("manifest", manifest);
  fs.writeFileSync(`${dir}/manifest.webmanifest`, JSON.stringify(manifest));

  console.log("done");
}

async function uploadS3(s3, bucket, key, content, contentType, cacheControl) {
  const cmd = new PutObjectCommand({
    Bucket: bucket,
    Body: content,
    Key: key,
    ContentType: contentType,
    CacheControl: cacheControl,
    ChecksumAlgorithm: "SHA256",
    ChecksumSHA256: Buffer.from(sha256(content)).toString("base64"),
  });
  return await s3.send(cmd);
}

async function uploadAWS(dir, bucketName, domain, s3) {
  // dir = dir || "tests/tony";
  // bucketName = bucketName || `test2.npub.pro`;
  s3 = s3 || new S3Client({ region: AWSRegion });

  const files = [];
  fs.readdirSync(dir, { recursive: true }).forEach((file) => {
    const stat = fs.statSync(dir + "/" + file);
    console.warn("path", file, "is file", stat.isFile());
    if (!stat.isFile()) return;
    files.push(file);
  });
  console.warn("files", files);

  const keys = [];
  for (const f of files) {
    const content = fs.readFileSync(`${dir}/${f}`);
    const key = `${domain}/${f}`;
    keys.push(key);
    const CacheControl = f === "index.html" ? "no-cache" : undefined;
    console.warn("uploading", f, "to", key, "cache control", CacheControl);
    const cmd = new PutObjectCommand({
      Bucket: bucketName,
      Body: content,
      Key: key,
      ContentType: getMime(f),
      CacheControl,
      ChecksumAlgorithm: "SHA256",
      ChecksumSHA256: Buffer.from(sha256(content)).toString("base64"),
    });
    const r = await s3.send(cmd);
    console.warn("uploaded", f, r);
  }

  return keys;
}

async function uploadWebsite(dir, domain, deleteOldFiles = false) {
  const s3 = new S3Client({ region: AWSRegion });

  // full rerender?
  const existingKeys = [];
  if (deleteOldFiles) {
    existingKeys.push(...(await listBucketKeys(SITES_BUCKET, domain, s3)));
  }
  console.log("existingKeys", existingKeys);

  const keys = await uploadAWS(dir, SITES_BUCKET, domain, s3);
  console.log("uploaded keys", keys);
  if (deleteOldFiles) {
    const deleteKeys = existingKeys.filter((k) => !keys.includes(k));
    console.log("deleteKeys", deleteKeys);
    await deleteDomainFiles(domain, s3, deleteKeys);
  }
}

async function testAWS(domain, dir) {
  try {
    const s3 = new S3Client({ region: AWSRegion });
    const cf = new CloudFrontClient({ region: AWSRegion });

    // const dist1 = await cf.send(new GetDistributionCommand({ Id: "E30RX2VVVPPYNP" }));
    // console.log("dist", dist1.Distribution);
    // return;

    // const bucket1 = await s3.send(new GetBucketCommand({ id: 'test.npub.pro' }));
    // console.log("buckets", JSON.stringify(bucket1));

    // const buckets = await s3.send(new ListBucketsCommand({}));
    // console.log("buckets", buckets);

    const bucketName = domain || "test3.npub.pro";
    const source = dir || "tests/tony";

    // *.npub.pro
    const ViewerCertificate = {
      CloudFrontDefaultCertificate: false,
      ACMCertificateArn:
        "arn:aws:acm:us-east-1:945458476897:certificate/e7147f46-d97d-4bfa-a2ab-9648f0550f78",
      SSLSupportMethod: "sni-only",
      MinimumProtocolVersion: "TLSv1.2_2021",
      Certificate:
        "arn:aws:acm:us-east-1:945458476897:certificate/e7147f46-d97d-4bfa-a2ab-9648f0550f78",
      CertificateSource: "acm",
    };

    // create bucket
    const createBucket = new CreateBucketCommand({
      CallerReference: bucketName,
      Bucket: bucketName,
    });
    const bucket = await s3.send(createBucket);
    console.log("bucket", bucket);

    const bucketId = new URL(bucket.Location).hostname;
    //    const bucketId = `${bucketName}.s3.${region}.amazonaws.com`;
    console.log("bucketId", bucketId);

    // const cfOI = await cf.send(
    //   new CreateCloudFrontOriginAccessIdentityCommand({
    //     CloudFrontOriginAccessIdentityConfig: {
    //       CallerReference: bucketName,
    //       Comment: "-",
    //     },
    //   })
    // );
    // console.log("cfOI", cfOI);
    // const OriginAccessControlId = cfOI.CloudFrontOriginAccessIdentity.Id;

    const conf = {
      DistributionConfig: {
        CallerReference: bucketName,
        Comment: "",
        Enabled: true,
        DefaultRootObject: "index.html",
        HttpVersion: "http2and3",
        DefaultCacheBehavior: {
          TargetOriginId: bucketId,
          ViewerProtocolPolicy: "redirect-to-https",
          Compress: true,
          MinTTL: 0,
          MaxTTL: 31536000,
          DefaultTTL: 86400,
          AllowedMethods: {
            Items: ["GET", "HEAD", "OPTIONS"],
            Quantity: 3,
            CachedMethods: {
              Items: ["GET", "HEAD"],
              Quantity: 2,
            },
          },
          ForwardedValues: {
            QueryString: false,
            Cookies: {
              Forward: "none",
            },
            Headers: {
              Quantity: 0,
            },
            QueryStringCacheKeys: {
              Quantity: 0,
            },
          },
        },
        Aliases: {
          Items: [bucketName],
          Quantity: 1,
        },
        ViewerCertificate,
        Origins: {
          Items: [
            {
              DomainName: bucketId,
              Id: bucketId,
              ConnectionAttempts: 3,
              ConnectionTimeout: 10,
              // OriginAccessControlId,
              S3OriginConfig: {
                OriginAccessIdentity: "",
              },
            },
          ],
          Quantity: 1,
        },
        PriceClass: "PriceClass_All",
      },
    };
    console.log("conf", JSON.stringify(conf));
    const dist = await cf.send(new CreateDistributionCommand(conf));
    console.log("dist", dist);

    const policy = {
      Version: "2008-10-17",
      Id: "PolicyForCloudFrontPrivateContent",
      Statement: [
        {
          Sid: "AllowCloudFrontServicePrincipal",
          Effect: "Allow",
          Principal: {
            Service: "cloudfront.amazonaws.com",
          },
          Action: "s3:GetObject",
          Resource: `arn:aws:s3:::${bucketName}/*`,
          Condition: {
            StringEquals: {
              "AWS:SourceArn": dist.Distribution.ARN,
            },
          },
        },
      ],
    };
    const policyReply = await s3.send(
      new PutBucketPolicyCommand({
        CallerReference: bucketName,
        Bucket: bucketName,
        Policy: JSON.stringify(policy),
      })
    );
    console.log("policyReply", policyReply);

    // upload files
    uploadAWS(source, bucketName, s3);

    // const noBlock = await client.send(new DeletePublicAccessBlockCommand({
    //   Bucket: bucketName
    // }));
    // console.log("noBlock", noBlock);

    // const putAcl = await client.send(new PutBucketAclCommand({
    //   Bucket: bucketName,
    //   ACL: "public-read",
    // }));
    // console.log("putAcl", putAcl);

    // +create bucket
    // +create CF distribution
    // +set domain for distribution
    // +set certificate for distribution
    // +set bucket policy to allow access by distribution
    // add domain to godaddy dns
    // done?
  } catch (e) {
    console.error(e);
  }
}

async function testRender() {
  // disable debug logging
  console.debug = () => {};

  const naddr =
    "naddr1qqy8getnw3ekjar9qgs0jguk6age989y6efdf27n5xae528jwgcvw48k5wy8q5hayel609srqsqqqaesqyt8wumn8ghj7un9d3shjtnwdaehgu3wvfskueqpz3mhxue69uhhyetvv9ujuerpd46hxtnfduqs6amnwvaz7tmwdaejumr0ds094m6j";
  const addr = parseAddr(naddr);
  const renderer = new NostrSiteRenderer();
  await renderer.start({
    addr,
    mode: "ssr",
  });
  console.log("renderer created");

  // render using hbs and replace document.html
  const { result } = await renderer.render("/");
  console.log("result html size", result);
}

function get404(naddr, site) {
  return `
<!doctype html>
<html lang="en">

<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta property="nostr:site"
    content="${naddr}" />

  <!-- assumed by many themes, we always bundle it -->
  <link rel="preload" as="script" href="https://code.jquery.com/jquery-3.5.1.min.js" crossorigin="anonymous"
    integrity="sha256-9/aliU8dGd2tb6OSsuzixeV4y/faTqgFtohetphbbj0=">
  <script type="module" crossorigin src="${INDEX_URL}"></script>
  <link rel="manifest" href="${site.url}manifest.webmanifest"></head>

<body>
  <script>
    function render() {
      let path = new URL(window.location.href).searchParams.get("__renderPath");
      console.log("path", path);
      if (path && path.startsWith("/")) {
        window.history.replaceState({}, null, path);
      } else {
        path = '';
      }
      window.nostrSite.renderCurrentPage(path);
      window.removeEventListener("load", render);
    };
    window.addEventListener("load", render);
  </script>

  <section id="__nostr_site_loading_modal">
    <div class="loader"></div>
  </section>
  <style>
    #__nostr_site_loading_modal {
      position: absolute;
      top: 0;
      left: 0;
      height: 100%;
      width: 100%;
      background-color: #fff;
      z-index: 1000000;
      display: block;
    }

    #__nostr_site_loading_modal .loader {
      width: 48px;
      height: 48px;
      border: 5px solid #bbb;
      border-bottom-color: transparent;
      border-radius: 50%;
      display: inline-block;
      box-sizing: border-box;
      animation: rotation 1s linear infinite;
      position: absolute;
      top: 50%;
      left: 50%;
      margin-left: -24px;
      margin-top: -24px;
    }

    @keyframes rotation {
      0% {
        transform: rotate(0deg);
      }

      100% {
        transform: rotate(360deg);
      }
    }
  </style>
</body>

</html>
`;
}

async function renderWebsite(dir, naddr, onlyPathsOrLimit, preview = false) {
  if (dir.endsWith("/")) dir = dir.substring(0, dir.length - 1);

  const limit = onlyPathsOrLimit
    ? Number.isInteger(onlyPathsOrLimit)
      ? onlyPathsOrLimit
      : onlyPathsOrLimit.length
    : 0;
  const onlyPaths = !limit && onlyPathsOrLimit ? onlyPathsOrLimit : [];
  console.log("renderWebsite", dir, naddr, limit, onlyPaths);

  // disable debug logging
  const loggers = {
    debug: console.debug,
    log: console.log,
  };
  console.debug = () => {};
  console.log = () => {};

  try {
    const addr = parseAddr(naddr);
    const renderer = new NostrSiteRenderer();
    await renderer.start({
      addr,
      mode: "ssr",
      ssrIndexScriptUrl: INDEX_URL,
      maxObjects: limit ? Math.max(limit, 100) : undefined,
    });
    console.warn(Date.now(), "renderer loaded site", renderer.settings);

    // sitemap
    const sitemapPaths = await renderer.getSiteMap(limit);
    const paths = sitemapPaths.filter(
      (p) => !onlyPaths.length || onlyPaths.includes(p)
    );
    console.warn("paths", paths);
    if (paths.length < onlyPaths.length)
      console.warn(
        "BAD paths",
        paths,
        "expected",
        onlyPaths,
        "sitemap",
        sitemapPaths
      );

    // only write sitemap if we've loaded the whole site
    if (!limit) {
      const sitemap = sitemapPaths
        .map((p) => `${renderer.settings.origin}${p}`)
        .join("\n");
      fs.writeFileSync(`${dir}/sitemap.txt`, sitemap, { encoding: "utf-8" });
    }

    const robots = `
  User-agent: *
  Allow: /
  Sitemap: ${renderer.settings.origin}${renderer.settings.url}sitemap.txt
  `;
    fs.writeFileSync(`${dir}/robots.txt`, robots, { encoding: "utf-8" });

    // FIXME could we impring random revisions for each file?
    // also should we include the sw.js itself?
    // if sw.js could be omitted the we could include real hashes of index.js and manifest,
    // otherwise we probably should just force a revision by including random string
    // on every re-build of the files
    const rev = Date.now();
    const sw = `
    importScripts("${INDEX_URL}");
    self.nostrSite.startSW({ index: "${INDEX_URL}", precacheEntries: [{ url: "${INDEX_URL}", revision: "${rev}" }, { url: "${
      renderer.settings.url
    }sw.js", revision: "${rev + 1}" }, { url: "${
      renderer.settings.url
    }manifest.webmanifest", revision: "${rev + 2}" }] });
  `;
    fs.writeFileSync(`${dir}/sw.js`, sw, { encoding: "utf-8" });

    const site = renderer.settings;
    const man = {
      name: site.title,
      short_name: site.name,
      start_url: site.url,
      display: "standalone",
      background_color: "#ffffff",
      scope: site.url,
      description: site.description,
      theme_color: site.accent_color,
      icons: [
        // FIXME default icon => npub.pro icon!
        {
          src: site.icon || "",
          sizes: "192x192",
          type: mime.lookup(site.icon),
        },
        {
          src: site.icon || "",
          sizes: "512x512",
          type: mime.lookup(site.icon),
        },
      ],
    };
    fs.writeFileSync(`${dir}/manifest.webmanifest`, JSON.stringify(man), {
      encoding: "utf-8",
    });

    // nostr.json
    fs.mkdirSync(`${dir}/.well-known`, { recursive: true });
    const json = {
      names: {
        _: site.admin_pubkey,
      },
      relays: {},
    };
    fs.writeFileSync(`${dir}/.well-known/nostr.json`, JSON.stringify(json));

    // not-found handler.
    // we don't know if object actually doesn't exist or
    // if ssr just hasn't rendered it yet, so we shift the
    // responsibility to the client-side renderer by serving
    // this page. it's a sub with no content
    // that will do the rendering on the client and will
    // render proper 404 error if needed
    fs.writeFileSync(`${dir}/__404.html`, get404(naddr, site), {
      encoding: "utf-8",
    });

    // render using hbs and replace document.html
    for (const p of paths) {
      const { result, context } = await renderer.render(p);
      let file = p;
      if (file === "/") file = "/index";
      else if (file.endsWith("/")) file = file.substring(0, file.length - 1);
      if (!file.endsWith(".html")) file += ".html";
      const subDir = dir + path.dirname(file);
      console.warn("result html size", subDir, p, file, result.length);
      fs.mkdirSync(subDir, { recursive: true });
      fs.writeFileSync(dir + file, result, { encoding: "utf-8" });

      console.warn("context rss", p, renderer.hasRss(p), context.context);
      if (renderer.hasRss(p)) {
        const rssPath = p.endsWith("/") ? p + "rss/" : p + "/rss/";
        const rssFile = file.replace(".html", ".xml");
        console.log("rendering rss for", p, "at", rssFile);
        const { result } = await renderer.render(rssPath);
        console.warn(
          "result rss size",
          subDir,
          rssPath,
          rssFile,
          result.length
        );
        fs.writeFileSync(dir + rssFile, result, { encoding: "utf-8" });
      }
    }
    console.warn("done");

    // release it
    renderer.destroy();

    return renderer.settings;
  } catch (e) {
    throw e;
  } finally {
    console.log = loggers.log;
    console.debug = loggers.debug;
  }
}

async function zipSiteDir(dir, file) {
  console.log("zipping", dir);
  const tmp = "~zip" + Math.random();
  const output = fs.createWriteStream(tmp);
  const archive = archiver("zip");
  await new Promise((ok, err) => {
    output.on("close", function () {
      console.log(archive.pointer() + " total bytes");
      console.log(
        "archiver has been finalized and the output file descriptor has closed."
      );
      ok();
    });

    // good practice to catch warnings (ie stat failures and other non-blocking errors)
    archive.on("warning", function (e) {
      console.warn("warning", e);
      // if (err.code === "ENOENT") {
      //   // log warning
      // } else {
      //   // throw error
      //   throw err;
      // }
    });

    archive.on("error", function (e) {
      err(e);
    });

    archive.pipe(output);
    // both index.html and 404 must be same files
    // that only bootstrap the renderer
    archive.file(dir + "/__404.html", { name: "404.html" });
    archive.file(dir + "/__404.html", { name: "index.html" });
    archive.file(dir + "/.well-known/nostr.json", {
      name: ".well-known/nostr.json",
    });
    archive.file(dir + "/robots.txt", { name: "robots.txt" });
    archive.file(dir + "/manifest.webmanifest", {
      name: "manifest.webmanifest",
    });
    archive.file(dir + "/sw.js", { name: "sw.js" });
    archive.finalize();
  });

  fs.renameSync(tmp, file);
}

async function releaseWebsite(
  naddr,
  paths,
  { preview = false, zip = false, domain = "" } = {}
) {
  const isLimit = Number.isInteger(paths);
  console.log("release", {
    naddr,
    paths: isLimit ? paths : paths.length,
    preview,
    zip,
    domain,
  });
  const dir = "tmp_" + Date.now();
  fs.mkdirSync(dir);
  console.warn(Date.now(), "dir", dir);

  const site = await renderWebsite(dir, naddr, paths, preview);
  console.warn(Date.now(), "origin", site.origin);

  if (zip) {
    await zipSiteDir(dir, dir + "/dist.zip");
  }

  if (!domain) {
    const url = new URL(site.origin.toLowerCase());
    if (!url.hostname.endsWith(".npub.pro"))
      throw new Error("Unknown subdomain");
    domain = url.hostname.split(".")[0];
  }
  const deleteOldFiles = !paths || (!isLimit && !paths.length);
  await uploadWebsite(dir, domain, deleteOldFiles);

  //  fs.rmSync(dir, { recursive: true });
  console.warn(Date.now(), "done uploading", naddr, site.origin);
}

// async function fetchOutboxRelays(ndk, pubkeys) {
//   const events = await ndk.fetchEvents(
//     {
//       // @ts-ignore
//       kinds: [KIND_CONTACTS, KIND_RELAYS],
//       authors: pubkeys,
//     },
//     { groupable: false },
//     NDKRelaySet.fromRelayUrls(OUTBOX_RELAYS, ndk)
//   );

//   const writeRelays = [];

//   for (const e of events) {
//     if (e.kind === KIND_RELAYS) {
//       writeRelays.push(
//         ...e.tags
//           .filter(
//             (t) =>
//               t.length >= 2 &&
//               t[0] === "r" &&
//               (t.length === 2 || t[2] === "write")
//           )
//           .map((t) => t[1])
//       );
//     } else {
//       try {
//         const relays = JSON.parse(e.content);
//         for (const url in relays) {
//           if (relays[url].write) writeRelays.push(url);
//         }
//       } catch {}
//     }
//   }

//   return [
//     ...new Set(
//       writeRelays
//         .map((r) => {
//           try {
//             return new URL(r).href;
//           } catch {}
//         })
//         .filter((u) => !!u)
//     ),
//   ];
// }

async function fetchProfile(ndk, pubkey) {
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

// Taken from https://github.com/slevithan/xregexp/blob/20ab3d7a59035649327b8acb1cf372afb5f71f83/tools/output/categories.js
// This is a merger of Control, Format, Unassigned, Private_Use - i.e. Other without Surrogate
/* eslint-disable-next-line no-misleading-character-class */
const invisibleCharRegex =
  /[\0-\x1F\x7F-\x9F\xAD\u0600-\u0605\u061C\u06DD\u070F\u08E2\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\uFFF9-\uFFFB\u0378\u0379\u0380-\u0383\u038B\u038D\u03A2\u0530\u0557\u0558\u058B\u058C\u0590\u05C8-\u05CF\u05EB-\u05EE\u05F5-\u05FF\u061D\u070E\u074B\u074C\u07B2-\u07BF\u07FB\u07FC\u082E\u082F\u083F\u085C\u085D\u085F\u086B-\u089F\u08B5\u08BE-\u08D2\u0984\u098D\u098E\u0991\u0992\u09A9\u09B1\u09B3-\u09B5\u09BA\u09BB\u09C5\u09C6\u09C9\u09CA\u09CF-\u09D6\u09D8-\u09DB\u09DE\u09E4\u09E5\u09FF\u0A00\u0A04\u0A0B-\u0A0E\u0A11\u0A12\u0A29\u0A31\u0A34\u0A37\u0A3A\u0A3B\u0A3D\u0A43-\u0A46\u0A49\u0A4A\u0A4E-\u0A50\u0A52-\u0A58\u0A5D\u0A5F-\u0A65\u0A77-\u0A80\u0A84\u0A8E\u0A92\u0AA9\u0AB1\u0AB4\u0ABA\u0ABB\u0AC6\u0ACA\u0ACE\u0ACF\u0AD1-\u0ADF\u0AE4\u0AE5\u0AF2-\u0AF8\u0B00\u0B04\u0B0D\u0B0E\u0B11\u0B12\u0B29\u0B31\u0B34\u0B3A\u0B3B\u0B45\u0B46\u0B49\u0B4A\u0B4E-\u0B55\u0B58-\u0B5B\u0B5E\u0B64\u0B65\u0B78-\u0B81\u0B84\u0B8B-\u0B8D\u0B91\u0B96-\u0B98\u0B9B\u0B9D\u0BA0-\u0BA2\u0BA5-\u0BA7\u0BAB-\u0BAD\u0BBA-\u0BBD\u0BC3-\u0BC5\u0BC9\u0BCE\u0BCF\u0BD1-\u0BD6\u0BD8-\u0BE5\u0BFB-\u0BFF\u0C0D\u0C11\u0C29\u0C3A-\u0C3C\u0C45\u0C49\u0C4E-\u0C54\u0C57\u0C5B-\u0C5F\u0C64\u0C65\u0C70-\u0C77\u0C8D\u0C91\u0CA9\u0CB4\u0CBA\u0CBB\u0CC5\u0CC9\u0CCE-\u0CD4\u0CD7-\u0CDD\u0CDF\u0CE4\u0CE5\u0CF0\u0CF3-\u0CFF\u0D04\u0D0D\u0D11\u0D45\u0D49\u0D50-\u0D53\u0D64\u0D65\u0D80\u0D81\u0D84\u0D97-\u0D99\u0DB2\u0DBC\u0DBE\u0DBF\u0DC7-\u0DC9\u0DCB-\u0DCE\u0DD5\u0DD7\u0DE0-\u0DE5\u0DF0\u0DF1\u0DF5-\u0E00\u0E3B-\u0E3E\u0E5C-\u0E80\u0E83\u0E85\u0E86\u0E89\u0E8B\u0E8C\u0E8E-\u0E93\u0E98\u0EA0\u0EA4\u0EA6\u0EA8\u0EA9\u0EAC\u0EBA\u0EBE\u0EBF\u0EC5\u0EC7\u0ECE\u0ECF\u0EDA\u0EDB\u0EE0-\u0EFF\u0F48\u0F6D-\u0F70\u0F98\u0FBD\u0FCD\u0FDB-\u0FFF\u10C6\u10C8-\u10CC\u10CE\u10CF\u1249\u124E\u124F\u1257\u1259\u125E\u125F\u1289\u128E\u128F\u12B1\u12B6\u12B7\u12BF\u12C1\u12C6\u12C7\u12D7\u1311\u1316\u1317\u135B\u135C\u137D-\u137F\u139A-\u139F\u13F6\u13F7\u13FE\u13FF\u169D-\u169F\u16F9-\u16FF\u170D\u1715-\u171F\u1737-\u173F\u1754-\u175F\u176D\u1771\u1774-\u177F\u17DE\u17DF\u17EA-\u17EF\u17FA-\u17FF\u180F\u181A-\u181F\u1879-\u187F\u18AB-\u18AF\u18F6-\u18FF\u191F\u192C-\u192F\u193C-\u193F\u1941-\u1943\u196E\u196F\u1975-\u197F\u19AC-\u19AF\u19CA-\u19CF\u19DB-\u19DD\u1A1C\u1A1D\u1A5F\u1A7D\u1A7E\u1A8A-\u1A8F\u1A9A-\u1A9F\u1AAE\u1AAF\u1ABF-\u1AFF\u1B4C-\u1B4F\u1B7D-\u1B7F\u1BF4-\u1BFB\u1C38-\u1C3A\u1C4A-\u1C4C\u1C89-\u1C8F\u1CBB\u1CBC\u1CC8-\u1CCF\u1CFA-\u1CFF\u1DFA\u1F16\u1F17\u1F1E\u1F1F\u1F46\u1F47\u1F4E\u1F4F\u1F58\u1F5A\u1F5C\u1F5E\u1F7E\u1F7F\u1FB5\u1FC5\u1FD4\u1FD5\u1FDC\u1FF0\u1FF1\u1FF5\u1FFF\u2065\u2072\u2073\u208F\u209D-\u209F\u20C0-\u20CF\u20F1-\u20FF\u218C-\u218F\u2427-\u243F\u244B-\u245F\u2B74\u2B75\u2B96\u2B97\u2BC9\u2BFF\u2C2F\u2C5F\u2CF4-\u2CF8\u2D26\u2D28-\u2D2C\u2D2E\u2D2F\u2D68-\u2D6E\u2D71-\u2D7E\u2D97-\u2D9F\u2DA7\u2DAF\u2DB7\u2DBF\u2DC7\u2DCF\u2DD7\u2DDF\u2E4F-\u2E7F\u2E9A\u2EF4-\u2EFF\u2FD6-\u2FEF\u2FFC-\u2FFF\u3040\u3097\u3098\u3100-\u3104\u3130\u318F\u31BB-\u31BF\u31E4-\u31EF\u321F\u32FF\u4DB6-\u4DBF\u9FF0-\u9FFF\uA48D-\uA48F\uA4C7-\uA4CF\uA62C-\uA63F\uA6F8-\uA6FF\uA7BA-\uA7F6\uA82C-\uA82F\uA83A-\uA83F\uA878-\uA87F\uA8C6-\uA8CD\uA8DA-\uA8DF\uA954-\uA95E\uA97D-\uA97F\uA9CE\uA9DA-\uA9DD\uA9FF\uAA37-\uAA3F\uAA4E\uAA4F\uAA5A\uAA5B\uAAC3-\uAADA\uAAF7-\uAB00\uAB07\uAB08\uAB0F\uAB10\uAB17-\uAB1F\uAB27\uAB2F\uAB66-\uAB6F\uABEE\uABEF\uABFA-\uABFF\uD7A4-\uD7AF\uD7C7-\uD7CA\uD7FC-\uD7FF\uFA6E\uFA6F\uFADA-\uFAFF\uFB07-\uFB12\uFB18-\uFB1C\uFB37\uFB3D\uFB3F\uFB42\uFB45\uFBC2-\uFBD2\uFD40-\uFD4F\uFD90\uFD91\uFDC8-\uFDEF\uFDFE\uFDFF\uFE1A-\uFE1F\uFE53\uFE67\uFE6C-\uFE6F\uFE75\uFEFD\uFEFE\uFF00\uFFBF-\uFFC1\uFFC8\uFFC9\uFFD0\uFFD1\uFFD8\uFFD9\uFFDD-\uFFDF\uFFE7\uFFEF-\uFFF8\uFFFE\uFFFF\uE000-\uF8FF]/g; // eslint-disable-line no-control-regex

function stripInvisibleChars(string) {
  // Ensure we have a string
  string = string || "";

  // Remove invisible characters like control characters
  string = string.replace(invisibleCharRegex, "");

  return string;
}

function slugify(str, options = {}) {
  // Ensure we have a string
  str = str || "";

  // Strip all characters that cannot be printed
  str = stripInvisibleChars(str);

  // Handle the £ symbol separately, since it needs to be removed before the unicode conversion.
  str = str.replace(/£/g, "-");

  // Remove non ascii characters
  str = slugifyExt(str);

  // Replace URL reserved chars: `@:/?#[]!$&()*+,;=` as well as `\%<>|^~£"{}` and \`
  str = str
    .replace(
      /(\s|\.|@|:|\/|\?|#|\[|\]|!|\$|&|\(|\)|\*|\+|,|;|=|\\|%|<|>|\||\^|~|"|\{|\}|`|–|—)/g,
      "-"
    )
    // Remove apostrophes
    .replace(/'/g, "")
    // Make the whole thing lowercase
    .toLowerCase();

  // These changes are optional changes, we can enable/disable these
  if (!options.requiredChangesOnly) {
    // Convert 2 or more dashes into a single dash
    str = str
      .replace(/-+/g, "-")
      // Remove trailing dash
      .replace(/-$/, "")
      // Remove any dashes at the beginning
      .replace(/^-/, "");
  }

  // Handle whitespace at the beginning or end.
  str = str.trim();

  return str;
}

export async function fetchAuthed({ ndk, url, method = "GET", body, pow = 0 }) {
  const pubkey = (await signer.user()).pubkey;

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
  console.log("signed", JSON.stringify(authEvent.rawEvent()));

  const auth = Buffer.from(
    JSON.stringify(authEvent.rawEvent()),
    "utf-8"
  ).toString("base64");

  return await fetch(url, {
    method,
    headers: {
      Authorization: `Nostr ${auth}`,
    },
    body,
  });
}

async function getSessionToken() {
  await ensureAuth();

  const pubkey = (await signer.user()).pubkey;
  const ndk = new NDK();
  let pow = MIN_POW;
  let token = "";
  do {
    try {
      const r = await fetchAuthed({
        ndk,
        url: `${NPUB_PRO_API}/auth?npub=${nip19.npubEncode(pubkey)}`,
        pow,
      });
      if (r.status === 200) {
        const data = await r.json();
        console.log("r", data);
        token = data.token;
        break;
      } else if (r.status === 403) {
        const rep = await r.json();
        console.log("need more pow", rep);
        pow = rep.minPow;
      } else {
        throw new Error("Bad reply " + r.status);
      }
    } catch (e) {
      console.log("Error", e);
    }
  } while (pow < MIN_POW + 5);
  console.log("token", token);
  if (token) {
    const file = homedir + "/.nostr-site-cli-token.json";
    fs.writeFileSync(file, token);
  }
}

async function getAdminSessionToken(pubkey) {
  const token = createSessionToken(pubkey);
  const file = homedir + "/.nostr-site-cli-token.json";
  fs.writeFileSync(file, token);
}

async function fetchWithSession(url, method = "GET", body = undefined) {
  const file = homedir + "/.nostr-site-cli-token.json";
  const token = fs.readFileSync(file);
  const headers = {
    "X-NpubPro-Token": token,
  };
  if (body) {
    headers["Content-Type"] = "application/json";
  }
  return fetch(url, {
    method,
    body: body ? JSON.stringify(body) : undefined,
    headers,
  })
    .then((r) => {
      console.log("reply", r);
      return r.json();
    })
    .catch((e) => console.error("error", e));
}

async function testDeploy(pubkey, kinds, hashtags, themePackageId) {
  console.log(
    Date.now(),
    "test deploy",
    pubkey,
    kinds,
    hashtags,
    themePackageId
  );
  await ensureAuth();
  const signerPubkey = (await signer.user()).pubkey;
  console.log(Date.now(), "authed as", signerPubkey);

  const ndk = new NDK({
    explicitRelayUrls: [...OUTBOX_RELAYS],
  });
  ndk.connect();

  const theme = await ndk.fetchEvent(
    {
      ids: [themePackageId],
      kinds: [KIND_PACKAGE],
    },
    { groupable: false },
    NDKRelaySet.fromRelayUrls(["wss://relay.nostr.band"], ndk)
  );
  console.log(Date.now(), "theme", theme.rawEvent());
  const themeHash = tv(theme, "x");
  const themeName = tv(theme, "title");
  console.log("theme title", themeName, "hash", themeHash);

  const profile = await fetchProfile(ndk, pubkey);
  if (!profile) throw new Error("Failed to fetch profile");

  const meta = JSON.parse(profile.content);
  console.log(Date.now(), "meta", meta);

  const name = meta.name || meta.display_name;
  console.log("name", name);

  const requestedDomain = slugify(name).replace("_", "-");

  const siteEvent = {
    created_at: Math.floor(Date.now() / 1000),
    kind: KIND_SITE,
    content: "",
    tags: [
      ["d", "" + Date.now()],
      ["name", name || "Nostr site"],
      ["title", meta.display_name || meta.name || "Nostr site"],
      ["summary", meta.about || ""],
      ["icon", meta.picture || ""],
      ["image", meta.banner || ""],
      ["p", pubkey],
      ["z", "pro.npub.v1"],
      // ["logo", ""],
      // ["lang", "en"],
      // ["meta_title", ""],
      // ["meta_description", ""],
      // ["og_title", ""],
      // ["og_description", ""],
      // ["og_image", ""],
      // ["twitter_image", ""],
      // ["twitter_title", ""],
      // ["twitter_description", ""],

      // ["config", "hashtags", ""],

      // ["nav", "/", "Home"],
    ],
  };

  siteEvent.tags.push(...kinds.map((k) => ["kind", "" + k]));
  siteEvent.tags.push(...hashtags.map((h) => ["include", "t", h]));
  if (!hashtags.length) siteEvent.tags.push(["include", "*"]);

  siteEvent.tags.push(["x", theme.id, theme.relay.url, themeHash, themeName]);

  const naddrDomain = nip19.naddrEncode({
    identifier: requestedDomain,
    kind: KIND_SITE,
    pubkey: signerPubkey,
  });
  console.log("naddrDomain", naddrDomain);

  console.log("requesting domain", requestedDomain);

  // ask for sub-domain
  const reply = await fetchWithSession(
    `${NPUB_PRO_API}/reserve?domain=${requestedDomain}&site=${naddrDomain}`
  );
  console.log(Date.now(), "got domain", reply);

  siteEvent.tags.push(["r", `https://${reply.domain}/`]);

  console.log("site event", siteEvent);

  const ndkEvent = new NDKEvent(ncNdk, siteEvent);
  await ndkEvent.sign(signer);
  console.log(Date.now(), "signed", ndkEvent.rawEvent());

  const relays = await fetchOutboxRelays(ndk, [signerPubkey]);
  if (relays.length > 5) relays.length = 5;
  console.log(Date.now(), "outbox relays", relays);

  const naddr = nip19.naddrEncode({
    identifier: requestedDomain,
    kind: KIND_SITE,
    pubkey: signerPubkey,
    relays,
  });

  const pubEvent = new NDKEvent(ndk, ndkEvent.rawEvent());
  const r = await pubEvent.publish(NDKRelaySet.fromRelayUrls(relays, ndk));
  console.log(
    Date.now(),
    "published to relays",
    r.size,
    [...r.values()].map((r) => r.url)
  );

  const deployReply = await fetchWithSession(
    `${NPUB_PRO_API}/deploy?domain=${reply.domain}&site=${naddr}`
  );
  console.log(Date.now(), "deployed", deployReply);
}

async function readText(s3reply) {
  let content = "";
  for await (const chunk of s3reply.Body) content += chunk.toString("utf-8");
  return content;
}

function parseNaddr(naddr) {
  if (!naddr) return undefined;
  try {
    const { type, data } = nip19.decode(naddr);
    if (type === "naddr") return data;
  } catch (e) {
    console.log("Bad naddr", naddr, e);
  }
  return undefined;
}

function getDomainKey(domain) {
  return `${domain}.json`;
}

function getReservedKey(key) {
  return `reserved/${key}`;
}

async function fetchDomainInfo(domain, s3, skipExpired = true) {
  const fetchKey = async (key) => {
    try {
      console.log("fetching", key);
      let file = await s3.send(
        new GetObjectCommand({
          Bucket: DOMAINS_BUCKET,
          Key: key,
        })
      );

      const content = await readText(file);
      console.log("file", content);

      const info = JSON.parse(content);

      if (skipExpired && info.expires && info.expires < Date.now()) {
        console.log("Reserved info expired", info);
        return undefined;
      }

      return info;
    } catch (e) {
      if (e.Code !== "NoSuchKey") throw e;
    }

    return undefined;
  };

  const key = getDomainKey(domain);
  return (await fetchKey(key)) || (await fetchKey(getReservedKey(key)));
}

async function upsertDomainInfo(prisma, data) {
  return prisma.domain.upsert({
    create: data,
    update: data,
    where: { domain: data.domain },
  });
}

async function putDomainInfo(info, status, expires, s3) {
  const data = {
    domain: info.domain,
    site: info.site,
    pubkey: info.pubkey,
    status,
    timestamp: Date.now(),
    expires,
    // reset
    rendered: 0,
    updated: 0,
    fetched: 0,
  };

  let key = getDomainKey(data.domain);
  if (status === STATUS_RESERVED) key = getReservedKey(key);

  const content = JSON.stringify(data);
  const cs = Buffer.from(sha256(content)).toString("base64");
  console.log("putting", key);
  const cmd = new PutObjectCommand({
    Bucket: DOMAINS_BUCKET,
    Body: content,
    Key: key,
    ChecksumAlgorithm: "SHA256",
    ChecksumSHA256: cs,
  });
  const r = await s3.send(cmd);
  if (r.ChecksumSHA256 !== cs) throw new Error("Bad cs after upload");

  return data;
}

function getReqUrl(req) {
  return "https://" + req.headers["host"] + req.url;
}

async function sendReply(res, reply, status) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader(
    "Access-Control-Allow-Origin",
    res.req.headers["origin"] || "*"
  );
  res.setHeader("Access-Control-Allow-Methods", "*");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Authorization, X-NpubPro-Token, Content-Type"
  );
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.writeHead(status || 200);
  res.end(JSON.stringify(reply));
}

async function sendError(res, msg, status) {
  console.error("error", msg);
  sendReply(res, { error: msg }, status);
}

function parseSession(req) {
  const token = req.headers["x-npubpro-token"] || "";
  const data = parseSessionToken(token);
  console.log("token", token, "data", data);
  if (!data) return undefined;
  if (Date.now() / 1000 - data.timestamp > SESSION_TTL) return undefined;
  return data.pubkey;
}

function canReserve(domain, admin, addr, info) {
  const infoAddr = parseNaddr(info.site);
  if (
    info.domain === domain &&
    info.pubkey === admin &&
    infoAddr &&
    addr &&
    infoAddr.pubkey === addr.pubkey &&
    infoAddr.kind === addr.kind &&
    infoAddr.identifier === addr.identifier
  ) {
    // all ok, already assigned to same site
    console.log("Already assigned", domain, addr);
    return true;
  } else if (
    info.domain === domain &&
    info.pubkey === admin &&
    info.status === STATUS_RESERVED &&
    !infoAddr
  ) {
    // all ok, we reserved this domain for this pubkey
    console.log("Already reserved to pubkey", domain, info.pubkey);
    return true;
  } else if (
    info.domain === domain &&
    info.pubkey === admin &&
    info.status === STATUS_RELEASED
  ) {
    // all ok, this domain was released by this pubkey
    console.log("Released by pubkey", domain, info.pubkey);
    return true;
  } else if (
    info.domain === domain &&
    info.status === STATUS_RELEASED &&
    info.expires < Date.now()
  ) {
    // all ok, this domain was released long ago by other pubkey
    console.log("Released and expired", domain, info.pubkey);
    return true;
  } else {
    // choose another domain for this site
    console.log(
      "Can't reserve, already assigned",
      domain,
      "pubkey",
      info.pubkey
    );
    return false;
  }
}

async function reserve(
  site,
  admin,
  domain,
  expires,
  s3,
  prisma,
  noRetry = false
) {
  const addr = site ? parseNaddr(site) : undefined;
  if (site && !addr) return sendError(res, "Bad site '" + site + "'", 400);

  let info = await fetchDomainInfo(domain, s3);
  console.log("existing info", info);

  if (info) {
    const available = canReserve(domain, admin, addr, info);

    // if (
    //   info.domain === domain &&
    //   info.pubkey === admin &&
    //   infoAddr &&
    //   addr &&
    //   infoAddr.pubkey === addr.pubkey &&
    //   infoAddr.kind === addr.kind &&
    //   infoAddr.identifier === addr.identifier
    // ) {
    //   // all ok, already assigned to same site
    //   console.log("Already assigned", domain, site);
    // } else if (
    //   info.domain === domain &&
    //   info.pubkey === admin &&
    //   info.status === "reserved" &&
    //   !infoAddr
    // ) {
    //   // all ok, we reserved this domain for this pubkey
    //   console.log("Already reserved to pubkey", domain, info.pubkey);
    // } else if (
    //   info.domain === domain &&
    //   info.pubkey === admin &&
    //   info.status === "released"
    // ) {
    //   // all ok, this domain was released by this pubkey
    //   console.log("Released by pubkey", domain, info.pubkey);
    // } else if (
    //   info.domain === domain &&
    //   info.status === "released" &&
    //   info.expires < Date.now()
    // ) {
    //   // all ok, this domain was released long ago by other pubkey
    //   console.log("Released and expired", domain, info.pubkey);
    // } else {
    //   // choose another domain for this site
    //   console.log(
    //     "Failed to reserve, already assigned",
    //     domain,
    //     "pubkey",
    //     info.pubkey
    //   );
    if (!available) {
      if (!noRetry) {
        // try 3 times to append XX number
        for (let i = 0; i < 3; i++) {
          const n = Math.floor(Math.random() * 100);
          domain = `${domain}${n}`;
          console.log("trying new domain", domain);
          info = await fetchDomainInfo(domain, s3);
          if (!info) break;
        }
      }

      // could be reset after retries above
      if (info) throw new Error("Failed to assign domain");
    }
  }

  // not yet reserved for us?
  if (!info) {
    const data = await putDomainInfo(
      { domain, site, pubkey: admin },
      STATUS_RESERVED,
      expires,
      s3
    );
    console.log("reserved", domain, admin, site, data);
    info = data;
  }

  // ensure local copy of this domain
  await upsertDomainInfo(prisma, info);

  // the one we assigned
  return domain;
}

function isValidDomain(d) {
  return (
    d.match(/^[a-z0-9][a-z0-9-]+[a-z0-9]$/) || d.match(/^[a-z0-9][a-z0-9]$/)
  );
}

async function apiReserve(req, res, s3, prisma) {
  const admin = parseSession(req);
  if (!admin) return sendError(res, "Auth please", 401);

  const ip = getIp(req);
  const ipd = getIpDomains(ip);
  if (ipd > MAX_DOMAINS_PER_IP) return sendError(res, "Too many domains", 403);

  const url = new URL(req.url, "http://localhost");

  const domain = url.searchParams.get("domain");
  const site = url.searchParams.get("site");
  const noRetry = url.searchParams.get("no_retry") === "true";
  if (!domain || !site) return sendError(res, "Specify domain and site", 400);

  if (!isValidDomain(domain))
    return sendError(res, "Bad domain '" + domain + "'", 400);

  const expires = Date.now() + 3600000; // 1 hour
  const assignedDomain = await reserve(
    site,
    admin,
    domain,
    expires,
    s3,
    prisma,
    noRetry
  );

  // update counter for this ip
  ipDomains.set(ip, { domains: ipd, tm: Date.now() });

  sendReply(res, {
    domain: `${assignedDomain}.npub.pro`,
    site,
  });
}

async function getSiteDomain(admin, addr, prisma) {
  const sites = await prisma.domain.findMany({
    where: {
      pubkey: admin,
      status: STATUS_DEPLOYED,
    },
  });
  const site = sites.find((s) => {
    const a = parseNaddr(s.site);
    return (
      a.pubkey === addr.pubkey &&
      a.identifier === addr.identifier &&
      a.kind === addr.kind
    );
  });
  if (!site) return "";
  console.log("Domain for site", addr, site.domain);
  return site.domain;
}

/**
 *
 * @param {*} site* - site addr to be (re-)deployed
 * @param {*} domain - chosen domain, can be omitted for re-deploy
 * @param {*} from - optional domain to release if admin is the same
 * @returns
 */

async function apiDeploy(req, res, s3, prisma) {
  const admin = parseSession(req);
  if (!admin) return sendError(res, "Auth please", 401);

  const url = new URL(req.url, "http://localhost");

  let domain = url.searchParams.get("domain").split(".npub.pro")[0];
  const site = url.searchParams.get("site");
  // const autoReserve = url.searchParams.get("reserver") === "true";
  const from = url.searchParams.get("from");

  if (!site) return sendError(res, "Specify site", 400);

  const addr = parseNaddr(site);
  if (!addr) return sendError(res, "Bad site '" + site + "'", 400);

  if (domain) {
    if (!isValidDomain(domain))
      return sendError(res, "Bad domain '" + domain + "'", 400);
  } else {
    // if person changed address to external and thus domain is empty?
    // then we search for this site in our local db and redeploy there
    // to rebuild their dist.zip etc
    domain = await getSiteDomain(admin, addr, prisma);
    if (!domain) return sendError(res, "Site not found", 404);
  }

  // must be reserved before deploy
  const info = await fetchDomainInfo(domain, s3);
  if (!info) {
    return sendError(res, "Domain not reserved", 400);
  }

  // must be already reserved for this website
  // const infoAddr = parseNaddr(info.site);
  // if (
  //   info.domain !== domain ||
  //   info.pubkey !== admin ||
  //   (infoAddr &&
  //     info.status !== "released" &&
  //     (infoAddr.pubkey !== addr.pubkey ||
  //       infoAddr.identifier !== addr.identifier ||
  //       infoAddr.kind !== addr.kind))
  // )
  if (!canReserve(domain, admin, addr, info))
    return sendError(res, "Wrong site", 400);

  // pre-render one page and publish
  await spawn("release_website_zip_preview", [site, "20", "domain:" + domain]);

  // await releaseWebsite(site, ["/"], { preview: true, zip: true, domain });

  // set the site
  info.site = site;

  const expires = 0;
  const data = await putDomainInfo(info, STATUS_DEPLOYED, expires, s3);

  // ensure local copy of this domain
  await upsertDomainInfo(prisma, data);

  // make old domain expire soon
  if (from && from !== domain) {
    const oldInfo = await fetchDomainInfo(from, s3);
    console.log("old info", oldInfo);
    if (oldInfo && oldInfo.pubkey === admin) {
      // delete the old deployment
      await deleteSite(oldInfo, s3, prisma);
    }
  }

  sendReply(res, {
    status: STATUS_DEPLOYED,
    expires,
  });
}

/**
 *
 * @param {*} from* - old site addr
 * @param {*} to* - new site addr
 * @returns
 */

async function apiMigrate(req, res, s3, prisma, ndk) {
  const admin = parseSession(req);
  if (!admin) return sendError(res, "Auth please", 401);

  const url = new URL(req.url, "http://localhost");

  const fromSite = url.searchParams.get("from");
  const fromId = url.searchParams.get("fromId");
  const toSite = url.searchParams.get("to");
  const relays = (url.searchParams.get("relays") || "")
    .split(",")
    .filter((r) => !!r);

  if (!fromSite || !toSite) return sendError(res, "Specify sites", 400);

  const fromAddr = parseNaddr(fromSite);
  if (!fromAddr) return sendError(res, "Bad site '" + fromSite + "'", 400);
  const toAddr = parseNaddr(toSite);
  if (!toAddr) return sendError(res, "Bad site '" + toSite + "'", 400);

  const domain = await getSiteDomain(admin, fromAddr, prisma);
  if (!domain) return sendError(res, "Not found site '" + fromSite + "'", 400);
  const checkToDomain = await getSiteDomain(admin, toAddr, prisma);
  if (checkToDomain)
    return sendError(res, "Already exists site '" + toSite + "'", 400);

  // must be reserved before deploy
  const info = await fetchDomainInfo(domain, s3);
  const infoAddr = parseNaddr(info?.site);
  if (
    !info ||
    info.pubkey !== admin ||
    infoAddr.pubkey !== fromAddr.pubkey ||
    infoAddr.kind !== fromAddr.kind ||
    infoAddr.identifier !== fromAddr.identifier ||
    info.domain !== domain ||
    info.status !== STATUS_DEPLOYED
  ) {
    return sendError(res, "Domain not reserved", 400);
  }

  // fake pre-release to make canReserve work
  info.status = STATUS_RELEASED;
  if (!canReserve(domain, admin, toAddr, info))
    return sendError(res, "Wrong site", 400);

  // delete old site data
  await deleteDomainFiles(domain, s3);

  // pre-render one page and publish
  await spawn("release_website_zip_preview", [
    toSite,
    "20",
    "domain:" + domain,
  ]);

  // now also migrate the attached domains,
  // all we need to do is update local mapping,
  // the CDN-level mapping operates with subdomains,
  // which we've just redirected above
  const attached = await prisma.attach.findMany({
    where: {
      pubkey: admin,
      site: fromSite,
    },
  });
  for (const data of attached) {
    data.site = toSite;
    await prisma.attach.upsert({
      // set toSite
      update: { ...data, site: toSite },
      // to fromSite
      where: {
        pubkey_site_domain: {
          pubkey: admin,
          site: fromSite,
          domain: data.domain,
        },
      },
    });
  }

  // set the site
  info.site = toSite;

  const expires = 0;
  const data = await putDomainInfo(info, STATUS_DEPLOYED, expires, s3);

  // ensure local copy of this domain
  await upsertDomainInfo(prisma, data);

  // delete event and old site record from db
  await deleteSiteEvent(res, admin, fromSite, fromId, relays, prisma, ndk);

  // FIXME migrate all pins? Do we allow pinning for sites that are delegated?

  // ok
  sendReply(res, {
    status: STATUS_DEPLOYED,
    expires,
  });
}

async function deleteSite(info, s3, prisma) {
  // mark as released for several days
  const expires = Date.now() + 7 * 24 * 60 * 60 * 1000;
  const data = await putDomainInfo(info, STATUS_RELEASED, expires, s3);

  // ensure local copy of this domain
  await upsertDomainInfo(prisma, data);

  // delete files
  await deleteDomainFiles(data.domain, s3);

  return expires;
}

async function deleteDomainFiles(domain, s3, keys = undefined) {
  s3 = s3 || new S3Client({ region: AWSRegion });

  keys = keys || (await listBucketKeys(SITES_BUCKET, domain, s3));
  while (keys.length > 0) {
    const batch = keys.splice(0, Math.min(keys.length, 1000));
    const cmd = new DeleteObjectsCommand({
      Bucket: SITES_BUCKET,
      Delete: {
        Objects: batch.map((k) => ({ Key: k })),
        Quiet: true,
      },
    });

    const r = await s3.send(cmd);
    console.log("deleted domain", domain, "batch", batch, "r", r);
  }
}

function isOwner(domain, admin, addr, info) {
  const infoAddr = parseNaddr(info.site);
  if (
    // same domain, owner and siteId
    info.domain === domain &&
    info.pubkey === admin &&
    infoAddr &&
    infoAddr.pubkey === addr.pubkey &&
    infoAddr.identifier === addr.identifier &&
    infoAddr.kind === addr.kind
  )
    return true;

  return false;
}

async function apiDelete(req, res, s3, prisma) {
  const admin = parseSession(req);
  if (!admin) return sendError(res, "Auth please", 401);

  const url = new URL(req.url, "http://localhost");

  let domain = url.searchParams.get("domain").split(".npub.pro")[0];
  const site = url.searchParams.get("site");
  const addr = parseNaddr(site);
  if (!addr) return sendError(res, "Bad site '" + site + "'", 400);

  // to make it idempotent, we're finding any trace of our
  // site (even if it's already deleted)
  const sites = await prisma.domain.findMany({
    where: {
      pubkey: admin,
    },
  });
  const domainSite = sites.find((s) => {
    const a = parseNaddr(s.site);
    if (!a) console.log("bad site", s.site, s);
    return (
      a &&
      a.pubkey === addr.pubkey &&
      a.identifier === addr.identifier &&
      a.kind === addr.kind &&
      (!domain || s.domain === domain)
    );
  });
  if (!domainSite) return sendError(res, "Site not found", 404);
  domain = domainSite.domain;
  console.log("Domain for deleted site", domain);

  const info = await fetchDomainInfo(domain, s3);
  if (!info) return sendError(res, "Domain not reserved", 400);

  // must be already reserved for this website
  if (!isOwner(domain, admin, addr, info))
    return sendError(res, "Wrong site", 400);

  // mark as released for several days
  const expires = await deleteSite(info, s3, prisma);

  // done
  sendReply(res, {
    status: STATUS_RELEASED,
    expires,
  });
}

async function apiCheck(req, res, s3) {
  const admin = parseSession(req);
  if (!admin) return sendError(res, "Auth please", 401);

  const url = new URL(req.url, "http://localhost");

  const domain = url.searchParams.get("domain").split(".npub.pro")[0];
  const site = url.searchParams.get("site");

  if (!domain || !site) return sendError(res, "Specify domain and site", 400);

  if (!isValidDomain(domain))
    return sendError(res, "Bad domain '" + domain + "'", 400);

  const addr = parseNaddr(site);
  if (!addr) return sendError(res, "Bad site '" + site + "'", 400);

  const info = await fetchDomainInfo(domain, s3);
  if (info) {
    // const infoAddr = parseNaddr(info.site);
    // if (
    //   info.domain !== domain ||
    //   info.pubkey !== admin ||
    //   !infoAddr ||
    //   (info.status !== "released" &&
    //     (infoAddr.pubkey !== addr.pubkey ||
    //       infoAddr.identifier !== addr.identifier ||
    //       infoAddr.kind !== addr.kind))
    // ) {
    if (!canReserve(domain, admin, addr, info))
      return sendError(res, "Not available", 409);
  }

  return sendReply(res, {
    domain,
    status: "available",
  });
}

async function getCert(id, acm) {
  const command = new DescribeCertificateCommand({
    CertificateArn: id,
  });

  try {
    const response = await acm.send(command);
    console.log("acm cert", id, response.Certificate);
    return response.Certificate;
  } catch (e) {
    console.error("getCert error", e, id);
    return null;
  }
}

async function waitGetCert(id, acm) {
  for (let i = 0; i < 10; i++) {
    const c = await getCert(id, acm);

    if (c && c.Status !== "PENDING_VALIDATION") return c;

    // wait for cert and for validation options to appear
    if (
      !c ||
      !c.DomainValidationOptions.length ||
      !c.DomainValidationOptions[0].ResourceRecord
    ) {
      await new Promise((ok) => setTimeout(ok, 1000));
    } else {
      return c;
    }
  }

  // not found or validation options didn't appear
  return null;
}

async function getCertId(domain, prisma) {
  const rec = await prisma.certs.findFirst({
    where: {
      domain,
      error: "",
    },
  });
  console.log("domain cert", domain, rec);
  return rec ? rec.id : "";
}

async function setCertError(id, error, prisma) {
  await prisma.certs.update({
    where: { id },
    data: { error },
  });
}

async function sendCert(res, domain, admin, cert) {
  const owned = await checkOwnedDomain(domain, admin);
  console.log("owned", owned, domain, admin);
  const vo =
    cert.DomainValidationOptions && cert.DomainValidationOptions.length > 0
      ? cert.DomainValidationOptions[0].ResourceRecord
      : undefined;
  const dnsValidation = [
    {
      type: "TXT",
      name: `_nostr-admin-pubkey`,
      value: `${admin}`,
    },
  ];
  if (vo)
    dnsValidation.push({
      type: vo.Type,
      name: vo.Name.split("." + domain)[0],
      value: vo.Value,
    });
  let status = cert.Status;
  if (status === "ISSUED" && !owned) status = "PENDING_ADMIN_VALIDATION";
  return sendReply(res, {
    domain,
    status,
    dnsValidation,
  });
}

async function apiCreateCert(req, res, acm, prisma) {
  const admin = parseSession(req);
  if (!admin) return sendError(res, "Auth please", 401);

  const url = new URL(req.url, "http://localhost");

  const domain = url.searchParams.get("domain").toLocaleLowerCase();
  if (!domain) return sendError(res, "Specify domain", 400);
  if (!domain.includes(".")) return sendError(res, "Bad domain", 400);

  const alts = [domain, `*.${domain}`];
  // if (domain.split(".").length === 2) alts.push(`*.${domain}`);

  const id = await getCertId(domain, prisma);
  if (id) {
    console.log("cert already requested", domain, id);
    const cert = await waitGetCert(id, acm);
    console.log("existing cert", domain, cert);
    if (cert) return sendCert(res, domain, admin, cert);

    // mark old cert as failed
    await setCertError(id, "Not found or failed", prisma);
  }

  const command = new RequestCertificateCommand({
    // RequestCertificateRequest
    DomainName: domain, // required
    ValidationMethod: "DNS",
    SubjectAlternativeNames: alts,
    IdempotencyToken: bytesToHex(sha256(domain)).substring(0, 32), // per-domain calls are idempotent
    Options: {
      CertificateTransparencyLoggingPreference: "ENABLED",
    },
    Tags: [
      {
        // Tag
        Key: "creator", // required
        Value: admin,
      },
    ],
    KeyAlgorithm: "RSA_2048",
  });
  console.log("acm command", command);

  try {
    const response = await acm.send(command);
    console.log("acm response", response);
    const id = response.CertificateArn;

    const cert = await waitGetCert(id, acm);
    if (!cert) throw new Error("Failed to wait for cert");

    const data = {
      id,
      domain,
      pubkey: "",
      timestamp: Date.now(),
      error: "",
    };

    // write to db
    await prisma.certs.create({
      data,
    });

    return sendCert(res, domain, admin, cert);
  } catch (e) {
    console.error("apiCreateCert error", e, domain, admin);
    return sendError(res, "Failed to request cert", 500);
  }
}

async function apiGetCert(req, res, acm, prisma) {
  const admin = parseSession(req);
  if (!admin) return sendError(res, "Auth please", 401);

  const url = new URL(req.url, "http://localhost");

  const domain = url.searchParams.get("domain").toLocaleLowerCase();
  if (!domain) return sendError(res, "Specify domain", 400);

  const id = await getCertId(domain, prisma);
  if (!id) return sendError(res, "Certificate not found", 404);

  const cert = await waitGetCert(id, acm);
  if (!cert) return sendError(res, "Failed to get cert", 500);

  return sendCert(res, domain, admin, cert);
}

async function dnsResolveNoCache(domain, type) {
  // validate! otherwise we'll get f-ed by a code injection
  // https://stackoverflow.com/a/26987741
  const rx =
    /^(((?!-))(xn--|_)?[a-z0-9-]{0,61}[a-z0-9]{1,1}\.)*(xn--)?([a-z0-9][a-z0-9\-]{0,60}|[a-z0-9-]{1,30}\.[a-z]{2,})$/;

  const types = ["TXT", "A", "CNAME"];
  if (!domain.match(rx)) throw new Error("Invalid domain");
  if (!types.includes(type)) throw new Error("Invalid dns type");

  return new Promise((ok, err) => {
    const cmd = `dig ${domain} ${type} +trace | grep ${type} | awk '{print $NF}'`;
    console.log(`exec cmd "${cmd}"`);
    childProcess.exec(cmd, (e, stdout, stderr) => {
      if (e) {
        console.log("dns error", domain, type, e, stderr);
        err(e);
        return;
      } else {
        console.log("dns", domain, type, `"${stdout}"`);
        const recs = stdout
          .split("\n")
          .map((s) => s.trim())
          .filter((s) => !s.startsWith(";"))
          .map((s) => {
            if (s.startsWith('"') && s.endsWith('"'))
              return s.substring(1, s.length - 1);
            else return s;
          })
          .filter((s) => !!s);
        console.log("recs", recs);
        ok(recs);
      }
    });
  });
}

async function checkOwnedDomain(domain, admin) {
  // const recs = await new Promise((ok, err) => {
  //   dns.resolveTxt(domain, (e, addresses) => {
  //     if (e) console.warn("no txt record for", domain, e);
  //     ok(addresses || []);
  //   });
  // });
  const oldRecs = await dnsResolveNoCache(domain, "TXT");
  console.log("txt recs old", domain, admin, oldRecs);
  // NOTE: deprecated
  for (const r of oldRecs) {
    const kv = Array.isArray(r) ? r[0] : r;
    if (kv.trim() === `nostr-admin-pubkey=${admin}`) return true;
  }

  const recs = await dnsResolveNoCache(`_nostr-admin-pubkey.${domain}`, "TXT");
  console.log("txt recs", domain, admin, recs);
  for (const r of recs) {
    const kv = Array.isArray(r) ? r[0] : r;
    if (kv.trim() === admin) return true;
  }

  return false;
}

async function listDistributions(cf) {
  const list = [];
  let marker = "";
  do {
    const listResponse = await cf.send(
      new ListDistributionsCommand({
        Marker: marker,
        MaxItems: 1000,
      })
    );
    console.log("listResponse", listResponse.DistributionList.Items.length);
    list.push(...listResponse.DistributionList.Items);
    marker = listResponse.DistributionList.Marker;
  } while (marker !== "");

  return list;
}

async function getDistribution(aliases, cf) {
  const list = await listDistributions(cf);
  return list.find((d) => d.Aliases.Items.find((a) => aliases.includes(a)));
}

function getDomainCertAliases(certDomain) {
  return [certDomain, `*.${certDomain}`];
}

async function apiAttachDomain(req, res, { s3, acm, cf, lb, prisma }) {
  const admin = parseSession(req);
  if (!admin) return sendError(res, "Auth please", 401);

  const url = new URL(req.url, "http://localhost");
  console.log("url", url);
  const domain = url.searchParams.get("domain").toLocaleLowerCase();
  const site = url.searchParams.get("site");

  const addr = parseNaddr(site);
  if (!addr) return sendError(res, "Bad site '" + site + "'", 400);
  if (!domain) return sendError(res, "Specify domain and site", 400);

  const subdomain = await getSiteDomain(admin, addr, prisma);
  if (!subdomain) return sendError(res, "Site not found", 404);

  const certDomain = domain;
  const certId = await getCertId(certDomain, prisma);
  if (!certId)
    return sendError(res, "Certificate not requested for " + certDomain, 400);

  const cert = await waitGetCert(certId, acm);
  if (!cert)
    return sendError(res, "Certificate not found for " + certDomain, 400);
  if (cert.Status !== "ISSUED")
    return sendError(res, "Certificate not issued for " + certDomain, 400);

  const owned = await checkOwnedDomain(domain, admin);
  if (!owned) return sendError(res, "Domain admin mismatch", 400);

  // const list = await listDistributions(cf);
  // let marker = "";
  // do {
  //   const listResponse = await cf.send(
  //     new ListDistributionsCommand({
  //       Marker: marker,
  //       MaxItems: 1000,
  //     })
  //   );
  //   console.log("listResponse", listResponse.DistributionList.Items.length);
  //   list.push(...listResponse.DistributionList.Items);
  //   marker = listResponse.DistributionList.Marker;
  // } while (marker !== "");
  // let dist = list.find((d) => d.Aliases.Items.find((a) => aliases.includes(a)));

  // check existing distribution for these aliases
  const aliases = getDomainCertAliases(certDomain);
  let dist = await getDistribution(aliases, cf);

  console.log("existing dist", dist);

  // create distr if not found
  if (!dist) {
    const ViewerCertificate = {
      CloudFrontDefaultCertificate: false,
      ACMCertificateArn: certId,
      SSLSupportMethod: "sni-only",
      MinimumProtocolVersion: "TLSv1.2_2021",
      Certificate: certId,
      CertificateSource: "acm",
    };

    const bucketId = `${SITES_BUCKET}.s3.${AWSRegion}.amazonaws.com`;
    const conf = {
      DistributionConfig: {
        CallerReference: "" + Date.now(),
        Comment: "",
        Enabled: true,
        DefaultRootObject: "",
        HttpVersion: "http2and3",
        DefaultCacheBehavior: {
          TargetOriginId: bucketId,
          CachePolicyId: CF_CACHE_POLICY_ID,
          ResponseHeadersPolicyId: CF_RESPONSE_HEADER_POLICY_ID,
          ViewerProtocolPolicy: "redirect-to-https",
          Compress: true,
          AllowedMethods: {
            Items: ["GET", "HEAD", "OPTIONS"],
            Quantity: 3,
            CachedMethods: {
              Items: ["GET", "HEAD", "OPTIONS"],
              Quantity: 3,
            },
          },
          // NOTE: not needed bcs we use CachePolicyId
          // MinTTL: 0,
          // MaxTTL: 31536000,
          // DefaultTTL: 86400,
          // ForwardedValues: {
          //   QueryString: false,
          //   Cookies: {
          //     Forward: "none",
          //   },
          //   Headers: {
          //     Quantity: 0,
          //   },
          //   QueryStringCacheKeys: {
          //     Quantity: 0,
          //   },
          // },
          LambdaFunctionAssociations: {
            Quantity: 2,
            Items: [
              {
                EventType: "viewer-request",
                LambdaFunctionARN: LAMBDA_DOMAIN_TO_PATH,
              },
              {
                EventType: "origin-response",
                LambdaFunctionARN: LAMBDA_HANDLE_403,
              },
            ],
          },
        },
        Aliases: {
          Items: aliases,
          Quantity: aliases.length,
        },
        ViewerCertificate,
        Origins: {
          Items: [
            {
              DomainName: bucketId,
              Id: bucketId,
              ConnectionAttempts: 3,
              ConnectionTimeout: 10,
              OriginAccessControlId: CF_OAC_ID,
              S3OriginConfig: {
                OriginAccessIdentity: "",
              },
            },
          ],
          Quantity: 1,
        },
        PriceClass: "PriceClass_All",
      },
    };
    console.log("conf", JSON.stringify(conf));
    const distResponse = await cf.send(new CreateDistributionCommand(conf));
    console.log("new dist", distResponse);
    dist = distResponse.Distribution;
  }

  // update bucket policy to allow access
  const bucketPolicy = await s3.send(
    new GetBucketPolicyCommand({
      Bucket: SITES_BUCKET,
    })
  );
  console.log("bucketPolicy", bucketPolicy);
  const policy = JSON.parse(bucketPolicy.Policy);
  console.log("bucketPolicyJson", policy);
  const arn = dist.ARN;
  const arns = policy.Statement[0].Condition.StringEquals["aws:SourceArn"];
  if (!arns.includes(arn)) arns.push(arn);
  console.log("updated bucketPolicyJson", policy);

  const bucketPolicyResponse = await s3.send(
    new PutBucketPolicyCommand({
      Bucket: SITES_BUCKET,
      Policy: JSON.stringify(policy),
    })
  );
  console.log("bucketPolicyResponse", bucketPolicyResponse);

  // add cert to load-balancer
  const command = new AddListenerCertificatesCommand({
    ListenerArn: LB_LISTENER_ARN, // required
    Certificates: [
      // CertificateList // required
      {
        // Certificate
        CertificateArn: certId,
      },
    ],
  });
  const lbResponse = await lb.send(command);
  console.log("lbResponse", lbResponse);

  // map domain to subdomain
  const mapping = {
    domain: domain,
    sub: subdomain,
  };

  const mappingResponse = await uploadS3(
    s3,
    CUSTOM_BUCKET,
    `${domain}.json`,
    JSON.stringify(mapping)
  );
  console.log("mappingResponse", mappingResponse);

  const data = {
    domain,
    pubkey: admin,
    site,
  };

  // ensure attached record
  await prisma.attach.upsert({
    create: { ...data, timestamp: Date.now() },
    update: data,
    where: { pubkey_site_domain: { pubkey: admin, site, domain } },
  });

  // FIXME wait until CF deploys and DNS is updated

  return sendReply(res, {
    cnameDomain: dist.DomainName + ".",
    redirectIps: AWS_GLOBAL_ACCEL_IPS,
    status: dist.Status,
  });
}

async function apiGetAttachedDomains(req, res, { cf, prisma }) {
  const admin = parseSession(req);
  if (!admin) return sendError(res, "Auth please", 401);

  const url = new URL(req.url, "http://localhost");
  console.log("url", url);
  const domain = (url.searchParams.get("domain") || "").toLocaleLowerCase();
  const site = url.searchParams.get("site");

  const addr = parseNaddr(site);
  if (!addr) return sendError(res, "Bad site '" + site + "'", 400);

  const subdomain = await getSiteDomain(admin, addr, prisma);
  if (!subdomain) return sendError(res, "Site not found", 404);

  const attached = await prisma.attach.findMany({
    where: {
      pubkey: admin,
      site,
      domain: domain || undefined,
    },
  });

  if (domain) {
    const a = attached.find((a) => a.domain === domain);
    if (!a) return sendError(res, "Domain not found", 404);

    const aliases = getDomainCertAliases(domain);
    const dist = await getDistribution(aliases, cf);
    console.log("dist", dist);
    if (!dist) throw new Error("Attached CF not found!");

    // FIXME check DNS is valid?

    return sendReply(res, {
      cnameDomain: dist.DomainName + ".",
      redirectIps: AWS_GLOBAL_ACCEL_IPS,
      status: dist.Status,
    });
  } else {
    // list of attached domains
    return sendReply(res, {
      domains: attached.map((a) => ({
        domain: a.domain,
        timestamp: Number(a.timestamp),
      })),
    });
  }
}

class AsyncMutex {
  queue = [];
  running = false;

  async execute() {
    const { cb, ok, err } = this.queue.shift();
    this.running = true;
    try {
      ok(await cb());
    } catch (e) {
      err(e);
    }
    this.running = false;
    if (this.queue.length > 0) this.execute();
  }

  async run(cb) {
    return new Promise(async (ok, err) => {
      this.queue.push({ cb, ok, err });
      if (!this.running && this.queue.length === 1) this.execute();
    });
  }
}

function getIp(req) {
  return req.headers["x-real-ip"] || req.ip;
}

function getIpDomains(ip) {
  let { domains: lastDomains = 0, tm = 0 } = ipDomains.get(ip) || {};
  console.log("lastDomains", { ip, lastDomains, tm });
  if (lastDomains) {
    // refill: reduce threshold once per passed period
    const age = Date.now() - tm;
    const refill = Math.floor(age / DOMAINS_PERIOD);
    lastDomains -= refill;
  }

  // if have lastPow - increment it and return
  if (lastDomains && lastDomains >= 0) {
    lastDomains = lastDomains + 1;
  }

  return lastDomains;
}

function getMinPow(ip) {
  let minPow = MIN_POW;

  // have a record for this ip?
  let { pow: lastPow = 0, tm = 0 } = ipPows.get(ip) || {};
  console.log("minPow", { ip, lastPow, tm });
  if (lastPow) {
    // refill: reduce the pow threshold once per passed period
    const age = Date.now() - tm;
    const refill = Math.floor(age / POW_PERIOD);
    lastPow -= refill;
  }

  // if have lastPow - increment it and return
  if (lastPow && lastPow >= minPow) {
    minPow = lastPow + 1;
  }

  return minPow;
}

function countLeadingZeros(hex) {
  let count = 0;

  for (let i = 0; i < hex.length; i++) {
    const nibble = parseInt(hex[i], 16);
    if (nibble === 0) {
      count += 4;
    } else {
      count += Math.clz32(nibble) - 28;
      break;
    }
  }

  return count;
}

async function verifyAuthNostr(req, npub, path, minPow = 0) {
  try {
    const { type, data: pubkey } = nip19.decode(npub);
    if (type !== "npub") return false;

    const { authorization } = req.headers;
    console.log("req authorization", pubkey, authorization);
    if (!authorization || !authorization.startsWith("Nostr ")) return false;
    const data = authorization.split(" ")[1].trim();
    if (!data) return false;

    const json = Buffer.from(data, "base64");
    const event = JSON.parse(json);
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
    const method = event.tags.find(
      (t) => t.length === 2 && t[0] === "method"
    )?.[1];
    const payload = event.tags.find(
      (t) => t.length === 2 && t[0] === "payload"
    )?.[1];
    if (method !== req.method) return false;

    const url = new URL(u);
    console.log({ url });
    if (url.origin !== NPUB_PRO_API || url.pathname !== path) return false;

    if (req.body && req.body.length > 0) {
      const hash = digest("sha256", req.body.toString());
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

async function apiAuth(req, res) {
  const url = new URL(req.url, "http://localhost");

  const npub = url.searchParams.get("npub");
  const ip = getIp(req);
  const minPow = getMinPow(ip);

  if (!(await verifyAuthNostr(req, npub, "/auth", minPow)))
    return sendReply(
      res,
      {
        error: "Bad auth",
        minPow,
      },
      403
    );

  const { data: authPubkey } = nip19.decode(npub);

  // will != authPubkey if DM auth
  const tokenPubkey = authPubkey;

  const token = createSessionToken(tokenPubkey);
  console.log(Date.now(), "new token for ip", ip, tokenPubkey, token);

  // update minPow for this ip
  ipPows.set(ip, { pow: minPow, tm: Date.now() });

  sendReply(res, { token });
}

function generateOTP() {
  return randomBytes(6)
    .map((b) => b % 10)
    .map((b) => "" + b)
    .join("");
}

function getServerKey() {
  const nsec = process.env.SERVER_NSEC;
  const { type, data } = nip19.decode(nsec);
  if (type !== "nsec" || !data) throw new Error("No server key");
  return data;
}

async function sendOTP(pubkey, code, relays, ndk) {
  const key = getServerKey();
  const signer = new NDKPrivateKeySigner(key);
  const dm = new NDKEvent(ndk, {
    kind: 4,
    pubkey: getPublicKey(key),
    content: await nip04.encrypt(key, pubkey, "Npub.pro code: " + code),
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

async function apiOTP(req, res, prisma, ndk) {
  const url = new URL(req.url, "http://localhost");
  const pubkey = url.searchParams.get("pubkey");

  // we don't ask for pow in this method,
  // but we use pow counter for per-ip throttling
  const ip = getIp(req);
  const minPow = getMinPow(ip);
  if (minPow > MIN_POW + 10) return sendError(res, "Too many requests", 403);

  const relays = await fetchInboxRelays(ndk, [pubkey]);
  const code = generateOTP();

  await prisma.codes.create({
    data: {
      npub: nip19.npubEncode(pubkey),
      code,
      timestamp: Date.now(),
    },
  });

  await sendOTP(pubkey, code, relays, ndk);

  ipPows.set(ip, { pow: minPow, tm: Date.now() });

  sendReply(res, {
    pubkey,
    ok: true,
  });
}

async function apiAuthOTP(req, res, prisma) {
  const url = new URL(req.url, "http://localhost");

  const pubkey = url.searchParams.get("pubkey");
  const code = url.searchParams.get("code");

  // check token
  const rec = await prisma.codes.findFirst({
    where: {
      npub: nip19.npubEncode(pubkey),
      code,
    },
  });
  console.log("code for", pubkey, code, rec);

  // delete consumed token
  if (rec)
    await prisma.codes.delete({
      where: {
        id: rec.id,
      },
    });

  if (!rec || Date.now() - Number(rec.timestamp) > OTP_TTL)
    return sendError(res, "Bad code", 403);

  const ip = getIp(req);
  const token = createSessionToken(pubkey);
  console.log(Date.now(), "new token for ip", ip, pubkey, token);

  sendReply(res, { token });
}

async function apiSite(req, res, prisma, ndk) {
  if (req.method !== "POST") return sendError(res, "Use post", 400);

  const admin = parseSession(req);
  if (!admin) return sendError(res, "Auth please", 401);

  const url = new URL(req.url, "http://localhost");
  const relays = (url.searchParams.get("relays") || "")
    .split(",")
    .filter((r) => !!r);
  if (!relays.length) return sendError(res, "Specify relays", 400);

  const body = await new Promise((ok) => {
    let d = "";
    req.on("data", (chunk) => (d += chunk));
    req.on("end", () => ok(d));
  });

  let event = undefined;
  try {
    event = JSON.parse(body);
  } catch (e) {
    console.log("Bad event", body);
    return sendError(res, "Bad event", 400);
  }

  const key = getServerKey();
  const serverPubkey = getPublicKey(key);

  if (event.pubkey !== serverPubkey)
    return sendError(res, "Wrong event pubkey", 400);
  if (tv(event, "u") !== admin)
    return sendError(res, "Wrong admin pubkey", 400);
  if (event.kind !== KIND_SITE) return sendError(res, "Wrong kind", 400);
  if (!Array.isArray(event.tags)) return sendError(res, "Wrong tags", 400);

  const d_tag = tv(event, "d");
  if (!d_tag.trim()) return sendError(res, "No d-tag", 400);

  const existing = await prisma.sites.findFirst({
    where: {
      d_tag,
    },
  });
  if (existing && existing.pubkey !== admin)
    return sendError(res, "Not your site", 403);

  // reset to ensure it's set to current timestamp
  event.created_at = 0;

  // sign event
  const signer = new NDKPrivateKeySigner(key);
  const ne = new NDKEvent(ndk, event);
  await ne.sign(signer);
  console.log("signed", ne.rawEvent());

  // save to db
  if (!existing)
    await prisma.sites.create({
      data: {
        d_tag,
        pubkey: admin,
      },
    });

  try {
    const r = await ne.publish(NDKRelaySet.fromRelayUrls(relays, ndk), 10000);
    console.log(
      Date.now(),
      "Published site event",
      d_tag,
      "by",
      admin,
      "to",
      [...r].map((r) => r.url)
    );
    if (!r.size) throw new Error("Failed to publish site");

    sendReply(res, {
      event: ne.rawEvent(),
    });
  } catch (e) {
    console.log("Failed to publish site event", ne.id, ne.pubkey);
    return sendError(res, "Failed to publish to relays", 400);
  }
}

async function deleteSiteEvent(res, admin, site, id, relays, prisma, ndk) {
  const key = getServerKey();
  const serverPubkey = getPublicKey(key);

  const addr = parseAddr(site);
  if (addr.pubkey !== serverPubkey)
    return sendError(res, "Wrong event pubkey", 400);

  const existing = await prisma.sites.findFirst({
    where: {
      d_tag: addr.identifier,
    },
  });
  if (!existing || existing.pubkey !== admin)
    return sendError(res, "Not your site", 403);

  const delReq = {
    kind: KIND_DELETE,
    pubkey: serverPubkey,
    content: "",
    tags: [["a", `${KIND_SITE}:${addr.pubkey}:${addr.identifier}`]],
  };

  if (id) delReq.tags.push(["e", id]);

  // sign event
  const signer = new NDKPrivateKeySigner(key);
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
    return sendError(res, "Failed to publish to relays", 400);
  }

  // write to db after publishing
  await prisma.sites.delete({
    where: {
      d_tag: addr.identifier,
      pubkey: admin,
    },
  });
}

async function apiDeleteSiteEvent(req, res, prisma, ndk) {
  if (req.method !== "DELETE") return sendError(res, "Use delete", 400);

  const admin = parseSession(req);
  if (!admin) return sendError(res, "Auth please", 401);

  const url = new URL(req.url, "http://localhost");
  const site = url.searchParams.get("site");
  const id = url.searchParams.get("id");
  const relays = (url.searchParams.get("relays") || "")
    .split(",")
    .filter((r) => !!r);

  if (!site) return sendError(res, "Specify site");
  if (!relays.length) return sendError(res, "Specify relays", 400);

  // delete event and site record from db
  await deleteSiteEvent(res, admin, site, id, relays, prisma, ndk);

  sendReply(res, {
    ok: true,
  });
}

async function api(host, port) {
  const s3 = new S3Client({ region: AWSRegion });
  const acm = new ACMClient({ region: AWSEdgeRegion });
  const cf = new CloudFrontClient({ region: AWSEdgeRegion });
  const lb = new ElasticLoadBalancingV2Client({ region: AWSEdgeRegion });

  const mutex = new AsyncMutex();
  const prisma = new PrismaClient();
  const ndk = new NDK({
    explicitRelayUrls: [...OUTBOX_RELAYS],
  });
  ndk.connect();

  const requestListener = async function (req, res) {
    console.log("request", req.method, req.url, req.headers);
    try {
      if (req.method === "OPTIONS") {
        // preflight
        sendReply(res, {}, 200);
      } else if (req.url.startsWith("/reserve")) {
        // reserve with a single writer
        await mutex.run(() => apiReserve(req, res, s3, prisma));
      } else if (req.url.startsWith("/deploy")) {
        await apiDeploy(req, res, s3, prisma);
      } else if (req.url.startsWith("/delete")) {
        await apiDelete(req, res, s3, prisma);
      } else if (req.url.startsWith("/check")) {
        await apiCheck(req, res, s3);
      } else if (req.url.startsWith("/migrate")) {
        await apiMigrate(req, res, s3, prisma, ndk);
      } else if (req.url.startsWith("/authotp")) {
        await apiAuthOTP(req, res, prisma);
      } else if (req.url.startsWith("/auth")) {
        await apiAuth(req, res);
      } else if (req.url.startsWith("/otp")) {
        await apiOTP(req, res, prisma, ndk);
      } else if (req.url.startsWith("/site")) {
        if (req.method === "DELETE")
          await apiDeleteSiteEvent(req, res, prisma, ndk);
        else await apiSite(req, res, prisma, ndk);
      } else if (req.url.startsWith("/cert")) {
        if (req.method === "POST") await apiCreateCert(req, res, acm, prisma);
        else await apiGetCert(req, res, acm, prisma);
      } else if (req.url.startsWith("/attach")) {
        if (req.method === "POST")
          await apiAttachDomain(req, res, { s3, acm, cf, lb, prisma });
        else await apiGetAttachedDomains(req, res, { cf, prisma });
      } else {
        sendError(res, "Unknown method", 400);
      }
    } catch (e) {
      console.error("error", req.url, e);
      sendError(res, "Server-side error, try again later", 500);
    }
  };

  const server = http.createServer(requestListener);
  server.listen(port, host, () => {
    console.log(`Server is running on http://${host}:${port}`);
  });
}

async function fetchRelayFilterSince(ndk, relays, f, since, abortPromises) {
  console.log("fetch since", since, relays, f);
  let until = undefined;
  let queue = [];
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

    let newUntil = undefined;
    for (const e of events.values()) {
      if (!newUntil || newUntil >= e.created_at) newUntil = e.created_at;
      queue.push(e);
    }

    if (!newUntil) until = undefined;
    else if (newUntil >= until) until--;
    else until = newUntil - 1;
  } while (until);

  return queue;
}

function eventAddr(s) {
  return {
    identifier: tv(s, "d") || "",
    pubkey: s.pubkey,
    kind: s.kind,
  };
}

function eventId(e) {
  if (
    e.kind === 0 ||
    e.kind === 3 ||
    (e.kind >= 10000 && e.kind < 20000) ||
    (e.kind >= 30000 && e.kind < 40000)
  ) {
    return nip19.naddrEncode(eventAddr(e));
  } else {
    return nip19.noteEncode(e.id);
  }
}

// https://stackoverflow.com/a/12646864
function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

class EventSync {
  authors = new Map();

  constructor(ndk) {
    this.ndk = ndk;
  }

  getAuthorSites(pubkey) {
    return this.authors.get(pubkey)?.sites || [];
  }

  contributors(site) {
    const pubkeys = tags(site, "p").map((t) => t[1]);
    if (!pubkeys.length) pubkeys.push(site.pubkey);
    return pubkeys;
  }

  addAuthor(pubkey, naddr, fetched) {
    console.log(
      "add author",
      pubkey,
      fetched,
      "new",
      !this.authors.get(pubkey),
      naddr
    );
    const author = this.authors.get(pubkey) || {
      sites: [],
    };
    author.sites.push(naddr);
    // remember earliest fetch time
    if (!author.fetched || author.fetched > fetched) author.fetched = fetched;
    console.log("add author", pubkey, fetched, " => ", author.fetched);
    this.authors.set(pubkey, author);
  }

  removeAuthor(pubkey, naddr) {
    const author = this.authors.get(pubkey);
    if (author) {
      author.sites = author.sites.filter((s) => s !== naddr);
      if (!author.sites.length) this.authors.delete(pubkey);
    }
  }

  addSite(naddr, site, wasSite, fetched) {
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
    const relays = new Map();
    for (const [pubkey, author] of this.authors.entries()) {
      if (!author.relays) {
        author.relays = await fetchOutboxRelays(this.ndk, [pubkey]);

        // drop bad relays
        author.relays = author.relays.filter(
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
        const relay = relays.get(r) || {
          pubkeys: [],
        };
        relay.pubkeys.push(pubkey);
        if (!relay.fetched || relay.fetched > author.fetched)
          relay.fetched = author.fetched;
        relays.set(r, relay);
      }
    }
    console.log(Date.now(), "relays", relays.size);

    // for each relay, fetch using batches of pubkeys,
    // do that in parallel to save latency
    const results = [];
    const promises = [];
    for (const [url, relay] of relays.entries()) {
      promises.push(
        new Promise(async (ok) => {
          let authPolicy = undefined;
          let aborted = false;
          const authPromise = new Promise((onAuth) => {
            authPolicy = (r) => {
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
              await r.connect(1000);
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

async function getDeployed(prisma) {
  return (
    await prisma.domain.findMany({
      where: {
        status: STATUS_DEPLOYED,
      },
    })
  )
    .filter((d) => {
      try {
        const { type, data } = nip19.decode(d.site);
        if (type !== "naddr") throw new Error("Bad site addr type");
        d.addr = data;
        return true;
      } catch (e) {
        console.warn("Invalid site ", d.site, "domain", d.domain, e);
        return false;
      }
    })
    .filter((d) => !!d.addr);
}

async function ssrWatch() {
  const prisma = new PrismaClient();

  const ndk = new NDK({
    explicitRelayUrls: [SITE_RELAY],
    blacklistRelayUrls: BLACKLISTED_RELAYS,
  });
  ndk.connect().catch((e) => console.log("connect error", e));

  const sites = new Map();
  const events = new Map();
  const eventSync = new EventSync(ndk);

  // buffer for relay delays
  const SYNC_BUFFER_SEC = 60; // 1 minute

  let last_site_tm = 0;
  while (true) {
    // list of deployed sites, all the rest are ignored
    const deployed = await getDeployed(prisma);
    console.log("deployed", deployed.length);

    const getDomain = (addr) => {
      return deployed.find(
        (d) =>
          d.addr.identifier === addr.identifier && d.addr.pubkey === addr.pubkey
      );
    };

    const tm = Math.floor(Date.now() / 1000);

    // sites are fetched from a single dedicated relay,
    // for each site we check last rerender time, and if it's > event.created_at then
    // we don't do full re-render
    const newSites = await fetchRelayFilterSince(
      ndk,
      SITE_RELAYS,
      { kinds: [KIND_SITE] },
      last_site_tm,
      // timeout
      [new Promise((ok) => setTimeout(ok, 30000))]
    );
    last_site_tm = Math.floor(Date.now() / 1000) - SYNC_BUFFER_SEC;

    const rerender = async (domain, updated) => {
      await prisma.domain.update({
        where: { domain },
        data: { updated },
      });
    };

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
      if (d.rendered >= s.created_at) {
        console.log("site event already rendered", s.rawEvent());
      } else {
        console.log("schedule rerender", s.rawEvent());
        await rerender(d.domain, s.created_at);
        // await prisma.domain.update({
        //   where: { domain: d.domain },
        //   data: { updated: s.created_at },
        // });
      }

      const naddr = nip19.naddrEncode(s.addr);
      const wasSite = sites.get(naddr);
      if (wasSite && wasSite.created_at >= s.created_at) {
        console.log("site event already subscribed", s.rawEvent());
      } else {
        sites.set(naddr, s);
        eventSync.addSite(naddr, s, wasSite, d.fetched);
      }
    }

    // let event syncer do it's job
    const fetchedTm = Math.floor(Date.now() / 1000) - SYNC_BUFFER_SEC;
    const newEvents = await eventSync.process();
    for (const e of newEvents) {
      const id = eventId(e);
      const existing = events.get(id);
      if (!existing || existing.created_at < e.created_at) {
        events.set(id, e);

        const siteNaddrs = eventSync.getAuthorSites(e.pubkey);
        console.log("scheduling new event", id, "sites", siteNaddrs.length);
        for (const naddr of siteNaddrs) {
          const s = sites.get(naddr);
          const d = getDomain(s.addr);

          // full rerender for changed pins
          if (e.kind === KIND_PINNED_TO_SITE) {
            const d_tag = `${KIND_SITE}:${s.addr.pubkey}:${s.addr.identifier}`
            if (tv(e, 'd') !== d_tag) {
              console.log("rerender of pins skip for", d.domain);
              continue;
            }
            console.log(
              "scheduling rerender for changed pins",
              d.domain,
              e.rawEvent()
            );
            // FIXME check '#s' and only rerender target sites!
            await rerender(d.domain, e.created_at);
            continue;
          }

          // load to check if event matches our filters
          if (!s.store) {
            const url = tv(s, "r");
            const parser = new NostrParser(url);
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
          await prisma.eventQueue.create({
            data: {
              domain: d.domain,
              eventId: id,
              timestamp: Date.now(),
            },
          });
        }
      }
    }

    // mark all existing sites
    const ec = await prisma.domain.updateMany({
      where: {
        status: STATUS_DEPLOYED,
        fetched: {
          gt: 0,
        },
      },
      data: {
        fetched: fetchedTm,
      },
    });
    // mark all new sites, there shouldn't be too many
    const nc = await prisma.domain.updateMany({
      where: {
        status: STATUS_DEPLOYED,
        fetched: 0,
        domain: {
          in: deployed.filter((d) => !d.fetched).map((d) => d.domain),
        },
      },
      data: {
        fetched: fetchedTm,
      },
    });
    console.log("fetched counts", ec, nc);

    const passed = Date.now() / 1000 - tm;
    const pause = passed < 10 ? 10 : 0;
    console.log("updated last_tm", tm, "pause", pause);
    await new Promise((ok) => setTimeout(ok, pause * 1000));
  }
}

async function ssrRender() {
  const prisma = new PrismaClient();

  const process = async (d, full = false) => {
    const render = async (paths) => {
      const addr = parseAddr(d.site);
      const naddr = nip19.naddrEncode({
        identifier: addr.identifier,
        pubkey: addr.pubkey,
        kind: KIND_SITE,
        relays: [SITE_RELAY],
      });
      console.log("rendering", d.domain, naddr, "paths", paths.length);
      await spawn("release_website_zip", [
        naddr,
        "domain:" + d.domain,
        ...paths,
      ]);

      //        await releaseWebsite(naddr, paths);
    };

    // full rerender?
    if (full && d.updated >= d.rendered) {
      // get current last eventQueue.id,
      // then after we're done remove all events
      // scheduled for this site w/ id <= last_id

      const lastEvent = await prisma.eventQueue.findFirst({
        where: {
          domain: d.domain,
        },
        orderBy: [
          {
            id: "desc",
          },
        ],
      });

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
        await prisma.eventQueue.deleteMany({
          where: {
            domain: d.domain,
            id: {
              lte: lastEvent.id,
            },
          },
        });
      }

      // mark as rendered
      await prisma.domain.update({
        where: { domain: d.domain },
        data: { rendered: tm },
      });
    } else {
      // fetch events from queue
      const events = await prisma.eventQueue.findMany({
        where: {
          domain: d.domain,
        },
      });

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
        await prisma.eventQueue.deleteMany({
          where: {
            domain: d.domain,
            id: {
              lte: lastId,
            },
          },
        });
      }
    }
  };

  while (true) {
    const sites = await getDeployed(prisma);

    // find a site for full re-render, start with oldest ones
    const rerender = sites
      .filter((d) => d.updated >= d.rendered)
      .sort((a, b) => Number(b.updated) - Number(a.updated))
      .shift();

    // find an updated site
    const event = await prisma.eventQueue.findFirst();
    if (event) {
      const site = sites.find((s) => s.domain === event.domain);
      if (site) {
        console.log(new Date(), Date.now(), "ssr new posts", event.domain);
        await process(site);
      } else {
        console.error("No site for queue event", event);
        // must delete it otherwise we'll get stuck on it
        await prisma.eventQueue.delete({
          where: {
            id: event.id,
          },
        });
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

async function testPrepareSite(pubkey, kinds, hashtags) {
  const ndk = new NDK();
  ndk.connect();

  const site = await prepareSite(ndk, pubkey, {
    kinds,
    hashtags,
  });
  console.log("site", site);
}

function testRGB(str) {
  console.log(
    "str",
    str,
    "rgb",
    toRGBString(str, {
      hue: [0, 360],
      sat: [50, 100],
      lit: [25, 75],
    })
  );
}

async function getThemeByName(name, ndk = null) {
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
  pubkey,
  kinds,
  hashtags,
  themeId,
  domain,
  d_tag = ""
) {
  await ensureAuth();

  const adminPubkey = (await signer.user()).pubkey;

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
  site.tags = site.tags.filter((t) => t.length < 2 || t[0] !== "d");
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
  const reply = await fetchWithSession(
    `${NPUB_PRO_API}/reserve?domain=${requestedDomain}&site=${naddrDomain}`
  );
  console.log(Date.now(), "got domain", reply);

  const subdomain = reply.domain.split("." + NPUB_PRO_DOMAIN)[0];
  console.log("received domain", subdomain);
  const origin = `https://${reply.domain}/`;
  site.tags.push(["r", origin]);

  // now we're ready
  console.log("final site event", site);

  const siteEvent = new NDKEvent(ndk, site);
  await siteEvent.sign(signer);

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

async function deploySite(domain, naddr) {
  // await ensureAuth();

  // const adminPubkey = (await signer.user()).pubkey;
  const deployReply = await fetchWithSession(
    `${NPUB_PRO_API}/deploy?domain=${domain}&site=${naddr}`
  );
  console.log(Date.now(), "deployed", deployReply);
}

async function reserveSite(domain, naddr, noRetry) {
  // await ensureAuth();

  // const adminPubkey = (await signer.user()).pubkey;
  const reply = await fetchWithSession(
    `${NPUB_PRO_API}/reserve?domain=${domain}&site=${naddr}&no_retry=${noRetry}`
  );
  console.log(Date.now(), "reserved", reply);
}

async function deleteSiteCall(domain, naddr) {
  // await ensureAuth();

  // const adminPubkey = (await signer.user()).pubkey;
  const deleteReply = await fetchWithSession(
    `${NPUB_PRO_API}/delete?domain=${domain}&site=${naddr}`
  );
  console.log(Date.now(), "delete", deleteReply);
}

function getSessionCipher() {
  const keyHex = process.env.API_SESSION_KEY;
  if (keyHex.length !== 64) throw new Error("No session key");
  const key = hexToBytes(keyHex);
  return managedNonce(xchacha20poly1305)(key); // manages nonces for you
}

function createSessionToken(pubkey) {
  if (pubkey.length !== 64) throw new Error("Bad pubkey");
  const cipher = getSessionCipher();
  const payload = JSON.stringify([pubkey, Math.floor(Date.now() / 1000)]);
  const data = utf8ToBytes(payload);
  const ciphertext = cipher.encrypt(data);
  return Buffer.from(ciphertext).toString("base64");
}

function parseSessionToken(token) {
  if (!token || token.length < 10) return undefined;
  try {
    const bytes = Buffer.from(token, "base64");
    const cipher = getSessionCipher();
    const payload = cipher.decrypt(bytes);
    const data = JSON.parse(Buffer.from(payload).toString("utf-8"));
    if (
      Array.isArray(data) &&
      data.length >= 2 &&
      data[0].length === 64 &&
      data[1] > 0
    ) {
      return {
        pubkey: data[0],
        timestamp: data[1],
      };
    }
  } catch (e) {
    console.log("bad session token", token, e);
  }
  return undefined;
}

async function reservePubkeyDomain(pubkey, domain, months = 3) {
  const s3 = new S3Client({ region: AWSRegion });
  const prisma = new PrismaClient();

  if (!domain) {
    console.log("choosing domain");
    const ndk = new NDK({
      explicitRelayUrls: OUTBOX_RELAYS,
    });
    ndk.connect();
    const profile = await fetchProfile(ndk, pubkey);
    if (!profile) throw new Error("No profile for " + pubkey);

    const slug = getProfileSlug(profile);
    console.log("slug", slug);
    if (!slug) throw new Error("No profile slug");
    if (slug.length === 1) throw new Error("Short slug");

    domain = slug;
  }
  console.log("reserving", domain, "for", pubkey, "months", months);

  const expires = Date.now() + months * 30 * 24 * 60 * 60 * 1000;
  domain = await reserve(undefined, pubkey, domain, expires, s3, prisma, true);
  console.log("reserved", domain, "for", pubkey);
}

async function spawn(cmd, args) {
  const child = childProcess.spawn("node", ["index.js", cmd, ...args]);
  child.stdout.on("data", (data) => {
    console.log(`stdout: ${data}`);
  });
  child.stderr.on("data", (data) => {
    console.error(`stderr: ${data}`);
  });
  return new Promise((ok) => {
    child.on("close", (code) => {
      console.log(`child process exited with code ${code}`);
      ok(code);
    });
  });
}

async function updateTheme(siteId) {
  await ensureAuth();

  const pubkey = (await signer.user()).pubkey;

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
      kinds: [KIND_PACKAGE],
      ids: [themePackageId],
    },
    { groupable: false },
    NDKRelaySet.fromRelayUrls([SITE_RELAY], ndk)
  );

  const a = tv(pkg, "a");
  const aTag = parseATag(a);
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

  const e = tv(theme, "e");
  console.log("current theme", theme.id, "latest package", e);

  if (e === pkg.id) {
    console.log("already latest theme version");
    return;
  }

  const newPkg = await ndk.fetchEvent(
    {
      kinds: [KIND_PACKAGE],
      ids: [e],
    },
    { groupable: false },
    NDKRelaySet.fromRelayUrls([SITE_RELAY], ndk)
  );

  const title = tv(newPkg, "title") || "";
  const version = tv(newPkg, "version") || "";
  const name = title + (version ? " v." + version : "");

  event.tags = event.tags.filter((t) => t.length < 2 || t[0] !== "x");
  event.tags.push(["x", newPkg.id, SITE_RELAY, tv(newPkg, "x") || "", name]);

  await event.sign(signer);
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

async function testEvent() {
  const pubkey =
    "08eade50df51da4a42f5dc045e35b371902e06d6a805215bec3d72dc687ccb04";
  const event = {
    kind: 100000 + KIND_SITE,
    pubkey: "08eade50df51da4a42f5dc045e35b371902e06d6a805215bec3d72dc687ccb04",
    content: "",
    tags: [
      ["d", "test-site"],
      ["some", "tag"],
      ["u", pubkey],
    ],
  };
  const r = await fetchWithSession(
    "http://localhost:8000/site?relays=wss://relay.damus.io",
    "POST",
    event
  );
  console.log("r", r);
}

async function listBucketKeys(bucket, prefix, s3) {
  let keys = [];
  let token = undefined;
  do {
    const cmd = new ListObjectsV2Command({
      Bucket: bucket,
      MaxKeys: 1000,
      Prefix: prefix + "/",
      ContinuationToken: token,
    });
    const r = await s3.send(cmd);
    console.log("list bucket ", bucket, prefix, r.KeyCount, token);
    if (r.Contents) keys.push(...r.Contents.map((c) => c.Key));
    token = r.NextContinuationToken;
  } while (token);

  return keys;
}

async function resyncLocalDb() {
  const s3 = new S3Client({ region: AWSRegion });
  const prisma = new PrismaClient();

  const keys = await listBucketKeys(DOMAINS_BUCKET, undefined, s3);
  // let keys = [];
  // let token = undefined;
  // do {
  //   const cmd = new ListObjectsV2Command({
  //     Bucket: DOMAINS_BUCKET,
  //     MaxKeys: 1000,
  //     ContinuationToken: token,
  //   });
  //   const r = await s3.send(cmd);
  //   console.log("r", r.KeyCount, token);
  //   keys.push(...r.Contents.map((c) => c.Key));
  //   token = r.NextContinuationToken;
  // } while (token);
  console.log("keys", keys);

  for (const key of keys) {
    const domain = key.split("/").pop().split(".json")[0];
    if (!domain) continue;
    console.log("domain", domain);
    const info = await fetchDomainInfo(domain, s3, false);
    if (!info) throw new Error("Failed to fetch info for " + domain);
    await upsertDomainInfo(prisma, info);
  }

  console.log("done");
}

async function changeWebsiteUser(naddr, pubkey) {
  await ensureAuth();

  const userPubkey = (await signer.user()).pubkey;
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

  await event.sign(signer);
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

async function testDefaultIpRoute() {
  return new Promise((ok, err) => {
    childProcess.exec(
      "ip route show | awk '/default/ {print $3}'",
      (error, stdout, stderr) => {
        if (error) {
          // node couldn't execute the command
          console.log(`stderr: ${stderr}`);
          err(error);
        } else {
          // the *entire* stdout and stderr (buffered)
          const ip = stdout.trim();
          console.log(`stdout: "${ip}"`);
          ok(ip);
        }
      }
    );
  });
}

async function testLB() {
  const client = new ElasticLoadBalancingV2Client({ region: AWSEdgeRegion });
  const command = new DescribeListenersCommand({
    // LoadBalancerNames: ["TestEC2"]
    LoadBalancerArn:
      "arn:aws:elasticloadbalancing:us-east-1:945458476897:loadbalancer/app/TestEC2/f1119f64affd9926",
  });
  const response = await client.send(command);
  console.log("response", response);
}

async function testBlossomUpload(server, path) {
  await ensureAuth();

  const { BlossomClient } = await import("blossom-client-sdk/client");

  const name = path.split("/").pop();
  const content = await prepareContentBuffer(path);
  const file = new File([toArrayBuffer(content)], name);

  const mime = getMime(name);
  const hash = await BlossomClient.getFileSha256(file);
  console.log(path, "processing", hash);

  const pubkey = (await signer.user()).pubkey;
  const signEvent = makeSignEvent(pubkey);

  const getAuth = await BlossomClient.getGetAuth(signEvent);
  const uploadAuth = await BlossomClient.getUploadAuth(file, signEvent);

  console.log(path, "checking server", server);
  const uploaded = await checkBlossomFile({
    path,
    BlossomClient,
    server,
    hash,
    getAuth,
    debug: true,
  });
  console.log("uploaded", uploaded);

  const r = await uploadBlossomFile({
    path,
    BlossomClient,
    server,
    file,
    mime,
    uploadAuth,
    hash,
  });
  console.log("result", r);
}

async function createZapSplit({ siteId, pubkey: targetPubkey, ndk }) {
  await ensureAuth();

  const pubkey = (await signer.user()).pubkey;

  ndk =
    ndk ||
    new NDK({
      explicitRelayUrls: DEFAULT_RELAYS,
    });
  await ndk.connect();

  const siteNames = [];
  const addSite = (s) => {
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
    if (!site) return;

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

  const receivers = {};
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
    let info = undefined;
    try {
      info = JSON.parse(profile.content);
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

  await event.sign(signer);
  console.log("signed", event.rawEvent());

  const inboxRelays = await fetchInboxRelays(ndk, [targetPubkey]);
  console.log("inbox relays", targetPubkey, inboxRelays);

  const r = await event.publish(
    NDKRelaySet.fromRelayUrls([...DEFAULT_RELAYS, inboxRelays], ndk)
  );
  console.log("published to ", r.size);

  return event.id;
}

async function sendDM(type, targetPubkey) {
  await ensureAuth();

  const pubkey = (await signer.user()).pubkey;

  const ndk = new NDK({
    explicitRelayUrls: DEFAULT_RELAYS,
  });
  await ndk.connect();

FIXME add unsubscribers.txt!!!

  let message = "";
  if (type === "value4value") {
    const zapSplitId = await createZapSplit({ pubkey: targetPubkey, ndk });
    const nevent = nip19.neventEncode({ id: zapSplitId, relays: DEFAULT_RELAYS });
    // convert the last char to percent-encoded version to make sure clients don't try to
    // convert this nevent string into an event preview (nostrudel wtf??)
    const neventParam = nevent.slice(0, nevent.length - 1) + "%" + nevent.charCodeAt(nevent.length - 1).toString(16)
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

    message = `Hello!\n\n
Looks like you've been using Npub.pro for a while, and we are very happy to serve you!\n\n
Our website publishing tools are free to use, but not free to create and improve. If you find them valuable, consider supporting us in the spirit of #Value4Value.\n\n
Here is a convenient link with a zap-split, directing 50% of your tips to several contributors that made your websites work: https://zapper.fun/zap?id=${neventParam}\n\n
${updates}
Thank you for your support!\n\n
- Npub.pro team.
(If you don't like this message, please reply and let us know)\n\n
`;
  } else if (type === "use_blog") {
    message = `Hello!\n
Thank you for being an early adopter of npub.pro!\n
We think the best way to learn new tools is to follow the early adopters. There is an infinite number of ways to use a nostr-website, and YOU can help others figure out the possibilities and best practices.\n
Would you be interested in writing a long-form article about your experience with npub.pro? Why did you create your site? How are you using it? What you love, and what's missing?\n
We are happy to zap you and will cross-post your article on our blog and share it with our community. Your story might inspire others to start their content creation journey!\n
If you’re interested or have any questions feel free to reach out. We’d love to hear from you!\n
Best regards,
Npub.pro Team\n
(If you don't like this message, please reply and let us know)\n\n
`;
  }

  const dm = new NDKEvent(ndk, {
    kind: 4,
    pubkey: pubkey,
    created_at: Math.floor(Date.now() / 1000),
    content: await signer.encrypt(new NDKUser({ pubkey: targetPubkey }), message),
    tags: [["p", targetPubkey]],
  });

  await dm.sign(signer);
  console.log("signed dm", dm.rawEvent());

  const inboxRelays = await fetchInboxRelays(ndk, [targetPubkey]);
  console.log("inbox relays", targetPubkey, inboxRelays);

  const r = await dm.publish(
    NDKRelaySet.fromRelayUrls([...DEFAULT_RELAYS, inboxRelays], ndk)
  );
  console.log("published to ", r.size);
}

// main
try {
  console.log(process.argv);
  const method = process.argv[2];
  if (method.startsWith("publish_theme")) {
    const dir = process.argv[3];
    const latest = method.includes("latest");
    const reupload = method.includes("reupload");
    const includeFonts = method.includes("include_fonts");
    publishTheme(dir, {
      latest,
      reupload,
      includeFonts,
    }).then(() => process.exit());
  } else if (method === "create_website") {
    const dist = process.argv[3];
    const naddr = process.argv[4];
    const dir = process.argv[5];
    createWebsite(dist, naddr, dir).then(() => process.exit());
  } else if (method === "upload_website") {
    const dir = process.argv[3];
    const domain = process.argv[4];
    uploadWebsite(dir, domain).then(() => process.exit());
  } else if (method === "render_website") {
    const dir = process.argv[3];
    const naddr = process.argv[4];
    const limit =
      process.argv.length > 5 ? parseInt(process.argv[5]) : undefined;
    renderWebsite(dir, naddr, limit).then(() => process.exit());
  } else if (method.startsWith("release_website")) {
    const naddr = process.argv[3];
    const zip = method.includes("zip");
    const preview = method.includes("preview");
    let paths = [];
    let domain = undefined;
    for (let i = 4; i < process.argv.length; i++) {
      if (process.argv[i].startsWith("domain:")) {
        domain = process.argv[i].split("domain:")[1];
      } else {
        paths.push(process.argv[i]);
      }
    }
    if (paths.length === 1 && !paths[0].startsWith("/"))
      paths = parseInt(paths[0]);
    releaseWebsite(naddr, paths, { zip, preview, domain }).then(() =>
      process.exit()
    );
  } else if (method === "test_upload_aws") {
    uploadAWS().then(process.exit());
  } else if (method === "api") {
    const host = process.argv[3];
    const port = parseInt(process.argv[4]);
    api(host, port);
  } else if (method === "ssr_watch") {
    ssrWatch().catch((e) => {
      console.log("error", e);
      throw e;
    });
  } else if (method === "ssr_render") {
    ssrRender();
  } else if (method === "publish_site_event") {
    const pubkey = process.argv[3];
    const kinds = process.argv[4].split(",").map((k) => parseInt(k));
    const hashtags = process.argv[5].split(",").filter((k) => k.trim() !== "");
    const themeId = process.argv[6];
    const domain = process.argv?.[7] || "";
    const d_tag = process.argv?.[8] || "";
    publishSiteEvent(pubkey, kinds, hashtags, themeId, domain, d_tag).then(() =>
      process.exit()
    );
  } else if (method === "deploy_site") {
    const domain = process.argv[3];
    const naddr = process.argv[4];
    deploySite(domain, naddr).then(() => process.exit());
  } else if (method === "delete_site") {
    const domain = process.argv[3];
    const naddr = process.argv[4];
    deleteSiteCall(domain, naddr).then(() => process.exit());
  } else if (method.startsWith("reserve_site")) {
    const domain = process.argv[3];
    const naddr = process.argv[4];
    const noRetry = method.includes("no_retry");
    reserveSite(domain, naddr, noRetry).then(() => process.exit());
  } else if (method === "test_aws") {
    testAWS();
  } else if (method === "test_bundle") {
    // first scan assets folder, find all filenames
    const dir = process.argv[3];
    testBundle(dir);
  } else if (method === "test_render") {
    testRender();
  } else if (method === "test_deploy") {
    const pubkey = process.argv[3];
    const kinds = process.argv[4].split(",").filter((k) => k.trim() !== "");
    const hashtags = process.argv[5].split(",").filter((k) => k.trim() !== "");
    const theme = process.argv[6];
    testDeploy(pubkey, kinds, hashtags, theme);
  } else if (method === "test_prepare_site") {
    const pubkey = process.argv[3];
    const kinds = (process.argv[4] || "").split(",").map((k) => parseInt(k));
    const hashtags = (process.argv[5] || "")
      .split(",")
      .filter((k) => k.trim() !== "");
    testPrepareSite(pubkey, kinds, hashtags);
  } else if (method === "test_rgb") {
    const str = process.argv[3];
    testRGB(str);
  } else if (method === "generate_key") {
    console.log(bytesToHex(randomBytes(32)));
  } else if (method === "test_session_token") {
    const pubkey = process.argv[3];
    const token = createSessionToken(pubkey);
    console.log("token: ", token);
    const data = parseSessionToken(token);
    console.log("data", data);
  } else if (method === "get_session_token") {
    getSessionToken();
  } else if (method === "get_admin_session_token") {
    const pubkey = process.argv[3];
    getAdminSessionToken(pubkey);
  } else if (method === "theme_by_name") {
    const name = process.argv[3];
    getThemeByName(name);
  } else if (method === "reserve_pubkey_domain") {
    const pubkey = process.argv[3];
    const domain = process.argv?.[4] || "";
    const months = process.argv?.[5] || 3;
    console.log(pubkey, domain, months);
    reservePubkeyDomain(pubkey, domain, months).then(() => process.exit());
  } else if (method === "test_spawn") {
    spawn("release_website", [
      "naddr1qqrksmmyd33x7eqpzamhxue69uhhyetvv9ujumnsw438qun09e3k7mgzyqyw4hjsmaga5jjz7hwqgh34kdceqtsx665q2g2mas7h9hrg0n9sgqcyqqq8wvqkuxchf",
      "/",
    ]).then(() => process.exit());
  } else if (method === "zip_dir") {
    const dir = process.argv[3];
    const path = process.argv[4];
    zipSiteDir(dir, path).then(() => process.exit());
  } else if (method === "check_domain") {
    const domain = process.argv[3];
    const site = process.argv[4];
    (async () => {
      const reply = await fetchWithSession(
        `${NPUB_PRO_API}/check?domain=${domain}&site=${site}`
      );
      console.log(reply);
    })().then(() => process.exit());
  } else if (method === "update_theme") {
    const siteId = process.argv[3];
    updateTheme(siteId).then(() => process.exit());
  } else if (method === "change_website_user") {
    const siteId = process.argv[3];
    const pubkey = process.argv[4];
    changeWebsiteUser(siteId, pubkey).then(() => process.exit());
  } else if (method === "generate_otp") {
    console.log("otp", generateOTP());
  } else if (method === "test_event") {
    testEvent();
  } else if (method === "resync_local_db") {
    resyncLocalDb();
  } else if (method === "naddr") {
    console.log(
      nip19.naddrEncode({
        kind: Number(process.argv[3]),
        pubkey: process.argv[4],
        identifier: process.argv[3],
      })
    );
  } else if (method === "delete_domain_files") {
    const domain = process.argv[3];
    deleteDomainFiles(domain).then(() => process.exit());
  } else if (method === "test_default_ip_route") {
    testDefaultIpRoute();
  } else if (method === "test_lb") {
    testLB();
  } else if (method === "blossom_upload") {
    const server = process.argv[3];
    const path = process.argv[4];
    testBlossomUpload(server, path);
  } else if (method === "create_zap_split") {
    const pubkeyOrSiteId = process.argv[3];
    createZapSplit({
      siteId: pubkeyOrSiteId.startsWith("naddr") ? pubkeyOrSiteId : undefined,
      pubkey: pubkeyOrSiteId.startsWith("naddr") ? undefined : pubkeyOrSiteId,
    }).then(() => process.exit());
  } else if (method === "send_dm") {
    const type = process.argv[3];
    const pubkey = process.argv[4];
    sendDM(type, pubkey).then(() => process.exit());
  } else if (method === "dns_nocache") {
    const domain = process.argv[3];
    const type = process.argv[4];
    dnsResolveNoCache(domain, type);
  } else if (method === "outbox_relays") {
    const pubkey = process.argv[3];
    const ndk = new NDK({
      //  explicitRelayUrls: [...OUTBOX_RELAYS],
    });
    ndk.connect();
    await fetchOutboxRelays(ndk, [pubkey]);
    // const e = await ndk.fetchEvents(
    //   {
    //     // @ts-ignore
    //     kinds: [KIND_CONTACTS, KIND_RELAYS],
    //     authors: [pubkey],
    //   },
    //   {
    //     closeOnEose: true,
    //     groupable: false,
    //   },
    //   NDKRelaySet.fromRelayUrls(OUTBOX_RELAYS, ndk)
    // );
    // console.log("fetched", e.size);
  }
} catch (e) {
  console.error(e);
}
