import http from "http";
import {
  getReqUrl,
  parseSession,
  readBody,
  sendError,
  sendReply,
  serverRun,
} from "../server/utils";
import { BillingDB } from "../db/billing";
import { ApiDB } from "../db/api";
import { parseNaddr } from "../nostr";
import { v4 as uuidv4 } from "uuid";
import { Invoice, Order, Service } from "../common/types";
import { PAYMENT_UNIT, Zaprite } from "../zaprite";
import { now } from "../common/utils";

const PRICE_TYPE_SITE = "site";

class BillingApi {
  private billingDB = new BillingDB();
  private apiDB = new ApiDB();
  private zaprite = new Zaprite();

  constructor() {}

  private async listPrices(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ) {
    const prices = await this.billingDB.listPrices({});
    sendReply(res, {
      prices: prices.map((p) => {
        const { group: omitted, ...r } = p;
        return r;
      }),
    });
  }

  private async listServices(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ) {
    const admin = parseSession(req);
    if (!admin) return sendError(res, "Auth please", 401);

    const services = await this.billingDB.listServices({ pubkey: admin });
    sendReply(res, {
      services,
    });
  }

  private async listInvoices(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ) {
    const admin = parseSession(req);
    if (!admin) return sendError(res, "Auth please", 401);

    const invoices = await this.billingDB.listInvoices({ pubkey: admin });
    sendReply(res, {
      invoices,
    });
  }

  private async listOrders(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ) {
    const admin = parseSession(req);
    if (!admin) return sendError(res, "Auth please", 401);

    const orders = await this.billingDB.listOrders({ pubkey: admin });
    sendReply(res, {
      orders,
    });
  }

  private async buySitePro(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ) {
    const admin = parseSession(req);
    if (!admin) return sendError(res, "Auth please", 401);

    const url = getReqUrl(req);

    const site = url.searchParams.get("site");
    if (!site) return sendError(res, "Specify site", 400);

    const addr = parseNaddr(site);
    if (!addr) return sendError(res, "Bad site '" + site + "'", 400);

    const domain = await this.apiDB.getSiteDomain(admin, addr);
    if (!domain) return sendError(res, "Site not found", 400);

    const prices = await this.billingDB.listPrices({
      type: PRICE_TYPE_SITE,
    });
    if (!prices || !prices.length) throw new Error("No prices");

    // FIXME hmm... why first one?
    const price = prices[0];

    // create unpaid service
    const service: Service = {
      id: uuidv4(),
      object_id: site,
      price_id: price.id,
      pubkey: admin,
      timestamp: now(),
      paid_until: 0,
    };
    await this.billingDB.createService(service);

    // create unpaid invoice
    const invoice: Invoice = {
      id: uuidv4(),
      pubkey: admin,
      service_id: service.id,
      due_timestamp: 0, // no due-date
      price_id: price.id,
      amount: price.amount,
      unit: price.unit,
      period: price.period,
      paid_order_id: "",
      paid_timestamp: 0,
      timestamp: now(),
    };
    await this.billingDB.createInvoice(invoice);

    // order to link with zaprite
    const order_id = uuidv4();

    // create zaprite url
    const checkout_url = await this.zaprite.createOrder({
      amount: invoice.amount,
      pubkey: admin,
      label: `Website Pro "${domain}"`,
      // @ts-ignore
      unit: invoice.unit,
      id: order_id,
    });

    // create order with zaprite
    const order: Order = {
      id: order_id,
      pubkey: admin,
      amount: invoice.amount,
      unit: invoice.unit,
      invoice_ids: invoice.id,
      checkout_url,
      paid_timestamp: 0,
      timestamp: now(),
      error: "",
    };
    await this.billingDB.createOrder(order);

    sendReply(res, {
      service,
      invoice,
      order,
    });
  }

  private async createOrder(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ) {
    const admin = parseSession(req);
    if (!admin) return sendError(res, "Auth please", 401);

    const url = getReqUrl(req);

    const invoices_param = url.searchParams.get("invoices");
    if (!invoices_param) return sendError(res, "Specify invoices", 400);

    const invoice_ids = invoices_param.split(",").filter((i) => !!i);
    if (!invoice_ids.length) return sendError(res, "Empty invoices", 400);

    const invoices = await this.billingDB.listInvoices({
      pubkey: admin,
      id: { in: invoice_ids },
    });
    if (invoices.length !== invoice_ids.length)
      return sendError(res, "Invoice not found", 400);

    if (invoices.find((i) => i.unit !== PAYMENT_UNIT))
      return sendError(res, "Bad invoice unit", 400);

    // order to link with zaprite
    const order_id = uuidv4();
    const unit = PAYMENT_UNIT;
    const amount = invoices.reduce((s, i) => s + i.amount, 0);

    // create zaprite url
    const checkout_url = await this.zaprite.createOrder({
      pubkey: admin,
      label: `Npub.pro services, ${invoices.length} invoices`,
      id: order_id,
      // @ts-ignore
      unit,
      amount,
    });

    // create order with zaprite
    const order: Order = {
      id: order_id,
      pubkey: admin,
      amount: amount,
      unit,
      invoice_ids: invoices.map((i) => i.id).join(","),
      checkout_url,
      paid_timestamp: 0,
      timestamp: now(),
      error: "",
    };
    await this.billingDB.createOrder(order);

    sendReply(res, {
      order,
    });
  }

  private async zapriteHook(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ) {
    const body = await readBody(req);

    let data:
      | {
          eventType: string;
          orderId: string;
          orgId: string;
        }
      | undefined;
    try {
      data = JSON.parse(body);
    } catch (e) {
      console.log("Bad event", body);
    }
    if (!data || !data.orgId || !data.eventType || !data.orderId)
      return sendError(res, "Bad data", 400);

    const z_order = await this.zaprite.getOrder(data.orderId);
    if (!z_order) throw new Error("Zaprite order not found");

    // FIXME DEBUG
    console.log("FIXME FAKE ORDER STATUS!!!");
    z_order.status = "COMPLETE";
    console.log("got zaprite order", z_order);

    let error = "";
    switch (z_order.status) {
      case "PENDING":
      case "PROCESSING":
        // all ok still waiting for payment
        return sendReply(res, "");

      case "PAID":
        error = "Wrong order status";
        break;
      case "UNDERPAID":
        error = "Order underpaid";
        break;

      case "COMPLETE":
      case "OVERPAID":
        // all ok
        break;
    }

    const order = await this.billingDB.getOrder(z_order.externalUniqId);
    if (!order) throw new Error("Order not found");

    console.log("order completed", error, order);

    order.error = error;
    if (error) {
      await this.billingDB.updateOrder(order);
      return sendReply(res, "");
    }

    // all ok, mark invoices as paid and services as paid_until
    // within a single transaction
    await this.billingDB.setPaidOrder(order);
    return sendReply(res, "");
  }

  public zapriteHookUrl() {
    return `/zaprite_hook_${this.zaprite.ZAPRITE_HOOK_URL_SUFFIX}`;
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
      } else if (req.url.startsWith("/prices")) {
        await this.listPrices(req, res);
      } else if (req.url.startsWith("/services")) {
        await this.listServices(req, res);
      } else if (req.url.startsWith("/invoices")) {
        await this.listInvoices(req, res);
      } else if (req.url.startsWith("/orders")) {
        await this.listOrders(req, res);
      } else if (req.url.startsWith("/pro")) {
        if (req.method === "POST") await this.buySitePro(req, res);
      } else if (req.url.startsWith("/order")) {
        if (req.method === "POST") await this.createOrder(req, res);
      } else if (req.url.startsWith(this.zapriteHookUrl())) {
        if (req.method === "POST") await this.zapriteHook(req, res);
        else throw new Error("Bad method");
      } else {
        sendError(res, "Unknown method", 400);
      }
    } catch (e) {
      console.error("error", req.url, e);
      sendError(res, "Server-side error, try again later", 500);
    }
  }

  public async run(host: string, port: number) {
    return serverRun(host, port, this.requestListener.bind(this));
  }
}

export async function billingMain(argv: string[]) {
  console.log("billing", argv);

  const billing = new BillingApi();
  console.log("zaprite hook", billing.zapriteHookUrl());

  const method = argv[0];
  if (method === "run") {
    const host = argv[1];
    const port = parseInt(argv[2]);
    return billing.run(host, port);
  }
}
