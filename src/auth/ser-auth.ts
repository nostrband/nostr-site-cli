import { nip19 } from "nostr-tools";

export function getServerKey() {
  const nsec = process.env.SERVER_NSEC;
  const { type, data } = nip19.decode(nsec!);
  if (type !== "nsec" || !data) throw new Error("No server key");
  return data;
}
