import http from "http";
import { parseSessionToken } from "../auth/token";
import { SESSION_TTL } from "../common/const";

export async function sendReply(
  res: http.ServerResponse,
  reply: any,
  status: number = 0
) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader(
    "Access-Control-Allow-Origin",
    res.req.headers["origin"] || "*"
  );
  res.setHeader("Access-Control-Allow-Methods", "*");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Authorization, X-NpubPro-Token, Content-Type"
  );
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.writeHead(status || 200);
  res.end(JSON.stringify(reply));
}

export function getReqUrl(req: http.IncomingMessage) {
  if (!req.url) throw new Error("No req url");
  return new URL(req.url, "http://localhost");
  //  return "https://" + req.headers["host"] + req.url;
}

export function getIp(req: http.IncomingMessage) {
  // @ts-ignore
  // FIXME only check x-real-ip if real ip is our nginx!
  return req.headers["x-real-ip"] || req.socket.address().address;
}

export async function readBody(req: http.IncomingMessage) {
  return Promise.race([
    new Promise<string>((ok) => {
      let d = "";
      req.on("data", (chunk) => (d += chunk));
      req.on("end", () => ok(d));
    }),
    new Promise<string>((_, err) =>
      setTimeout(() => err("Body read timeout"), 5000)
    ),
  ]);
}

export async function sendError(
  res: http.ServerResponse,
  msg: string,
  status: number
) {
  console.error("error", msg);
  sendReply(res, { error: msg }, status);
}

export function parseSession(req: http.IncomingMessage) {
  const token = (req.headers["x-npubpro-token"] as string) || "";
  const data = parseSessionToken(token);
  console.log("token", token, "data", data);
  if (!data) return undefined;
  if (Date.now() / 1000 - data.timestamp > SESSION_TTL) return undefined;
  return data.pubkey;
}

export async function serverRun(
  host: string,
  port: number,
  listener: (
    req: http.IncomingMessage,
    res: http.ServerResponse
  ) => Promise<void>
) {
  const server = http.createServer(listener);
  server.listen(port, host, () => {
    console.log(`Server is running on http://${host}:${port}`);
  });
  return new Promise(() => {});
}
