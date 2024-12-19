import { ZAPRITE_API } from "../common/const";

export const PAYMENT_UNIT = "USD";

export class Zaprite {
  private API_KEY = process.env.ZAPRITE_API_KEY;
  public ZAPRITE_HOOK_URL_SUFFIX = process.env.ZAPRITE_HOOK_URL_SUFFIX;

  private async fetch(path: string, body?: any) {
    return await fetch(`${ZAPRITE_API}${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        "Authorization": `Bearer ${this.API_KEY}`,
        "Accept": "application/json", 
        "Content-Type": "application/json"
      },
      body: body ? JSON.stringify(body) : undefined
    });
  }

  public async createOrder(order: {
    amount: number,
    unit: "USD",
    label: string,
    pubkey: string,
    id: string,
  }) {
    const body = {
      amount: order.amount,
      currency: order.unit,
      externalUniqId: order.id,
      label: order.label,
      customerData: {
        name: order.pubkey
      }
    };
    const r = await this.fetch("/v1/order", body);
    if (r.status !== 200) throw new Error("Failed to create zaprite order");
    const data = await r.json();
    console.log("zaprite order created", data);
    return data.checkoutUrl;
  }

  public async getOrder(id: string) {
    const r = await this.fetch(`/v1/order/${id}`);
    if (r.status !== 200) throw new Error("Failed to get zaprite order");
    const data = await r.json();
    console.log("zaprite order created", data);
    return data;
  }
}
