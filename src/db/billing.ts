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
      where,
    });
  }

  public async listInvoices(where: { pubkey: string, id?: { in: string[] } }): Promise<Invoice[]> {
    return await this.prisma.invoices.findMany({
      where,
    });
  }

  public async listOrders(where: {
    pubkey: string;
    id?: string;
  }): Promise<Order[]> {
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
