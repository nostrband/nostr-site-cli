import {
  CloudFrontClient,
  CreateDistributionCommand,
  CreateDistributionCommandInput,
  DistributionSummary,
  ListDistributionsCommand,
} from "@aws-sdk/client-cloudfront";
import {
  AWSRegion,
  CF_CACHE_POLICY_ID,
  CF_OAC_ID,
  CF_RESPONSE_HEADER_POLICY_ID,
  LAMBDA_DOMAIN_TO_PATH,
  LAMBDA_HANDLE_403,
  SITES_BUCKET,
} from "../common/const";

export interface CreatedDistribution {
  ARN?: string;
  DomainName?: string;
  Status?: string;
}

export class CF {
  private cf = new CloudFrontClient({ region: AWSRegion });

  public async createSiteDistribution({
    certId,
    aliases,
  }: {
    certId: string;
    aliases: string[];
  }): Promise<CreatedDistribution> {
    const bucketId = `${SITES_BUCKET}.s3.${AWSRegion}.amazonaws.com`;
    const conf: CreateDistributionCommandInput = {
      DistributionConfig: {
        CallerReference: "" + Date.now(),
        Comment: "",
        Enabled: true,
        DefaultRootObject: "",
        HttpVersion: "http2and3",
        DefaultCacheBehavior: {
          TargetOriginId: bucketId,
          CachePolicyId: CF_CACHE_POLICY_ID,
          ResponseHeadersPolicyId: CF_RESPONSE_HEADER_POLICY_ID,
          ViewerProtocolPolicy: "redirect-to-https",
          Compress: true,
          AllowedMethods: {
            Items: ["GET", "HEAD", "OPTIONS"],
            Quantity: 3,
            CachedMethods: {
              Items: ["GET", "HEAD", "OPTIONS"],
              Quantity: 3,
            },
          },
          // NOTE: not needed bcs we use CachePolicyId
          // MinTTL: 0,
          // MaxTTL: 31536000,
          // DefaultTTL: 86400,
          // ForwardedValues: {
          //   QueryString: false,
          //   Cookies: {
          //     Forward: "none",
          //   },
          //   Headers: {
          //     Quantity: 0,
          //   },
          //   QueryStringCacheKeys: {
          //     Quantity: 0,
          //   },
          // },
          LambdaFunctionAssociations: {
            Quantity: 2,
            Items: [
              {
                EventType: "viewer-request",
                LambdaFunctionARN: LAMBDA_DOMAIN_TO_PATH,
              },
              {
                EventType: "origin-response",
                LambdaFunctionARN: LAMBDA_HANDLE_403,
              },
            ],
          },
        },
        Aliases: {
          Items: aliases,
          Quantity: aliases.length,
        },
        ViewerCertificate: {
          CloudFrontDefaultCertificate: false,
          ACMCertificateArn: certId,
          SSLSupportMethod: "sni-only",
          MinimumProtocolVersion: "TLSv1.2_2021",
          Certificate: certId,
          CertificateSource: "acm",
        },
        Origins: {
          Items: [
            {
              DomainName: bucketId,
              Id: bucketId,
              ConnectionAttempts: 3,
              ConnectionTimeout: 10,
              OriginAccessControlId: CF_OAC_ID,
              S3OriginConfig: {
                OriginAccessIdentity: "",
              },
            },
          ],
          Quantity: 1,
        },
        PriceClass: "PriceClass_All",
      },
    };
    console.log("conf", JSON.stringify(conf));
    const distResponse = await this.cf.send(
      new CreateDistributionCommand(conf)
    );
    console.log("new dist", distResponse);
    return distResponse.Distribution!;

    // const viewerCertificate: ViewerCertificate = {
    //   CloudFrontDefaultCertificate: false,
    //   ACMCertificateArn:
    //     "arn:aws:acm:us-east-1:945458476897:certificate/e7147f46-d97d-4bfa-a2ab-9648f0550f78",
    //   SSLSupportMethod: "sni-only",
    //   MinimumProtocolVersion: "TLSv1.2_2021",
    //   Certificate:
    //     "arn:aws:acm:us-east-1:945458476897:certificate/e7147f46-d97d-4bfa-a2ab-9648f0550f78",
    //   CertificateSource: "acm",
    // };

    // const conf: CreateDistributionCommandInput = {
    //   DistributionConfig: {
    //     CallerReference: bucketName,
    //     Comment: "",
    //     Enabled: true,
    //     DefaultRootObject: "index.html",
    //     HttpVersion: "http2and3",
    //     DefaultCacheBehavior: {
    //       TargetOriginId: bucketId,
    //       ViewerProtocolPolicy: "redirect-to-https",
    //       Compress: true,
    //       MinTTL: 0,
    //       MaxTTL: 31536000,
    //       DefaultTTL: 86400,
    //       AllowedMethods: {
    //         Items: ["GET", "HEAD", "OPTIONS"],
    //         Quantity: 3,
    //         CachedMethods: {
    //           Items: ["GET", "HEAD"],
    //           Quantity: 2,
    //         },
    //       },
    //       ForwardedValues: {
    //         QueryString: false,
    //         Cookies: {
    //           Forward: "none",
    //         },
    //         Headers: {
    //           Quantity: 0,
    //         },
    //         QueryStringCacheKeys: {
    //           Quantity: 0,
    //         },
    //       },
    //     },
    //     Aliases: {
    //       Items: [bucketName],
    //       Quantity: 1,
    //     },
    //     ViewerCertificate: viewerCertificate,
    //     Origins: {
    //       Items: [
    //         {
    //           DomainName: bucketId,
    //           Id: bucketId,
    //           ConnectionAttempts: 3,
    //           ConnectionTimeout: 10,
    //           // OriginAccessControlId,
    //           S3OriginConfig: {
    //             OriginAccessIdentity: "",
    //           },
    //         },
    //       ],
    //       Quantity: 1,
    //     },
    //     PriceClass: "PriceClass_All",
    //   },
    // };
    // console.log("conf", JSON.stringify(conf));
    // return await this.cf.send(new CreateDistributionCommand(conf));
  }

  public async listDistributions() {
    const list: DistributionSummary[] = [];
    let marker: string | undefined;
    do {
      const listResponse = await this.cf.send(
        new ListDistributionsCommand({
          Marker: marker,
          MaxItems: 1000,
        })
      );
      if (!listResponse?.DistributionList?.Items)
        throw new Error("No distributions");
      console.log("listResponse", listResponse.DistributionList.Items.length);
      list.push(...listResponse.DistributionList.Items);
      marker = listResponse.DistributionList.Marker;
    } while (marker);

    return list;
  }

  public async getDistribution(aliases: string[]) {
    const list = await this.listDistributions();
    return list.find((d) => d.Aliases?.Items?.find((a) => aliases.includes(a)));
  }
}
