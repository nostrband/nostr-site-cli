import os from "os";
import fs from "fs";
import readline from "node:readline";
import NDK, { NDKNip46Signer, NDKPrivateKeySigner } from "@nostr-dev-kit/ndk";
import { generatePrivateKey, nip19 } from "nostr-tools";
import { createNip98AuthEvent } from "../nostr";

export const cliHomedir = os.homedir();

export let cliNdk: NDK;
export let cliSigner: NDKNip46Signer;
export let cliPubkey: string;

// make sure current user is authed
export async function ensureAuth() {
  const file = cliHomedir + "/.nostr-site-cli.json";
  try {
    const info = JSON.parse(fs.readFileSync(file, "utf8"));
    if (info.pubkey && info.nsec && info.relays) {
      const { type, data: privkey } = nip19.decode(info.nsec);
      if (type !== "nsec" || typeof privkey !== "string")
        throw new Error("Invalid nsec");
      console.log("authing as", info.pubkey);
      cliNdk = new NDK({
        explicitRelayUrls: info.relays,
      });
      await cliNdk.connect();
      console.log("connected to relays", info.relays);

      cliSigner = new NDKNip46Signer(
        cliNdk,
        info.pubkey,
        new NDKPrivateKeySigner(privkey)
      );
      // if connect is blocked then we must re-auth
      await Promise.race([
        cliSigner.blockUntilReady(),
        new Promise((_, err) => cliSigner.once("authUrl", () => err())),
      ]);

      cliPubkey = info.pubkey;
      console.log("authed as", cliPubkey);

      cliSigner.on("authUrl", (url) =>
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
  const bunkerUrl = await new Promise<string>((ok) =>
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
  const secret = url.searchParams.get("secret") || undefined;
  const relays = [url.searchParams.get("relay") || "wss://relay.nsec.app"];
  console.log("info", { pubkey, secret, relays });

  cliNdk = new NDK({
    explicitRelayUrls: relays,
  });
  await cliNdk.connect();
  console.log("connected to relays", relays);

  const privkey = generatePrivateKey();
  cliSigner = new NDKNip46Signer(
    cliNdk,
    pubkey,
    new NDKPrivateKeySigner(privkey)
  );
  cliSigner.token = secret;
  cliSigner.on("authUrl", (url) =>
    console.log("Open this url and confirm: ", url)
  );

  await cliSigner.blockUntilReady();

  console.log("authed as", pubkey);

  const info = {
    pubkey,
    nsec: nip19.nsecEncode(privkey),
    relays,
  };
  fs.writeFileSync(file, JSON.stringify(info));
}

export async function fetchAuthed({
  ndk,
  url,
  method = "GET",
  body,
  pow = 0,
}: {
  ndk: NDK;
  url: string;
  method?: string;
  body?: string;
  pow?: number;
}) {
  const authEvent = await createNip98AuthEvent(ndk, {
    pubkey: cliPubkey,
    signer: cliSigner,
    url,
    method,
    body,
    pow,
  });
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
