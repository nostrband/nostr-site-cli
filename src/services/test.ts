import NDK, { NDKEvent, NDKRelaySet } from "@nostr-dev-kit/ndk";
import {
  KIND_PACKAGE,
  KIND_SITE,
  NostrSiteRenderer,
  OUTBOX_RELAYS,
  fetchOutboxRelays,
  parseAddr,
  tv,
  prepareSite,
  toRGBString,
  // @ts-ignore
} from "libnostrsite";
import fs from "fs";
import { bundleCss } from "../css";
import { cliNdk, cliPubkey, cliSigner, ensureAuth } from "../auth/cli-auth";
import { fetchProfile } from "../nostr";
import { getMime, slugify } from "../common/utils";
import { nip19 } from "nostr-tools";
import { deploySite, fetchWithSession, reserveSite } from "../client";
import { createSessionToken, parseSessionToken } from "../auth/token";
import { INDEX_URL } from "../common/const";
import { LB } from "../aws/lb";
import childProcess from "child_process";
import secrets from "secrets.js-grempe"
import { zipSiteDir } from "../zip";

function testSessionToken(pubkey: string) {
  const token = createSessionToken(pubkey);
  console.log("token: ", token);
  const data = parseSessionToken(token);
  console.log("data", data);
}

async function testOutboxRelays(pubkey: string) {
  const ndk = new NDK({
    //  explicitRelayUrls: [...OUTBOX_RELAYS],
  });
  ndk.connect();
  await fetchOutboxRelays(ndk, [pubkey]);
}

async function testBundle(dir: string) {
  const assetsDir = dir + "/assets/";

  const entries: string[] = [];
  const files = fs.readdirSync(assetsDir, {
    encoding: "utf8",
    recursive: true,
  });
  for (const file of files) {
    const stat = fs.statSync(assetsDir + "/" + file);
    if (!stat.isFile()) continue;
    entries.push(file);
  }

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

async function testCreateWebsite(dist: string, naddr: string, dir: string) {
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
  console.log("site", siteEvent!.rawEvent());
  const url = siteEvent!.tags.find((t) => t.length >= 2 && t[0] === "r")?.[1];
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
    icon.type = getMime(icon.src);
  }
  console.log("manifest", manifest);
  fs.writeFileSync(`${dir}/manifest.webmanifest`, JSON.stringify(manifest));

  console.log("done");
}

async function testRender() {
  // disable debug logging
  console.debug = () => {};

  const naddr =
    "naddr1qqxxzmr2v9ar5dnzxqmnwvcpzamhxue69uhhyetvv9ujumnsw438qun09e3k7mgzyrh7t5fqmuxv9y86wjrj076943y8e2kngm20y2f6kp573uqlc5vczqcyqqq8wvqk5ukxe";
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

async function testDeploy(pubkey: string, kinds: string[], hashtags: string[], themePackageId: string) {
  console.log(
    Date.now(),
    "test deploy",
    pubkey,
    kinds,
    hashtags,
    themePackageId
  );
  await ensureAuth();
  const signerPubkey = cliPubkey;
  console.log(Date.now(), "authed as", signerPubkey);

  const ndk = new NDK({
    explicitRelayUrls: [...OUTBOX_RELAYS],
  });
  ndk.connect();

  const theme = await ndk.fetchEvent(
    {
      ids: [themePackageId],
      // @ts-ignore
      kinds: [KIND_PACKAGE],
    },
    { groupable: false },
    NDKRelaySet.fromRelayUrls(["wss://relay.nostr.band"], ndk)
  );
  if (!theme) throw new Error("No theme");

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
    pubkey: cliPubkey,
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

  siteEvent.tags.push(["x", theme.id, theme.relay!.url, themeHash, themeName]);

  const naddrDomain = nip19.naddrEncode({
    identifier: requestedDomain,
    kind: KIND_SITE,
    pubkey: signerPubkey,
  });
  console.log("naddrDomain", naddrDomain);

  console.log("requesting domain", requestedDomain);

  // ask for sub-domain
  const reply = await reserveSite(requestedDomain, naddrDomain);
  console.log(Date.now(), "got domain", reply);

  siteEvent.tags.push(["r", `https://${reply.domain}/`]);

  console.log("site event", siteEvent);

  const ndkEvent = new NDKEvent(cliNdk, siteEvent);
  await ndkEvent.sign(cliSigner);
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

  const deployReply = await deploySite(reply.domain, naddr);
  console.log(Date.now(), "deployed", deployReply);
}

async function testPrepareSite(pubkey: string, kinds: number[], hashtags: string[]) {
  const ndk = new NDK();
  ndk.connect();

  const site = await prepareSite(ndk, pubkey, {
    kinds,
    hashtags,
  });
  console.log("site", site);
}

function testRGB(str: string) {
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
  const lb = new LB();
  return lb.describeListener(
    "arn:aws:elasticloadbalancing:us-east-1:945458476897:loadbalancer/app/TestEC2/f1119f64affd9926"
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

async function testSSS() {
  // generate a 512-bit key
  var key = secrets.random(256); // => key is a hex string
  console.log("key", key);

  // split into 10 shares with a threshold of 5
  var shares = secrets.share(key, 3, 2);
  console.log("shares", shares);
  // => shares = ['801xxx...xxx','802xxx...xxx','803xxx...xxx','804xxx...xxx','805xxx...xxx']

  // combine 4 shares
  var comb = secrets.combine(shares.slice(0, 2));
  console.log(comb === key); // => false

  // combine 5 shares
  comb = secrets.combine(shares.slice(0, 3));
  console.log(comb === key); // => true

  // combine ALL shares
  comb = secrets.combine(shares);
  console.log(comb === key); // => true

  // create another share with id 8
  var newShare = secrets.newShare(1, shares); // => newShare = '808xxx...xxx'
  console.log("newShare", newShare);

  // reconstruct using 4 original shares and the new share:
  const newShares = shares.slice(1, 3).concat(newShare);
  console.log("newShares", newShares);
  comb = secrets.combine(newShares);
  console.log(comb === key); // => true
}

export async function testMain(argv: string[]) {
  console.log("test", argv);

  const method = argv[0];
  console.log("method", method);
  if (method === "bundle") {
    // first scan assets folder, find all filenames
    const dir = argv[1];
    return testBundle(dir);
  } else if (method === "render") {
    return testRender();
  } else if (method === "deploy") {
    const pubkey = argv[1];
    const kinds = argv[2].split(",").filter((k) => k.trim() !== "");
    const hashtags = argv[3].split(",").filter((k) => k.trim() !== "");
    const theme = argv[4];
    return testDeploy(pubkey, kinds, hashtags, theme);
  } else if (method === "prepare_site") {
    const pubkey = argv[1];
    const kinds = (argv[2] || "").split(",").map((k) => parseInt(k));
    const hashtags = (argv[3] || "").split(",").filter((k) => k.trim() !== "");
    return testPrepareSite(pubkey, kinds, hashtags);
  } else if (method === "rgb") {
    const str = argv[1];
    return testRGB(str);
  } else if (method === "session_token") {
    const pubkey = argv[1];
    return testSessionToken(pubkey);
  } else if (method === "zip_dir") {
    const dir = argv[1];
    const path = argv[2];
    return zipSiteDir(dir, path);
  } else if (method === "event") {
    return testEvent();
  } else if (method === "default_ip_route") {
    return testDefaultIpRoute();
  } else if (method === "lb") {
    return testLB();
  } else if (method === "outbox_relays") {
    const pubkey = argv[1];
    return testOutboxRelays(pubkey);
  } else if (method === "sss") {
    testSSS();
  } else if (method === "create_website") {
    const dist = argv[1];
    const naddr = argv[2];
    const dir = argv[3];
    return testCreateWebsite(dist, naddr, dir);
  }
}
