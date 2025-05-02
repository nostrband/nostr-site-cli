import { schnorr } from "@noble/curves/secp256k1";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import { Event, UnsignedEvent } from "nostr-tools";

export const utf8Decoder: TextDecoder = new TextDecoder("utf-8");
export const utf8Encoder: TextEncoder = new TextEncoder();

export function normalizeURL(url: string): string {
  if (url.indexOf("://") === -1) url = "wss://" + url;
  let p = new URL(url);
  p.pathname = p.pathname.replace(/\/+/g, "/");
  if (p.pathname.endsWith("/")) p.pathname = p.pathname.slice(0, -1);
  if (
    (p.port === "80" && p.protocol === "ws:") ||
    (p.port === "443" && p.protocol === "wss:")
  )
    p.port = "";
  p.searchParams.sort();
  p.hash = "";
  return p.toString();
}

export function insertEventIntoDescendingList(
  sortedArray: Event[],
  event: Event
): Event[] {
  const [idx, found] = binarySearch(sortedArray, (b) => {
    if (event.id === b.id) return 0;
    if (event.created_at === b.created_at) return -1;
    return b.created_at - event.created_at;
  });
  if (!found) {
    sortedArray.splice(idx, 0, event);
  }
  return sortedArray;
}

export function insertEventIntoAscendingList(
  sortedArray: Event[],
  event: Event
): Event[] {
  const [idx, found] = binarySearch(sortedArray, (b) => {
    if (event.id === b.id) return 0;
    if (event.created_at === b.created_at) return -1;
    return event.created_at - b.created_at;
  });
  if (!found) {
    sortedArray.splice(idx, 0, event);
  }
  return sortedArray;
}

export function binarySearch<T>(
  arr: T[],
  compare: (b: T) => number
): [number, boolean] {
  let start = 0;
  let end = arr.length - 1;

  while (start <= end) {
    const mid = Math.floor((start + end) / 2);
    const cmp = compare(arr[mid]);

    if (cmp === 0) {
      return [mid, true];
    }

    if (cmp < 0) {
      end = mid - 1;
    } else {
      start = mid + 1;
    }
  }

  return [start, false];
}

export class QueueNode<V> {
  public value: V;
  public next: QueueNode<V> | null = null;
  public prev: QueueNode<V> | null = null;

  constructor(message: V) {
    this.value = message;
  }
}

export class Queue<V> {
  public first: QueueNode<V> | null;
  public last: QueueNode<V> | null;

  constructor() {
    this.first = null;
    this.last = null;
  }

  enqueue(value: V): boolean {
    const newNode = new QueueNode(value);
    if (!this.last) {
      // list is empty
      this.first = newNode;
      this.last = newNode;
    } else if (this.last === this.first) {
      // list has a single element
      this.last = newNode;
      this.last.prev = this.first;
      this.first.next = newNode;
    } else {
      // list has elements, add as last
      newNode.prev = this.last;
      this.last.next = newNode;
      this.last = newNode;
    }
    return true;
  }

  dequeue(): V | null {
    if (!this.first) return null;

    if (this.first === this.last) {
      const target = this.first;
      this.first = null;
      this.last = null;
      return target.value;
    }

    const target = this.first;
    this.first = target.next;

    return target.value;
  }
}

export function verifyEvent(event: Event): boolean {
  try {
    const hash = getEventHash(event);
    if (hash !== event.id) return false;
    return schnorr.verify(event.sig, hash, event.pubkey);
  } catch (err) {
    return false;
  }
}

const isRecord = (obj: unknown): obj is Record<string, unknown> =>
  obj instanceof Object;

export function validateEvent<T>(event: T): event is T & UnsignedEvent {
  if (!isRecord(event)) return false;
  if (typeof event.kind !== "number") return false;
  if (typeof event.content !== "string") return false;
  if (typeof event.created_at !== "number") return false;
  if (typeof event.pubkey !== "string") return false;
  if (!event.pubkey.match(/^[a-f0-9]{64}$/)) return false;

  if (!Array.isArray(event.tags)) return false;
  for (let i = 0; i < event.tags.length; i++) {
    let tag = event.tags[i];
    if (!Array.isArray(tag)) return false;
    for (let j = 0; j < tag.length; j++) {
      if (typeof tag[j] === "object") return false;
    }
  }

  return true;
}

export function serializeEvent(evt: UnsignedEvent): string {
  if (!validateEvent(evt))
    throw new Error("can't serialize event with wrong or missing properties");
  return JSON.stringify([
    0,
    evt.pubkey,
    evt.created_at,
    evt.kind,
    evt.tags,
    evt.content,
  ]);
}

export function getEventHash(event: UnsignedEvent): string {
  const eventHash = sha256(utf8Encoder.encode(serializeEvent(event)));
  return bytesToHex(eventHash);
}
