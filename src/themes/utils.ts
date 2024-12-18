import fs from "fs";
import { bundleCss } from "../css";

export async function prepareContentBuffer(path: string) {
  const isCss = path.toLowerCase().endsWith(".css");
  if (isCss) {
    const bundle = await bundleCss(path);
    return Buffer.from(bundle, "utf-8");
  }
  return fs.readFileSync(path);
}
