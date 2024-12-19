import dotenv from "dotenv";
dotenv.config({ path: "./.env.local" });

import WebSocket from "ws";
// @ts-ignore
global.WebSocket ??= WebSocket;

import { File, Blob } from "@web-std/file";
global.File = File;
global.Blob = Blob;

import { cliMain } from "./services/cli";
import { apiMain } from "./services/api";
import { billingMain } from "./services/billing";
import { ssrMain } from "./services/ssr";
import { dmMain } from "./services/dm";
import { testMain } from "./services/test";

// main
try {
  console.log(process.argv);
  const service = process.argv[2];
  const argv = process.argv.slice(3, process.argv.length);

  if (service === "cli") {
    cliMain(argv).then(() => process.exit());
  } else if (service === "api") {
    apiMain(argv).then(() => process.exit());
  } else if (service === "billing") {
    billingMain(argv).then(() => process.exit());
  } else if (service === "ssr") {
    ssrMain(argv).then(() => process.exit());
  } else if (service === "dm") {
    dmMain(argv).then(() => process.exit());
  } else if (service === "test") {
    testMain(argv).then(() => process.exit());
  }
} catch (e) {
  console.error(e);
}
