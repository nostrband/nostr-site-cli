import {
  CreateBucketCommand,
  CreateBucketCommandOutput,
  DeleteObjectsCommand,
  GetBucketPolicyCommand,
  GetObjectCommand,
  GetObjectCommandOutput,
  ListObjectsV2Command,
  PutBucketPolicyCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  AWSRegion,
  CUSTOM_BUCKET,
  DOMAINS_BUCKET,
  SITES_BUCKET,
  STATUS_RESERVED,
} from "../common/const";
import { sha256 } from "@noble/hashes/sha256";
import fs from "fs";
import { getMime } from "../common/utils";
import { ValidSiteInfo } from "../common/types";

export type CreatedBucket = CreateBucketCommandOutput;

export class S3 {
  private s3: S3Client;

  constructor() {
    this.s3 = new S3Client({ region: AWSRegion });
  }

  public async createBucket(bucketName: string): Promise<CreatedBucket> {
    const createBucket = new CreateBucketCommand({
      Bucket: bucketName,
    });
    return await this.s3.send(createBucket);
  }

  public async setBucketPolicy(bucketName: string, distArn: string) {
    const policy = {
      Version: "2008-10-17",
      Id: "PolicyForCloudFrontPrivateContent",
      Statement: [
        {
          Sid: "AllowCloudFrontServicePrincipal",
          Effect: "Allow",
          Principal: {
            Service: "cloudfront.amazonaws.com",
          },
          Action: "s3:GetObject",
          Resource: `arn:aws:s3:::${bucketName}/*`,
          Condition: {
            StringEquals: {
              "AWS:SourceArn": distArn,
            },
          },
        },
      ],
    };
    const policyReply = await this.s3.send(
      new PutBucketPolicyCommand({
        Bucket: bucketName,
        Policy: JSON.stringify(policy),
      })
    );
    console.log("policyReply", policyReply);
  }

  public async upload(
    bucket: string,
    key: string,
    content: string,
    contentType?: string,
    cacheControl?: string
  ) {
    const cmd = new PutObjectCommand({
      Bucket: bucket,
      Body: content,
      Key: key,
      ContentType: contentType,
      CacheControl: cacheControl,
      ChecksumAlgorithm: "SHA256",
      ChecksumSHA256: Buffer.from(sha256(content)).toString("base64"),
    });
    return await this.s3.send(cmd);
  }

  public async uploadDomainDir(
    dir: string,
    bucketName: string,
    domain: string
  ) {
    const files: string[] = [];
    fs.readdirSync(dir, { recursive: true, encoding: "utf8" }).forEach(
      (file) => {
        const stat = fs.statSync(dir + "/" + file);
        console.warn("path", file, "is file", stat.isFile());
        if (!stat.isFile()) return;
        files.push(file);
      }
    );
    console.warn("files", files);

    const keys: string[] = [];
    for (const f of files) {
      const content = fs.readFileSync(`${dir}/${f}`);
      const key = `${domain}/${f}`;
      keys.push(key);
      const CacheControl = f === "index.html" ? "no-cache" : undefined;
      console.warn("uploading", f, "to", key, "cache control", CacheControl);
      const cmd = new PutObjectCommand({
        Bucket: bucketName,
        Body: content,
        Key: key,
        ContentType: getMime(f),
        CacheControl,
        ChecksumAlgorithm: "SHA256",
        ChecksumSHA256: Buffer.from(sha256(content)).toString("base64"),
      });
      const r = await this.s3.send(cmd);
      console.warn("uploaded", f, r);
    }

    return keys;
  }

  public async listBucketKeys(bucket: string, prefix?: string) {
    let keys: string[] = [];
    let token: string | undefined;
    do {
      const cmd = new ListObjectsV2Command({
        Bucket: bucket,
        MaxKeys: 1000,
        Prefix: prefix ? prefix + "/" : undefined,
        ContinuationToken: token,
      });
      const r = await this.s3.send(cmd);
      console.log("list bucket ", bucket, prefix, r.KeyCount, token);
      if (r.Contents) keys.push(...r.Contents.map((c) => c.Key!));
      token = r.NextContinuationToken;
    } while (token);

    return keys;
  }

  public async deleteDomainFiles(domain: string, keys?: string[]) {
    keys = keys || (await this.listBucketKeys(SITES_BUCKET, domain));
    while (keys.length > 0) {
      const batch = keys.splice(0, Math.min(keys.length, 1000));
      const cmd = new DeleteObjectsCommand({
        Bucket: SITES_BUCKET,
        Delete: {
          Objects: batch.map((k) => ({ Key: k })),
          Quiet: true,
        },
      });

      const r = await this.s3.send(cmd);
      console.log("deleted domain", domain, "batch", batch, "r", r);
    }
  }

  public async uploadWebsite(
    dir: string,
    domain: string,
    deleteOldFiles = false
  ) {
    // full rerender?
    const existingKeys: string[] = [];
    if (deleteOldFiles) {
      existingKeys.push(...(await this.listBucketKeys(SITES_BUCKET, domain)));
    }
    console.log("existingKeys", existingKeys);

    const keys = await this.uploadDomainDir(dir, SITES_BUCKET, domain);
    console.log("uploaded keys", keys);
    if (deleteOldFiles) {
      const deleteKeys = existingKeys.filter((k) => !keys.includes(k));
      console.log("deleteKeys", deleteKeys);
      await this.deleteDomainFiles(domain, deleteKeys);
    }
  }

  // private readText(s3reply: GetObjectCommandOutput) {
  //   let content = "";
  //   // FIXME wtf?
  //   for await (const chunk of s3reply.Body!) content += chunk.toString("utf-8");
  //   return content;
  // }

  private getDomainKey(domain: string) {
    return `${domain}.json`;
  }

  private getReservedKey(key: string) {
    return `reserved/${key}`;
  }

  public async fetchDomainInfo(domain: string, skipExpired: boolean = true) {
    const fetchKey = async (key: string) => {
      try {
        console.log("fetching", key);
        let file = await this.s3.send(
          new GetObjectCommand({
            Bucket: DOMAINS_BUCKET,
            Key: key,
          })
        );

        const content = await file.Body!.transformToString("utf8"); //  this.readText(file);
        console.log("file", content);

        const info = JSON.parse(content);

        if (skipExpired && info.expires && info.expires < Date.now()) {
          console.log("Reserved info expired", info);
          return undefined;
        }

        return info;
      } catch (e: any) {
        if (e.Code !== "NoSuchKey") throw e;
      }

      return undefined;
    };

    const key = this.getDomainKey(domain);
    return (await fetchKey(key)) || (await fetchKey(this.getReservedKey(key)));
  }

  public async putDomainInfo(
    info: ValidSiteInfo,
    status: string,
    expires: number
  ) {
    const data = {
      domain: info.domain,
      site: info.site,
      pubkey: info.pubkey,
      status,
      timestamp: Date.now(),
      expires,
      // reset
      rendered: 0,
      updated: 0,
      fetched: 0,
    };

    let key = this.getDomainKey(data.domain);
    if (status === STATUS_RESERVED) key = this.getReservedKey(key);

    const content = JSON.stringify(data);
    const cs = Buffer.from(sha256(content)).toString("base64");
    console.log("putting", key);
    const cmd = new PutObjectCommand({
      Bucket: DOMAINS_BUCKET,
      Body: content,
      Key: key,
      ChecksumAlgorithm: "SHA256",
      ChecksumSHA256: cs,
    });
    const r = await this.s3.send(cmd);
    if (r.ChecksumSHA256 !== cs) throw new Error("Bad cs after upload");

    return data;
  }

  public async updateSiteBucketPolicy(distArn: string) {
    const bucketPolicy = await this.s3.send(
      new GetBucketPolicyCommand({
        Bucket: SITES_BUCKET,
      })
    );
    console.log("bucketPolicy", bucketPolicy);
    const policy = JSON.parse(bucketPolicy.Policy!);
    console.log("bucketPolicyJson", policy);
    const arn = distArn;
    const arns = policy.Statement[0].Condition.StringEquals["aws:SourceArn"];
    if (!arns.includes(arn)) arns.push(arn);
    console.log("updated bucketPolicyJson", policy);

    const bucketPolicyResponse = await this.s3.send(
      new PutBucketPolicyCommand({
        Bucket: SITES_BUCKET,
        Policy: JSON.stringify(policy),
      })
    );
    console.log("bucketPolicyResponse", bucketPolicyResponse);
  }

  public async setCustomDomainMapping(mapping: {
    domain: string;
    sub: string;
  }) {
    const mappingResponse = await this.upload(
      CUSTOM_BUCKET,
      `${mapping.domain}.json`,
      JSON.stringify(mapping)
    );
    console.log("mappingResponse", mappingResponse);
  }
}
