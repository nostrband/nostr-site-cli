import { PrismaClient } from "@prisma/client";
import { Attach, Cert, DeployedDomain, SiteInfo } from "../common/types";
import { STATUS_DEPLOYED } from "../common/const";
import { parseNaddr } from "../nostr";
import { AddressPointer } from "nostr-tools/lib/types/nip19";
import { nip19 } from "nostr-tools";

export class DB {
  private prisma: PrismaClient = new PrismaClient();

  constructor() {}

  public async upsertDomainInfo(data: SiteInfo) {
    return this.prisma.domain.upsert({
      create: data,
      update: data,
      where: { domain: data.domain },
    });
  }

  public async getSiteDomain(admin: string, addr: AddressPointer) {
    const sites = await this.prisma.domain.findMany({
      where: {
        pubkey: admin,
        status: STATUS_DEPLOYED,
      },
    });
    const site = sites.find((s) => {
      const a = parseNaddr(s.site!)!;
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

  public async listAttach(pubkey: string, site: string, domain?: string) {
    return await this.prisma.attach.findMany({
      where: {
        pubkey,
        site,
        domain,
      },
    });
  }

  public async moveAttach(data: Attach, toSite: string) {
    const fromSite = data.site;
    data.site = toSite;
    await this.prisma.attach.upsert({
      create: data,
      update: data,
      // find by fromSite
      where: {
        pubkey_site_domain: {
          pubkey: data.pubkey,
          site: fromSite,
          domain: data.domain,
        },
      },
    });
  }

  public async upsertAttach(data: {
    domain: string;
    pubkey: string;
    site: string;
  }) {
    // ensure attached record
    await this.prisma.attach.upsert({
      create: { ...data, timestamp: Date.now() },
      update: data,
      where: { pubkey_site_domain: data },
    });
  }

  public async getSite(d_tag: string) {
    return await this.prisma.sites.findFirst({
      where: {
        d_tag,
      },
    });
  }

  public async createSite(d_tag: string, pubkey: string) {
    await this.prisma.sites.create({
      data: {
        d_tag,
        pubkey,
      },
    });
  }

  public async listSite(pubkey: string) {
    return await this.prisma.domain.findMany({
      where: {
        pubkey,
      },
    });
  }

  public async deleteSite(d_tag: string, pubkey: string) {
    return await this.prisma.sites.delete({
      where: {
        d_tag,
        pubkey,
      },
    });
  }

  public async getCertId(domain: string) {
    const rec = await this.prisma.certs.findFirst({
      where: {
        domain,
        error: "",
      },
    });
    console.log("domain cert", domain, rec);
    return rec ? rec.id : "";
  }

  public async setCertError(id: string, error: string) {
    await this.prisma.certs.update({
      where: { id },
      data: { error },
    });
  }

  public async createCert(data: Cert) {
    await this.prisma.certs.create({
      data,
    });
  }

  public async createOTP(npub: string, code: string) {
    await this.prisma.codes.create({
      data: {
        npub,
        code,
        timestamp: Date.now(),
      },
    });
  }

  public async checkOTP(npub: string, code: string) {
    const rec = await this.prisma.codes.findFirst({
      where: {
        npub,
        code,
      },
    });
    console.log("code for", npub, code, rec);

    // delete consumed token
    if (rec)
      await this.prisma.codes.delete({
        where: {
          id: rec.id,
        },
      });

    return rec;
  }

  public async listDeployedDomains() {
    return (
      await this.prisma.domain.findMany({
        where: {
          status: STATUS_DEPLOYED,
        },
      })
    )
      .map((d): DeployedDomain => {
        const dd: DeployedDomain = { ...d };
        try {
          const { type, data } = nip19.decode(d.site!);
          if (type !== "naddr") throw new Error("Bad site addr type");
          dd.addr = data;
        } catch (e) {
          console.warn("Invalid site ", d.site, "domain", d.domain, e);
        }
        return dd;
      })
      .filter((d) => !!d.addr);
  }

  public async setRerenderDomain(domain: string, updated: number) {
    await this.prisma.domain.update({
      where: { domain },
      data: { updated },
    });
  }

  public async addEventToQueue(domain: string, id: string) {
    await this.prisma.eventQueue.create({
      data: {
        domain: domain,
        eventId: id,
        timestamp: Date.now(),
      },
    });
  }

  public async getEventQueue() {
    return await this.prisma.eventQueue.findFirst();
  }

  public async listEventQueue(domain: string) {
    return await this.prisma.eventQueue.findMany({
      where: {
        domain,
      },
    });
  }

  public async deleteEventQueue(id: number) {
    await this.prisma.eventQueue.delete({
      where: {
        id,
      },
    });
  }

  public async getLastEventQueue(domain: string) {
    return await this.prisma.eventQueue.findFirst({
      where: {
        domain,
      },
      orderBy: [
        {
          id: "desc",
        },
      ],
    });
  }

  public async deleteEventQueueUntil(domain: string, lastId: number) {
    return await this.prisma.eventQueue.deleteMany({
      where: {
        domain,
        id: {
          lte: lastId,
        },
      },
    });
  }

  public async setDomainRendered(domain: string, tm: number) {
    await this.prisma.domain.update({
      where: { domain },
      data: { rendered: tm },
    });
  }

  public async setUpdatedSites(fetchedTm: number, newDomains: string[]) {
    const ec = await this.prisma.domain.updateMany({
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
    const nc = await this.prisma.domain.updateMany({
      where: {
        status: STATUS_DEPLOYED,
        fetched: 0,
        domain: {
          in: newDomains,
        },
      },
      data: {
        fetched: fetchedTm,
      },
    });
    console.log("fetched counts", ec, nc);
  }
}
