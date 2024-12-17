import fs from "fs";
import archiver from "archiver";

export async function zipSiteDir(dir: string, file: string) {
  console.log("zipping", dir);
  const tmp = "~zip" + Math.random();
  const output = fs.createWriteStream(tmp);
  const archive = archiver("zip");
  await new Promise<void>((ok, err) => {
    output.on("close", function () {
      console.log(archive.pointer() + " total bytes");
      console.log(
        "archiver has been finalized and the output file descriptor has closed."
      );
      ok();
    });

    // good practice to catch warnings (ie stat failures and other non-blocking errors)
    archive.on("warning", function (e) {
      console.warn("warning", e);
      // if (err.code === "ENOENT") {
      //   // log warning
      // } else {
      //   // throw error
      //   throw err;
      // }
    });

    archive.on("error", function (e) {
      err(e);
    });

    archive.pipe(output);
    // both index.html and 404 must be same files
    // that only bootstrap the renderer
    archive.file(dir + "/__404.html", { name: "404.html" });
    archive.file(dir + "/__404.html", { name: "index.html" });
    archive.file(dir + "/.well-known/nostr.json", {
      name: ".well-known/nostr.json",
    });
    archive.file(dir + "/robots.txt", { name: "robots.txt" });
    archive.file(dir + "/manifest.webmanifest", {
      name: "manifest.webmanifest",
    });
    archive.file(dir + "/sw.js", { name: "sw.js" });
    archive.finalize();
  });

  fs.renameSync(tmp, file);
}