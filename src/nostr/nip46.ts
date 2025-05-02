import NDK, {
  NDKEvent,
  NDKFilter,
  NDKNip46Signer,
  NDKNostrRpc,
  NDKRpcRequest,
  NDKRpcResponse,
  NDKSigner,
  NDKSubscription,
  NDKUser,
  NostrEvent,
} from "@nostr-dev-kit/ndk";
import { PrivateKeySigner } from "./private-key-signer";

class NostrRpc extends NDKNostrRpc {
  protected _ndk: NDK;
  protected _signer: PrivateKeySigner;
  protected requests: Set<string> = new Set();
  private sub?: NDKSubscription;
  protected _useNip44: boolean = false;

  public constructor(ndk: NDK, signer: PrivateKeySigner) {
    super(ndk, signer, ndk.debug.extend("nip46:signer:rpc"));
    this._ndk = ndk;
    this._signer = signer;
  }

  public async subscribe(filter: NDKFilter): Promise<NDKSubscription> {
    // NOTE: fixing ndk
    filter.kinds = filter.kinds?.filter((k) => k === 24133);
    this.sub = await super.subscribe(filter);
    return this.sub;
  }

  public stop() {
    if (this.sub) {
      this.sub.stop();
      this.sub = undefined;
    }
  }

  public setUseNip44(useNip44: boolean) {
    this._useNip44 = useNip44;
  }

  private isNip04(ciphertext: string) {
    const l = ciphertext.length;
    if (l < 28) return false;
    return (
      ciphertext[l - 28] === "?" &&
      ciphertext[l - 27] === "i" &&
      ciphertext[l - 26] === "v" &&
      ciphertext[l - 25] === "="
    );
  }

  // override to auto-decrypt nip04/nip44
  public async parseEvent(
    event: NDKEvent
  ): Promise<NDKRpcRequest | NDKRpcResponse> {
    const remoteUser = this._ndk.getUser({ pubkey: event.pubkey });
    remoteUser.ndk = this._ndk;
    const decrypt = this.isNip04(event.content)
      ? this._signer.decrypt
      : this._signer.decryptNip44;
    const decryptedContent = await decrypt.call(
      this._signer,
      remoteUser,
      event.content
    );
    const parsedContent = JSON.parse(decryptedContent);
    const { id, method, params, result, error } = parsedContent;

    if (method) {
      return { id, pubkey: event.pubkey, method, params, event };
    } else {
      return { id, result, error, event };
    }
  }

  protected getId(): string {
    return Math.random().toString(36).substring(7);
  }

  public async sendRequest(
    remotePubkey: string,
    method: string,
    params: string[] = [],
    kind = 24133,
    cb?: (res: NDKRpcResponse) => void
  ): Promise<NDKRpcResponse> {
    const id = this.getId();

    // response handler will deduplicate auth urls and responses
    this.setResponseHandler(id, cb);

    // create and sign request
    const event = await this.createRequestEvent(
      id,
      remotePubkey,
      method,
      params,
      kind
    );
    // console.log("sendRequest", { event, method, remotePubkey, params });

    // send to relays
    await event.publish();

    // NOTE: ndk returns a promise that never resolves and
    // in fact REQUIRES cb to be provided (otherwise no way
    // to consume the result), we've already stepped on the bug
    // of waiting for this unresolvable result, so now we return
    // undefined to make sure waiters fail, not hang.
    // @ts-ignore
    return undefined as NDKRpcResponse;
  }

  protected setResponseHandler(id: string, cb?: (res: NDKRpcResponse) => void) {
    let authUrlSent = false;
    const now = Date.now();
    return new Promise<NDKRpcResponse>(() => {
      const responseHandler = (response: NDKRpcResponse) => {
        if (response.result === "auth_url") {
          this.once(`response-${id}`, responseHandler);
          if (!authUrlSent) {
            authUrlSent = true;
            this.emit("authUrl", response.error);
          }
        } else if (cb) {
          if (this.requests.has(id)) {
            this.requests.delete(id);
            cb(response);
          }
        }
      };

      this.once(`response-${id}`, responseHandler);
    });
  }

  protected async createRequestEvent(
    id: string,
    remotePubkey: string,
    method: string,
    params: string[] = [],
    kind = 24133
  ) {
    this.requests.add(id);
    const localUser = await this._signer.user();
    const remoteUser = this._ndk.getUser({ pubkey: remotePubkey });
    const request = { id, method, params };

    const event = new NDKEvent(this._ndk, {
      kind,
      content: JSON.stringify(request),
      tags: [["p", remotePubkey]],
      pubkey: localUser.pubkey,
    } as NostrEvent);

    const useNip44 = this._useNip44 && method !== "create_account";
    const encrypt = useNip44 ? this._signer.encryptNip44 : this._signer.encrypt;
    event.content = await encrypt.call(this._signer, remoteUser, event.content);
    await event.sign(this._signer);

    return event;
  }
}

export class Nip46Signer extends NDKNip46Signer {
  constructor(ndk: NDK, pubkey: string, localSigner: PrivateKeySigner) {
    super(ndk, pubkey, localSigner);

    const rpc = new NostrRpc(ndk, localSigner);
    rpc.setUseNip44(true);
    rpc.on("authUrl", (...props) => {
      this.emit("authUrl", ...props);
    });
    this.rpc = rpc;
  }

  encryptNip44(user: NDKUser, value: string) {
    return new Promise<string>((resolve, reject) => {
      this.rpc.sendRequest(
        this.remotePubkey!,
        `nip44_encrypt`,
        [user.pubkey, value],
        24133,
        (response: NDKRpcResponse) => {
          if (!response.error) {
            resolve(response.result);
          } else {
            reject(response.error);
          }
        }
      );
    });
  }

  decryptNip44(user: NDKUser, value: string) {
    return new Promise<string>((resolve, reject) => {
      this.rpc.sendRequest(
        this.remotePubkey!,
        `nip44_decrypt`,
        [user.pubkey, value],
        24133,
        (response: NDKRpcResponse) => {
          if (!response.error) {
            resolve(response.result);
          } else {
            reject(response.error);
          }
        }
      );
    });
  }
}
