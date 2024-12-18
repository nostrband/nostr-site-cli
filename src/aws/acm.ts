import {
  ACMClient,
  CertificateDetail,
  DescribeCertificateCommand,
  RequestCertificateCommand,
} from "@aws-sdk/client-acm";
import { AWSEdgeRegion } from "../common/const";
import { bytesToHex } from "@noble/hashes/utils";
import { sha256 } from "@noble/hashes/sha256";

export type ACMCert = CertificateDetail;

export class ACM {
  private acm: ACMClient = new ACMClient({ region: AWSEdgeRegion });

  constructor() {}

  public async getCert(id: string) {
    const command = new DescribeCertificateCommand({
      CertificateArn: id,
    });

    try {
      const response = await this.acm.send(command);
      console.log("acm cert", id, response.Certificate);
      return response.Certificate;
    } catch (e) {
      console.error("getCert error", e, id);
      return null;
    }
  }

  public async waitGetCert(id: string) {
    for (let i = 0; i < 10; i++) {
      const c = await this.getCert(id);

      if (c && c.Status !== "PENDING_VALIDATION") return c;

      // wait for cert and for validation options to appear
      if (
        !c ||
        !c.DomainValidationOptions ||
        !c.DomainValidationOptions.length ||
        !c.DomainValidationOptions[0].ResourceRecord
      ) {
        await new Promise((ok) => setTimeout(ok, 1000));
      } else {
        return c;
      }
    }

    // not found or validation options didn't appear
    return null;
  }

  public getDomainCertAliases(certDomain: string) {
    return [certDomain, `*.${certDomain}`];
  }

  public async requestCert(domain: string, admin: string) {
    const alts = this.getDomainCertAliases(domain);

    const command = new RequestCertificateCommand({
      // RequestCertificateRequest
      DomainName: domain, // required
      ValidationMethod: "DNS",
      SubjectAlternativeNames: alts,
      IdempotencyToken: bytesToHex(sha256(domain)).substring(0, 32), // per-domain calls are idempotent
      Options: {
        CertificateTransparencyLoggingPreference: "ENABLED",
      },
      Tags: [
        {
          // Tag
          Key: "creator", // required
          Value: admin,
        },
      ],
      KeyAlgorithm: "RSA_2048",
    });
    console.log("acm command", command);

    const response = await this.acm.send(command);
    console.log("acm response", response);
    const id = response.CertificateArn;
    if (!id) throw new Error("Failed to create cert");

    const cert = await this.waitGetCert(id);
    if (!cert) throw new Error("Failed to wait for cert");

    return cert;
  }
}
