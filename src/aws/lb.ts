import {
  AddListenerCertificatesCommand,
  DescribeListenersCommand,
  ElasticLoadBalancingV2Client,
} from "@aws-sdk/client-elastic-load-balancing-v2";
import { AWSEdgeRegion, LB_LISTENER_ARN } from "../common/const";

export class LB {
  private lb = new ElasticLoadBalancingV2Client({ region: AWSEdgeRegion });

  public async addCertToListener(certId: string) {
    const command = new AddListenerCertificatesCommand({
      ListenerArn: LB_LISTENER_ARN, // required
      Certificates: [
        // CertificateList // required
        {
          // Certificate
          CertificateArn: certId,
        },
      ],
    });
    const lbResponse = await this.lb.send(command);
    console.log("lbResponse", lbResponse);
  }

  public async describeListener(arnn: string) {
    const command = new DescribeListenersCommand({
      // LoadBalancerNames: ["TestEC2"]
      LoadBalancerArn:
        "arn:aws:elasticloadbalancing:us-east-1:945458476897:loadbalancer/app/TestEC2/f1119f64affd9926",
    });
    const response = await this.lb.send(command);
    console.log("lbResponse", response);
    return response;
  }
}
