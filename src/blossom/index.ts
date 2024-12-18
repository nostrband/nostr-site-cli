import { getEventHash } from "nostr-tools";
import { cliSigner } from "../auth/cli-auth";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import { BlossomClient, EventTemplate, SignedEvent } from "blossom-client-sdk";

export class Blossom {
  public async getFileHash(file: File) {
    return BlossomClient.getFileSha256(file);
  }

  private async createGetAuth(pubkey: string) {
    return BlossomClient.getGetAuth(this.makeSignEvent(pubkey));
  }

  private async createUploadAuth(pubkey: string, file: File) {
    return await BlossomClient.getUploadAuth(file, this.makeSignEvent(pubkey));
  }

  private async createDeleteAuth(pubkey: string, hash: string) {
    return await BlossomClient.getDeleteAuth(hash, this.makeSignEvent(pubkey));
  }

  private makeSignEvent(pubkey: string) {
    return async function (draft: EventTemplate) {
      console.log("sign blossom auth as", pubkey);
      // add the pubkey to the draft event
      const event = { ...draft, pubkey };
      //    console.log("signing", event);
      // get the signature
      const sig = await cliSigner.sign(event);
      //    console.log("signed", sig);

      // return the event + id + sig
      return { ...event, sig, id: getEventHash(event) };
    };
  }

  public async checkFile({
    entry,
    server,
    hash,
    pubkey,
    debug = false,
  }: {
    entry: string;
    server: string;
    hash: string;
    pubkey: string;
    debug?: boolean;
  }) {
    try {
      const auth = await this.createGetAuth(pubkey);
      const blob = await BlossomClient.getBlob(server, hash, auth);
      if (!blob) return false;
      const data = new Uint8Array(await blob.arrayBuffer());
      const blobHash = bytesToHex(sha256(data));
      const exists = blobHash === hash;
      console.log(
        entry,
        "exists",
        exists,
        "server",
        server,
        "hash",
        hash,
        "blobHash",
        blobHash
      );
      if (!exists && debug)
        console.log("bad data", new TextDecoder().decode(data));
      return exists;
    } catch (e) {
      console.log(e);
    }
    return false;
  }

  public async deleteFile({
    server,
    hash,
    pubkey
  }: {
    server: string,
    hash: string,
    pubkey: string
  }) {
    const auth = await this.createDeleteAuth(pubkey, hash);
    return await BlossomClient.deleteBlob(server, hash, auth);
  }

  public async uploadFile({
    entry,
    server,
    file,
    mime,
    pubkey,
    hash,
  }: {
    entry: string;
    server: string;
    file: File;
    mime: string;
    pubkey: string;
    hash: string;
  }) {
    console.log(entry, "uploading to", server, mime);
    try {
      const auth = await this.createUploadAuth(pubkey, file);
      const res = await fetch(new URL("/upload", server), {
        method: "PUT",
        body: await file.arrayBuffer(),
        headers: {
          authorization: BlossomClient.encodeAuthorizationHeader(auth),
          "Content-Type": mime,
        },
      });

      const reply = await res.json();
      console.log(entry, "upload reply", reply);
      if (reply.sha256 !== hash || (mime !== "" && reply.type !== mime))
        console.log(
          entry,
          "failed to upload to",
          server,
          "wrong reply hash",
          reply.sha256,
          "expected",
          hash
        );
      else if (!reply.url)
        console.log(entry, "failed to upload to", server, reply);
      else return true;
    } catch (e) {
      console.log(entry, "failed to upload to", server, e);
    }
    return false;
  }
}
