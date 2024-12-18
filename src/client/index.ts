import fs from "fs";
import NDK from "@nostr-dev-kit/ndk";
import {
  cliHomedir,
  cliPubkey,
  ensureAuth,
  fetchAuthed,
} from "../auth/cli-auth";
import { MIN_POW, NPUB_PRO_API } from "../common/const";
import { nip19 } from "nostr-tools";
import { createSessionToken } from "../auth/token";

export async function getSessionToken() {
  await ensureAuth();

  const pubkey = cliPubkey;
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
    const file = cliHomedir + "/.nostr-site-cli-token.json";
    fs.writeFileSync(file, token);
  }
}

export async function getAdminSessionToken(pubkey: string) {
  const token = createSessionToken(pubkey);
  const file = cliHomedir + "/.nostr-site-cli-token.json";
  fs.writeFileSync(file, token);
}

export async function fetchWithSession(
  url: string,
  method = "GET",
  body?: any
) {
  const file = cliHomedir + "/.nostr-site-cli-token.json";
  const token = fs.readFileSync(file);
  const headers: any = {
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

export async function reserveSite(
  domain: string,
  naddr: string,
  noRetry: boolean = false
) {
  const reply = await fetchWithSession(
    `${NPUB_PRO_API}/reserve?domain=${domain}&site=${naddr}&no_retry=${noRetry}`
  );
  console.log(Date.now(), "reserved", reply);
  return reply;
}

export async function deploySite(domain: string, naddr: string, apiUrl?: string) {
  const reply = await fetchWithSession(
    `${apiUrl || NPUB_PRO_API}/deploy?domain=${domain}&site=${naddr}`
  );
  console.log(Date.now(), "deployed", reply);
  return reply;
}

export async function checkDomain(domain: string, site: string) {
  const reply = await fetchWithSession(
    `${NPUB_PRO_API}/check?domain=${domain}&site=${site}`
  );
  console.log(Date.now(), "check", reply);
  return reply;
}
