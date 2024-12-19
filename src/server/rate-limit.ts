import { DOMAINS_PERIOD, MIN_POW, POW_PERIOD } from "../common/const";

export class RateLimiter {
  private ipPows = new Map<string, { pow: number, tm: number }>();
  private ipDomains = new Map<string, { domains: number; tm: number }>();

  public setIpDomains(ip: string, domains: number) {
    this.ipDomains.set(ip, { domains, tm: Date.now() });
  }

  public getIpDomains(ip: string) {
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

  public setMinPow(ip: string, pow: number) {
    this.ipPows.set(ip, { pow, tm: Date.now() });
  }

  public getMinPow(ip: string) {
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
}