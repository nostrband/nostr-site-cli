export const AWSRegion = "eu-north-1";
export const AWSEdgeRegion = "us-east-1";

export const STATUS_DEPLOYED = "deployed";
export const STATUS_RESERVED = "reserved";
export const STATUS_RELEASED = "released";

export const KIND_PROFILE = 0;
export const KIND_CONTACTS = 3;
export const KIND_DELETE = 5;
export const KIND_RELAYS = 10002;
export const KIND_FILE = 1063;
export const KIND_PACKAGE = 1036;
export const KIND_THEME = 30514;
export const KIND_PLUGIN = 30515;
export const KIND_ZAP_SPLIT = 1512;
export const KIND_NOTE = 1;
export const KIND_LONG_NOTE = 30023;

export const LABEL_THEME = "theme";
export const LABEL_ONTOLOGY = "org.nostrsite.ontology";

export const OPENSATS_PUBKEY =
  "787338757fc25d65cd929394d5e7713cf43638e8d259e8dcf5c73b834eb851f2";
export const NPUB_PRO_PUBKEY =
  "08eade50df51da4a42f5dc045e35b371902e06d6a805215bec3d72dc687ccb04";

export const ENGINE = "pro.npub.v1";

export const SITES_BUCKET = "npub.pro";
export const DOMAINS_BUCKET = "domains.npub.pro";
export const CUSTOM_BUCKET = "custom.npub.pro";

export const LAMBDA_DOMAIN_TO_PATH =
  "arn:aws:lambda:us-east-1:945458476897:function:subDomainToS3Path:17";
export const LAMBDA_HANDLE_403 =
  "arn:aws:lambda:us-east-1:945458476897:function:subDomain403Handler:11";

export const CF_OAC_ID = "E36XDTETWYD652";
export const CF_CACHE_POLICY_ID = "658327ea-f89d-4fab-a63d-7e88639e58f6";
export const CF_RESPONSE_HEADER_POLICY_ID =
  "5cc3b908-e619-4b99-88e5-2cf7f45965bd";

export const AWS_GLOBAL_ACCEL_IPS = ["75.2.103.62", "35.71.169.8"];

export const LB_LISTENER_ARN =
  "arn:aws:elasticloadbalancing:us-east-1:945458476897:listener/app/TestEC2/f1119f64affd9926/de35c314bced9a29";

export const NPUB_PRO_API = "https://api.npubpro.com";
export const NPUB_PRO_DOMAIN = "npub.pro";

export const ZAPRITE_API = "https://api.zaprite.com";

export const OTP_TTL = 300000; // 5 minutes

export const DEFAULT_BLOSSOM_SERVERS = [
  // trying it as default server
  "https://blossom.npubpro.com/",
  "https://cdn.nostrcheck.me/",
  // kieran
  //  "https://nostr.download/",
  // our server, w/ discovery enabled
  //"https://blossom.npubpro.com/",
  // doesn't return proper mime type
  // "https://cdn.satellite.earth/",
  // no longer accepts non-media uploads
  //  "https://files.v0l.io/",
  // dropped our files
  //  "https://blossom.nostr.hu/",
  // doesn't whitelist our pubkey :(
  //  "https://cdn.hzrd149.com/",
  // doesn't whitelist our pubkey :(
  //  "https://media-server.slidestr.net/",
];

export const DEFAULT_RELAYS = [
  "wss://relay.damus.io/",
  "wss://nos.lol/",
  "wss://relay.npubpro.com/",
];

export const OUTBOX_RELAYS = [
  "wss://purplepag.es",
  "wss://user.kindpag.es",
  "wss://relay.nos.social",
];

export const BLACKLISTED_RELAYS = [
  // doesn't return EOSE, always have to wait for timeout
  "wss://nostr.mutinywallet.com",
  "wss://brb.io",
  "wss://relay.current.fyi",
  "wss://localhost/",
  "wss://localhost:",
  "ws://localhost/",
  "ws://localhost:",
  "wss://127.0.0.1/",
  "wss://127.0.0.1:",
  "ws://127.0.0.1/",
  "ws://127.0.0.1:",
];

export const BROADCAST_RELAYS = ["wss://nostr.mutinywallet.com/"];

export const SITE_RELAY = "wss://relay.npubpro.com";
export const SITE_RELAYS = [SITE_RELAY, "wss://relay.nostr.band/all"];

export const INDEX_URL = "https://cdn.npubpro.com/index.js";

export const POW_PERIOD = 3600000; // 1h
export const MIN_POW = 11;
export const SESSION_TTL = 30 * 24 * 3600; // 1 month

export const DOMAINS_PERIOD = 3600000; // 1h
export const MAX_DOMAINS_PER_IP = 10;
