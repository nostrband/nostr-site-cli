import { Invoice, Order, Price, Service } from "../common/types";
import { calcPaidUntil, now } from "../common/utils";
import { prisma } from "./prisma";

export class BillingDB {
  private prisma = prisma;

  constructor() {}

  public async listPrices(where: {
    type?: string;
    plan?: string;
    group?: string;
  }): Promise<Price[]> {
    return await this.prisma.prices.findMany({
      where,
    });
  }

  public async listServices(where: { pubkey: string }): Promise<Service[]> {
    return await this.prisma.services.findMany({
      where: {
        ...where,
        // paid
        paid_until: { gt: 0 },
        // and either
        OR: [
          // not canceled
          { cancel_tm: 0 },
          // or canceled but not yet expired
          { cancel_tm: { gt: 0 }, paid_until: { gt: now() } },
        ],
      },
    });
  }

  public async listInvoices(params: {
    pubkey: string;
    paid?: boolean;
    id?: { in: string[] };
  }): Promise<Invoice[]> {
    const where: any = { pubkey: params.pubkey, id: params.id, due_timestamp: { gt: 0 } };
    if (params.paid !== undefined) {
      where.paid_timestamp = params.paid ? { gt: 0 } : 0;
      if (params.paid)
        delete where.due_timestamp;
    }
    return await this.prisma.invoices.findMany({
      where,
    });
  }

  public async listOrders(params: {
    pubkey: string;
    id?: string;
  }): Promise<Order[]> {
    const where: any = { ...params };
    if (!params.id) {
      where.paid_timestamp = { gt: 0 };
    }
    return await this.prisma.orders.findMany({
      where,
    });
  }

  public async createPrice(data: Price) {
    return this.prisma.prices.create({
      data,
    });
  }

  public async createService(data: Service) {
    return this.prisma.services.create({
      data,
    });
  }
  
  public async createInvoice(data: Invoice) {
    return this.prisma.invoices.create({
      data,
    });
  }

  public async createOrder(data: Order) {
    return this.prisma.orders.create({
      data,
    });
  }

  public async updateOrder(data: Order) {
    return this.prisma.orders.update({
      where: {
        id: data.id,
      },
      data,
    });
  }

  public async getOrder(id: string) {
    return this.prisma.orders.findFirst({
      where: {
        id,
      },
    });
  }

  public async cancelService(id: string) {
    return this.prisma.services.update({
      where: {
        id: id,
      },
      data: {
        cancel_tm: now(),
      },
    });
  }

  public async updatePaidUntilService(id: string) {
    const now = new Date();
    const dayBeforeYesterday = new Date(now);
    dayBeforeYesterday.setDate(now.getDate() - 2);
    const paid_until = Math.floor(dayBeforeYesterday.getTime() / 1000);
    
    return this.prisma.services.update({
      where: {
        id: id,
      },
      data: {
        paid_until,
      },
    });
  }

  public async setPaidOrder(order: Order) {
    order.paid_timestamp = now();
    const invoice_ids = order.invoice_ids.split(",");
    const invoices = await this.prisma.invoices.findMany({
      where: {
        id: {
          in: invoice_ids,
        },
      },
    });
    const service_ids = invoices.map((i) => i.service_id);
    const services = await this.prisma.services.findMany({
      where: {
        id: {
          in: service_ids,
        },
      },
    });
    console.log("paid order", order.id, invoices, services);

    for (const i of invoices) {
      i.paid_order_id = order.id;
      i.paid_timestamp = order.paid_timestamp;
      const service = services.find((s) => s.id === i.service_id);
      if (!service) throw new Error("Service not found");

      const due_timestamp = i.due_timestamp || now();
      const paid_until = calcPaidUntil(due_timestamp, i.period);
      if (service.paid_until < paid_until) {
        service.paid_until = paid_until;
      }
    }
    console.log("updated invoices and services", invoices, services);

    await this.prisma.$transaction([
      this.prisma.orders.update({
        where: {
          id: order.id,
        },
        data: order,
      }),
      ...invoices.map((i) =>
        this.prisma.invoices.update({
          where: { id: i.id },
          data: i,
        })
      ),
      ...services.map((s) =>
        this.prisma.services.update({
          where: { id: s.id },
          data: s,
        })
      ),
    ]);
  }
}
