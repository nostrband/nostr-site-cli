import http from "http";
import {
  createSessionToken,
  generateOTP,
  parseSessionToken,
} from "../auth/token";
import {
  AWS_GLOBAL_ACCEL_IPS,
  CUSTOM_BUCKET,
  DOMAINS_PERIOD,
  KIND_DELETE,
  MAX_DOMAINS_PER_IP,
  MIN_POW,
  OTP_TTL,
  OUTBOX_RELAYS,
  POW_PERIOD,
  SESSION_TTL,
  STATUS_DEPLOYED,
  STATUS_RELEASED,
  STATUS_RESERVED,
} from "../common/const";
import {
  fetchProfile,
  parseNaddr,
  publishEvent,
  publishSiteDeleteEvent,
  sendOTP,
  signEvent,
  verifyNip98AuthEvent,
} from "../nostr";
import { Cert, SiteInfo, ValidSiteInfo } from "../common/types";
import { AddressPointer } from "nostr-tools/lib/types/nip19";
import { S3 } from "../aws/s3";
import { DB } from "../db";
import { dnsResolveNoCache, spawnService } from "../common/utils";
import NDK from "@nostr-dev-kit/ndk";
import { Event, getPublicKey, nip19 } from "nostr-tools";
import { getServerKey } from "../auth/ser-auth";
import { AsyncMutex } from "../common/async-mutex";
import { ACM, ACMCert } from "../aws/acm";
import { CF, CreatedDistribution } from "../aws/cf";
import { LB } from "../aws/lb";
// @ts-ignore
import { fetchInboxRelays, tv, KIND_SITE, getProfileSlug } from "libnostrsite";

async function sendReply(
  res: http.ServerResponse,
  reply: any,
  status: number = 0
) {
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

function getReqUrl(req: http.IncomingMessage) {
  if (!req.url) throw new Error("No req url");
  return new URL(req.url, "http://localhost");
  //  return "https://" + req.headers["host"] + req.url;
}

async function sendError(
  res: http.ServerResponse,
  msg: string,
  status: number
) {
  console.error("error", msg);
  sendReply(res, { error: msg }, status);
}

function parseSession(req: http.IncomingMessage) {
  const token = (req.headers["x-npubpro-token"] as string) || "";
  const data = parseSessionToken(token);
  console.log("token", token, "data", data);
  if (!data) return undefined;
  if (Date.now() / 1000 - data.timestamp > SESSION_TTL) return undefined;
  return data.pubkey;
}

function canReserve(
  domain: string,
  admin: string,
  addr: AddressPointer | undefined,
  info: SiteInfo
) {
  if (!info.site) throw new Error("No site to reserve");

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

function isValidDomain(d: string) {
  return (
    d.match(/^[a-z0-9][a-z0-9-]+[a-z0-9]$/) || d.match(/^[a-z0-9][a-z0-9]$/)
  );
}

function getIp(req: http.IncomingMessage) {
  // @ts-ignore
  // FIXME only check x-real-ip if real ip is our nginx!
  return req.headers["x-real-ip"] || req.socket.address().address;
}

function isOwner(
  domain: string,
  admin: string,
  addr: AddressPointer,
  info: ValidSiteInfo
) {
  const infoAddr = parseNaddr(info.site!);
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

async function readBody(req: http.IncomingMessage) {
  return Promise.race([
    new Promise<string>((ok) => {
      let d = "";
      req.on("data", (chunk) => (d += chunk));
      req.on("end", () => ok(d));
    }),
    new Promise<string>((_, err) =>
      setTimeout(() => err("Body read timeout"), 5000)
    ),
  ]);
}

class Api {
  private s3 = new S3();
  private acm = new ACM();
  private db = new DB();
  private cf = new CF();
  private lb = new LB();
  private mutex = new AsyncMutex();
  private ndk = new NDK({
    explicitRelayUrls: [...OUTBOX_RELAYS],
  });
  private ipPows = new Map();
  private ipDomains = new Map<string, { domains: number; tm: number }>();

  constructor() {
    this.ndk.connect();
  }

  private async reserve(
    site: string | undefined,
    admin: string,
    domain: string,
    expires: number,
    noRetry: boolean = false
  ) {
    const addr = site ? parseNaddr(site) : undefined;
    if (site && !addr) return "";

    let info = await this.s3.fetchDomainInfo(domain);
    console.log("existing info", info);

    if (info) {
      const available = canReserve(domain, admin, addr, info);
      if (!available) {
        if (!noRetry) {
          // try 3 times to append XX number
          for (let i = 0; i < 3; i++) {
            const n = Math.floor(Math.random() * 100);
            domain = `${domain}${n}`;
            console.log("trying new domain", domain);
            info = await this.s3.fetchDomainInfo(domain);
            if (!info) break;
          }
        }

        // could be reset after retries above
        if (info) throw new Error("Failed to assign domain");
      }
    }

    // not yet reserved for us?
    if (!info) {
      const data = await this.s3.putDomainInfo(
        { domain, site, pubkey: admin },
        STATUS_RESERVED,
        expires
      );
      console.log("reserved", domain, admin, site, data);
      info = data;
    }

    // ensure local copy of this domain
    await this.db.upsertDomainInfo(info);

    // the one we assigned
    return domain;
  }

  private getIpDomains(ip: string) {
    let { domains: lastDomains = 0, tm = 0 } = this.ipDomains.get(ip) || {};
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

  private getMinPow(ip: string) {
    let minPow = MIN_POW;

    // have a record for this ip?
    let { pow: lastPow = 0, tm = 0 } = this.ipPows.get(ip) || {};
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

  private async deleteSite(info: ValidSiteInfo) {
    // mark as released for several days
    const expires = Date.now() + 7 * 24 * 60 * 60 * 1000;
    const data = await this.s3.putDomainInfo(info, STATUS_RELEASED, expires);

    // ensure local copy of this domain
    await this.db.upsertDomainInfo(data);

    // delete files
    await this.s3.deleteDomainFiles(data.domain);

    return expires;
  }

  public async apiReserve(req: http.IncomingMessage, res: http.ServerResponse) {
    const admin = parseSession(req);
    if (!admin) return sendError(res, "Auth please", 401);

    const ip = getIp(req);
    const ipd = this.getIpDomains(ip);
    if (ipd > MAX_DOMAINS_PER_IP)
      return sendError(res, "Too many domains", 403);

    const url = getReqUrl(req);

    const domain = url.searchParams.get("domain");
    const site = url.searchParams.get("site");
    const noRetry = url.searchParams.get("no_retry") === "true";
    if (!domain || !site) return sendError(res, "Specify domain and site", 400);

    if (!isValidDomain(domain))
      return sendError(res, "Bad domain '" + domain + "'", 400);

    const expires = Date.now() + 3600000; // 1 hour
    const assignedDomain = await this.reserve(
      site,
      admin,
      domain,
      expires,
      noRetry
    );
    if (!assignedDomain) return sendError(res, "Bad site '" + site + "'", 400);

    // update counter for this ip
    this.ipDomains.set(ip, { domains: ipd, tm: Date.now() });

    sendReply(res, {
      domain: `${assignedDomain}.npub.pro`,
      site,
    });
  }

  /**
   *
   * @param {*} site* - site addr to be (re-)deployed
   * @param {*} domain - chosen domain, can be omitted for re-deploy
   * @param {*} from - optional domain to release if admin is the same
   * @returns
   */

  public async apiDeploy(req: http.IncomingMessage, res: http.ServerResponse) {
    const admin = parseSession(req);
    if (!admin) return sendError(res, "Auth please", 401);

    const url = getReqUrl(req);

    let domain = url.searchParams.get("domain")?.split(".npub.pro")[0];
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
      domain = await this.db.getSiteDomain(admin, addr);
      if (!domain) return sendError(res, "Site not found", 404);
    }

    // must be reserved before deploy
    const info = await this.s3.fetchDomainInfo(domain);
    if (!info) {
      return sendError(res, "Domain not reserved", 400);
    }

    // must be already reserved for this website
    if (!canReserve(domain, admin, addr, info))
      return sendError(res, "Wrong site", 400);

    // pre-render one page and publish
    await spawnService("cli", "release_website_zip_preview", [
      site,
      "20",
      "domain:" + domain,
    ]);

    // set the site
    info.site = site;

    const expires = 0;
    const data = await this.s3.putDomainInfo(info, STATUS_DEPLOYED, expires);

    // ensure local copy of this domain
    await this.db.upsertDomainInfo(data);

    // make old domain expire soon
    if (from && from !== domain) {
      const oldInfo = await this.s3.fetchDomainInfo(from);
      console.log("old info", oldInfo);
      if (oldInfo && oldInfo.pubkey === admin) {
        // delete the old deployment
        await this.deleteSite(oldInfo);
      }
    }

    sendReply(res, {
      status: STATUS_DEPLOYED,
      expires,
    });
  }

  private async deleteSiteEvent(
    res: http.ServerResponse,
    admin: string,
    site: string,
    id: string | null,
    relays: string[]
  ) {
    const key = getServerKey();
    const serverPubkey = getPublicKey(key);

    const addr = parseNaddr(site);
    if (!addr || addr.pubkey !== serverPubkey)
      return sendError(res, "Wrong event pubkey", 400);

    const existing = await this.db.getSite(addr.identifier);
    if (!existing || existing.pubkey !== admin)
      return sendError(res, "Not your site", 403);

    const ok = await publishSiteDeleteEvent(this.ndk, {
      addr,
      id,
      privkey: key,
      relays,
    });

    if (!ok) return sendError(res, "Failed to publish to relays", 400);

    // write to db after publishing
    await this.db.deleteSite(addr.identifier, admin);
  }

  /**
   *
   * @param {*} from* - old site addr
   * @param {*} to* - new site addr
   * @returns
   */
  public async apiMigrate(req: http.IncomingMessage, res: http.ServerResponse) {
    const admin = parseSession(req);
    if (!admin) return sendError(res, "Auth please", 401);

    const url = getReqUrl(req);

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

    const domain = await this.db.getSiteDomain(admin, fromAddr);
    if (!domain)
      return sendError(res, "Not found site '" + fromSite + "'", 400);
    const checkToDomain = await this.db.getSiteDomain(admin, toAddr);
    if (checkToDomain)
      return sendError(res, "Already exists site '" + toSite + "'", 400);

    // must be reserved before deploy
    const info = await this.s3.fetchDomainInfo(domain);
    const infoAddr = parseNaddr(info?.site);
    if (
      !info ||
      info.pubkey !== admin ||
      !infoAddr ||
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
    await this.s3.deleteDomainFiles(domain);

    // pre-render one page and publish
    await spawnService("cli", "release_website_zip_preview", [
      toSite,
      "20",
      "domain:" + domain,
    ]);

    // now also migrate the attached domains,
    // all we need to do is update local mapping,
    // the CDN-level mapping operates with subdomains,
    // which we've just redirected above
    const attached = await this.db.listAttach(admin, fromSite);
    for (const data of attached) {
      await this.db.moveAttach(data, toSite);
    }

    // set the site
    info.site = toSite;

    const expires = 0;
    const data = await this.s3.putDomainInfo(info, STATUS_DEPLOYED, expires);

    // ensure local copy of this domain
    await this.db.upsertDomainInfo(data);

    // delete event and old site record from db
    await this.deleteSiteEvent(res, admin, fromSite, fromId, relays);

    // FIXME migrate all pins? Do we allow pinning for sites that are delegated?

    // ok
    sendReply(res, {
      status: STATUS_DEPLOYED,
      expires,
    });
  }

  public async apiDelete(req: http.IncomingMessage, res: http.ServerResponse) {
    const admin = parseSession(req);
    if (!admin) return sendError(res, "Auth please", 401);

    const url = getReqUrl(req);

    let domain = url.searchParams.get("domain")?.split(".npub.pro")[0];
    const site = url.searchParams.get("site");
    if (!site) return sendError(res, "Site not specified", 400);
    const addr = parseNaddr(site);
    if (!addr) return sendError(res, "Bad site '" + site + "'", 400);

    // to make it idempotent, we're finding any trace of our
    // site (even if it's already deleted)
    const sites = await this.db.listSite(admin);
    const domainSite = sites.find((s) => {
      const a = parseNaddr(s.site!);
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

    const info = await this.s3.fetchDomainInfo(domain);
    if (!info) return sendError(res, "Domain not reserved", 400);

    // must be already reserved for this website
    if (!isOwner(domain, admin, addr, info))
      return sendError(res, "Wrong site", 400);

    // mark as released for several days
    const expires = await this.deleteSite(info);

    // done
    sendReply(res, {
      status: STATUS_RELEASED,
      expires,
    });
  }

  public async apiCheck(req: http.IncomingMessage, res: http.ServerResponse) {
    const admin = parseSession(req);
    if (!admin) return sendError(res, "Auth please", 401);

    const url = getReqUrl(req);
    const domain = url.searchParams.get("domain")?.split(".npub.pro")[0];
    const site = url.searchParams.get("site");

    if (!domain || !site) return sendError(res, "Specify domain and site", 400);

    if (!isValidDomain(domain))
      return sendError(res, "Bad domain '" + domain + "'", 400);

    const addr = parseNaddr(site);
    if (!addr) return sendError(res, "Bad site '" + site + "'", 400);

    const info = await this.s3.fetchDomainInfo(domain);
    if (info) {
      if (!canReserve(domain, admin, addr, info))
        return sendError(res, "Not available", 409);
    }

    return sendReply(res, {
      domain,
      status: "available",
    });
  }

  private async checkOwnedDomain(domain: string, admin: string) {
    const oldRecs = await dnsResolveNoCache(domain, "TXT");
    console.log("txt recs old", domain, admin, oldRecs);
    // NOTE: deprecated
    for (const r of oldRecs) {
      const kv = Array.isArray(r) ? r[0] : r;
      if (kv.trim() === `nostr-admin-pubkey=${admin}`) return true;
    }

    const recs = await dnsResolveNoCache(
      `_nostr-admin-pubkey.${domain}`,
      "TXT"
    );
    console.log("txt recs", domain, admin, recs);
    for (const r of recs) {
      const kv = Array.isArray(r) ? r[0] : r;
      if (kv.trim() === admin) return true;
    }

    return false;
  }

  private async sendCert(
    res: http.ServerResponse,
    domain: string,
    admin: string,
    cert: ACMCert
  ) {
    const owned = await this.checkOwnedDomain(domain, admin);
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
        type: vo.Type || "",
        name: vo.Name?.split("." + domain)[0] || "",
        value: vo.Value || "",
      });
    let status = cert.Status as string;
    if (status === "ISSUED" && !owned) status = "PENDING_ADMIN_VALIDATION";
    return sendReply(res, {
      domain,
      status,
      dnsValidation,
    });
  }

  public async apiCreateCert(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ) {
    const admin = parseSession(req);
    if (!admin) return sendError(res, "Auth please", 401);

    const url = getReqUrl(req);

    const domain = url.searchParams.get("domain")?.toLocaleLowerCase();
    if (!domain) return sendError(res, "Specify domain", 400);
    if (!domain.includes(".")) return sendError(res, "Bad domain", 400);

    const alts = [domain, `*.${domain}`];
    // if (domain.split(".").length === 2) alts.push(`*.${domain}`);

    const id = await this.db.getCertId(domain);
    if (id) {
      console.log("cert already requested", domain, id);
      const cert = await this.acm.waitGetCert(id);
      console.log("existing cert", domain, cert);
      if (cert) return this.sendCert(res, domain, admin, cert);

      // mark old cert as failed
      await this.db.setCertError(id, "Not found or failed");
    }

    try {
      const cert = await this.acm.requestCert(domain, admin);

      const data: Cert = {
        id,
        domain,
        pubkey: "",
        timestamp: Date.now(),
        error: "",
      };

      // write to db
      await this.db.createCert(data);

      return this.sendCert(res, domain, admin, cert);
    } catch (e) {
      console.error("apiCreateCert error", e, domain, admin);
      return sendError(res, "Failed to request cert", 500);
    }
  }

  public async apiGetCert(req: http.IncomingMessage, res: http.ServerResponse) {
    const admin = parseSession(req);
    if (!admin) return sendError(res, "Auth please", 401);

    const url = getReqUrl(req);

    const domain = url.searchParams.get("domain")?.toLocaleLowerCase();
    if (!domain) return sendError(res, "Specify domain", 400);

    const id = await this.db.getCertId(domain);
    if (!id) return sendError(res, "Certificate not found", 404);

    const cert = await this.acm.waitGetCert(id);
    if (!cert) return sendError(res, "Failed to get cert", 500);

    return this.sendCert(res, domain, admin, cert);
  }

  public async apiAttachDomain(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ) {
    const admin = parseSession(req);
    if (!admin) return sendError(res, "Auth please", 401);

    const url = getReqUrl(req);
    const domain = url.searchParams.get("domain")?.toLocaleLowerCase();
    const site = url.searchParams.get("site");
    if (!site) return sendError(res, "Specify site", 400);

    const addr = parseNaddr(site);
    if (!addr) return sendError(res, "Bad site '" + site + "'", 400);
    if (!domain) return sendError(res, "Specify domain and site", 400);

    const subdomain = await this.db.getSiteDomain(admin, addr);
    if (!subdomain) return sendError(res, "Site not found", 404);

    const certDomain = domain;
    const certId = await this.db.getCertId(certDomain);
    if (!certId)
      return sendError(res, "Certificate not requested for " + certDomain, 400);

    const cert = await this.acm.waitGetCert(certId);
    if (!cert)
      return sendError(res, "Certificate not found for " + certDomain, 400);
    if (cert.Status !== "ISSUED")
      return sendError(res, "Certificate not issued for " + certDomain, 400);

    const owned = await this.checkOwnedDomain(domain, admin);
    if (!owned) return sendError(res, "Domain admin mismatch", 400);

    // check existing distribution for these aliases
    const aliases = this.acm.getDomainCertAliases(certDomain);
    let dist: CreatedDistribution | undefined = await this.cf.getDistribution(
      aliases
    );

    console.log("existing dist", dist);

    // create distr if not found
    if (!dist) {
      dist = await this.cf.createSiteDistribution({
        aliases,
        certId,
      });
      if (!dist) throw new Error("Failed to create distribution");
    }

    // update bucket policy to allow access
    await this.s3.updateSiteBucketPolicy(dist.ARN!);

    // add cert to load-balancer
    await this.lb.addCertToListener(certId);

    // map domain to subdomain
    await this.s3.setCustomDomainMapping({
      domain: domain,
      sub: subdomain,
    });

    // ensure attached record
    await this.db.upsertAttach({
      domain,
      pubkey: admin,
      site,
    });

    // FIXME wait until CF deploys and DNS is updated

    return sendReply(res, {
      cnameDomain: dist.DomainName + ".",
      redirectIps: AWS_GLOBAL_ACCEL_IPS,
      status: dist.Status,
    });
  }

  public async apiGetAttachedDomains(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ) {
    const admin = parseSession(req);
    if (!admin) return sendError(res, "Auth please", 401);

    const url = getReqUrl(req);
    const domain = url.searchParams.get("domain")?.toLocaleLowerCase();
    const site = url.searchParams.get("site");
    if (!site) return sendError(res, "Specify site", 400);

    const addr = parseNaddr(site);
    if (!addr) return sendError(res, "Bad site '" + site + "'", 400);

    const subdomain = await this.db.getSiteDomain(admin, addr);
    if (!subdomain) return sendError(res, "Site not found", 404);

    const attached = await this.db.listAttach(admin, site, domain || undefined);

    if (domain) {
      const a = attached.find((a) => a.domain === domain);
      if (!a) return sendError(res, "Domain not found", 404);

      const aliases = this.acm.getDomainCertAliases(domain);
      const dist = await this.cf.getDistribution(aliases);
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

  public async apiAuth(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = getReqUrl(req);
    const npub = url.searchParams.get("npub");
    if (!npub) return sendError(res, "Specify npub", 400);

    const ip = getIp(req);
    const minPow = this.getMinPow(ip);
    const { authorization } = req.headers;
    if (
      !(await verifyNip98AuthEvent({
        authorization,
        method: req.method,
        npub,
        path: "/auth",
        minPow,
      }))
    )
      return sendReply(
        res,
        {
          error: "Bad auth",
          minPow,
        },
        403
      );

    const { type, data: authPubkey } = nip19.decode(npub);
    if (type !== "npub") throw new Error("Bad npub");

    // will != authPubkey if DM auth
    const tokenPubkey = authPubkey;

    const token = createSessionToken(tokenPubkey);
    console.log(Date.now(), "new token for ip", ip, tokenPubkey, token);

    // update minPow for this ip
    this.ipPows.set(ip, { pow: minPow, tm: Date.now() });

    sendReply(res, { token });
  }

  public async apiOTP(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = getReqUrl(req);
    const pubkey = url.searchParams.get("pubkey");
    if (!pubkey) return sendError(res, "Specify pubkey", 400);

    // we don't ask for pow in this method,
    // but we use pow counter for per-ip throttling
    const ip = getIp(req);
    const minPow = this.getMinPow(ip);
    if (minPow > MIN_POW + 10) return sendError(res, "Too many requests", 403);

    const relays = await fetchInboxRelays(this.ndk, [pubkey]);
    const code = generateOTP();

    await this.db.createOTP(nip19.npubEncode(pubkey), code);

    await sendOTP(this.ndk, {
      privkey: getServerKey(),
      pubkey,
      code,
      relays,
    });

    this.ipPows.set(ip, { pow: minPow, tm: Date.now() });

    sendReply(res, {
      pubkey,
      ok: true,
    });
  }

  public async apiAuthOTP(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = getReqUrl(req);

    const pubkey = url.searchParams.get("pubkey");
    const code = url.searchParams.get("code");
    if (!pubkey || !code) return sendError(res, "Specify pubkey and code", 400);

    // check token
    const rec = await this.db.checkOTP(nip19.npubEncode(pubkey), code);
    if (!rec || Date.now() - Number(rec.timestamp) > OTP_TTL)
      return sendError(res, "Bad code", 403);

    const ip = getIp(req);
    const token = createSessionToken(pubkey);
    console.log(Date.now(), "new token for ip", ip, pubkey, token);

    sendReply(res, { token });
  }

  public async apiCreateSite(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ) {
    if (req.method !== "POST") return sendError(res, "Use post", 400);

    const admin = parseSession(req);
    if (!admin) return sendError(res, "Auth please", 401);

    const url = getReqUrl(req);
    const relays = (url.searchParams.get("relays") || "")
      .split(",")
      .filter((r) => !!r);
    if (!relays.length) return sendError(res, "Specify relays", 400);

    const body = await readBody(req);

    let event: Event | undefined;
    try {
      event = JSON.parse(body);
    } catch (e) {
      console.log("Bad event", body);
    }
    if (!event) return sendError(res, "Bad event", 400);

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

    const existing = await this.db.getSite(d_tag);
    if (existing && existing.pubkey !== admin)
      return sendError(res, "Not your site", 403);

    // reset to ensure it's set to current timestamp
    event.created_at = 0;

    // try to sign event, will throw if it's invalid
    const ne = await signEvent(this.ndk, event, key);

    // save to db
    if (!existing) await this.db.createSite(d_tag, admin);

    try {
      const r = await publishEvent(this.ndk, ne, relays);
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

  public async apiDeleteSiteEvent(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ) {
    if (req.method !== "DELETE") return sendError(res, "Use delete", 400);

    const admin = parseSession(req);
    if (!admin) return sendError(res, "Auth please", 401);

    const url = getReqUrl(req);
    const site = url.searchParams.get("site");
    const id = url.searchParams.get("id");
    const relays = (url.searchParams.get("relays") || "")
      .split(",")
      .filter((r) => !!r);

    if (!site) return sendError(res, "Specify site", 400);
    if (!relays.length) return sendError(res, "Specify relays", 400);

    // delete event and site record from db
    await this.deleteSiteEvent(res, admin, site, id, relays);

    sendReply(res, {
      ok: true,
    });
  }

  private async requestListener(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ) {
    console.log("request", req.method, req.url, req.headers);
    if (!req.url) throw new Error("No req url");
    try {
      if (req.method === "OPTIONS") {
        // preflight
        sendReply(res, {}, 200);
      } else if (req.url.startsWith("/reserve")) {
        // reserve with a single writer
        await this.mutex.run(() => this.apiReserve(req, res));
      } else if (req.url.startsWith("/deploy")) {
        await this.apiDeploy(req, res);
      } else if (req.url.startsWith("/delete")) {
        await this.apiDelete(req, res);
      } else if (req.url.startsWith("/check")) {
        await this.apiCheck(req, res);
      } else if (req.url.startsWith("/migrate")) {
        await this.apiMigrate(req, res);
      } else if (req.url.startsWith("/authotp")) {
        await this.apiAuthOTP(req, res);
      } else if (req.url.startsWith("/auth")) {
        await this.apiAuth(req, res);
      } else if (req.url.startsWith("/otp")) {
        await this.apiOTP(req, res);
      } else if (req.url.startsWith("/site")) {
        if (req.method === "DELETE") await this.apiDeleteSiteEvent(req, res);
        else await this.apiCreateSite(req, res);
      } else if (req.url.startsWith("/cert")) {
        if (req.method === "POST") await this.apiCreateCert(req, res);
        else await this.apiGetCert(req, res);
      } else if (req.url.startsWith("/attach")) {
        if (req.method === "POST") await this.apiAttachDomain(req, res);
        else await this.apiGetAttachedDomains(req, res);
      } else {
        sendError(res, "Unknown method", 400);
      }
    } catch (e) {
      console.error("error", req.url, e);
      sendError(res, "Server-side error, try again later", 500);
    }
  }

  public async run(host: string, port: number) {
    const server = http.createServer(this.requestListener.bind(this));
    server.listen(port, host, () => {
      console.log(`Server is running on http://${host}:${port}`);
    });
  }

  public async reservePubkeyDomain(pubkey: string, domain: string, months = 3) {
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
    domain = await this.reserve(undefined, pubkey, domain, expires, true);
    console.log("reserved", domain, "for", pubkey);
  }
}

export async function apiMain(argv: string[]) {
  console.log("api", argv);

  const api = new Api();

  const method = argv[0];
  if (method === "reserve_pubkey_domain") {
    const pubkey = argv[1];
    const domain = argv?.[2] || "";
    const months = parseInt(argv?.[3]) || 3;
    console.log(pubkey, domain, months);
    return api.reservePubkeyDomain(pubkey, domain, months);
  } else if (method === "api") {
    const host = argv[1];
    const port = parseInt(argv[2]);
    return api.run(host, port);
  }
}
