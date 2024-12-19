import { AddressPointer } from "nostr-tools/lib/types/nip19";

export interface SiteInfo {
  domain: string;
  site?: string;
  pubkey?: string;
  status: string;
  timestamp: number;
  expires: number;
}

export interface ValidSiteInfo {
  domain: string;
  site?: string;
  pubkey: string;
}

export interface Attach {
  id: number;
  pubkey: string;
  domain: string;
  site: string;
  timestamp: bigint;
}

export interface Cert {
  id: string;
  pubkey: string;
  domain: string;
  timestamp: number;
  error: string;
}

export interface Domain {
  domain: string;
  site: string | null;
  status: string;
  timestamp: bigint;
  expires: bigint;
  pubkey: string | null;
  // last time it was rendered
  rendered?: bigint;
  // last time it was updated, if < rendered => needs rerender
  updated?: bigint;
  // when last fetch was performed
  fetched?: bigint;
}

export type DeployedDomain = Domain & {
  addr?: AddressPointer;
};

export interface Price {
  id: string;
  type: string;
  plan: string;
  amount: number;
  unit: string;
  period: string;
  group: string;
  timestamp: bigint;
}

export interface Service {
  id: string;
  pubkey: string;
  price_id: string;
  object_id: string;
  timestamp: number;
  paid_until: number;
}

export interface Invoice {
  id: string;
  pubkey: string;
  service_id: string;
  timestamp: number;
  price_id: string;
  amount: number;
  unit: string;
  period: string;
  due_timestamp: number;
  paid_timestamp: number;
  paid_order_id: string;
}

export interface Order {
  id: string;
  pubkey: string;
  invoice_ids: string;
  timestamp: number;
  amount: number;
  unit: string;
  checkout_url: string;
  paid_timestamp: number;
  error: string;
}
