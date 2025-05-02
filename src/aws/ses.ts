import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { AWSRegion } from "../common/const";

export class SES {
  private ses = new SESv2Client({ region: AWSRegion });

  async sendEmail(fromArn: string, fromEmail: string, email: string, subject: string, body: string) {
    const input = { // SendEmailRequest
      FromEmailAddress: fromEmail,
      FromEmailAddressIdentityArn: fromArn,
      Destination: { // Destination
        ToAddresses: [ // EmailAddressList
          email,
        ],
        CcAddresses: [
        ],
        BccAddresses: [
        ],
      },
      ReplyToAddresses: [
//        "STRING_VALUE",
      ],
//      FeedbackForwardingEmailAddress: "STRING_VALUE",
//      FeedbackForwardingEmailAddressIdentityArn: "STRING_VALUE",
      Content: { // EmailContent
        Simple: { // Message
          Subject: { // Content
            Data: subject, // required
            Charset: "UTF-8",
          },
          Body: { // Body
            Text: {
              Data: body, // required
              Charset: "UTF-8",
            },
            Html: {
              Data: `<html><body><h5>${body}</h5></body></html>`, // required
              Charset: "UTF-8",
            },
          },
          Headers: [ // MessageHeaderList
            // { // MessageHeader
            //   Name: "STRING_VALUE", // required
            //   Value: "STRING_VALUE", // required
            // },
          ],
        },
        // Raw: { // RawMessage
        //   Data: new Uint8Array(), // e.g. Buffer.from("") or new TextEncoder().encode("")       // required
        // },
        // Template: { // Template
        //   TemplateName: "STRING_VALUE",
        //   TemplateArn: "STRING_VALUE",
        //   TemplateContent: { // EmailTemplateContent
        //     Subject: "STRING_VALUE",
        //     Text: "STRING_VALUE",
        //     Html: "STRING_VALUE",
        //   },
        //   TemplateData: "STRING_VALUE",
        //   Headers: [
        //     {
        //       Name: "STRING_VALUE", // required
        //       Value: "STRING_VALUE", // required
        //     },
        //   ],
        // },
      },
      EmailTags: [ // MessageTagList
        // { // MessageTag
        //   Name: "STRING_VALUE", // required
        //   Value: "STRING_VALUE", // required
        // },
      ],
      // ConfigurationSetName: "STRING_VALUE",
      // EndpointId: "STRING_VALUE",
      // ListManagementOptions: { // ListManagementOptions
      //   ContactListName: "STRING_VALUE", // required
      //   TopicName: "STRING_VALUE",
      // },
    };
    console.log("input", input);
    const command = new SendEmailCommand(input);
    const response = await this.ses.send(command);
    console.log("send response", response);

    return response;
  }
}