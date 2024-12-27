// @ts-ignore
import { NostrSiteRenderer, parseAddr } from "libnostrsite";
import { INDEX_URL } from "../common/const";
import fs from "fs";
import path from "path";
import { getMime } from "../common/utils";
import { zipSiteDir } from "../zip";
import { S3 } from "../aws/s3";

function get404(naddr: string, site: { url: string }) {
  return `
<!doctype html>
<html lang="en">

<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta property="nostr:site"
    content="${naddr}" />

  <!-- assumed by many themes, we always bundle it -->
  <link rel="preload" as="script" href="https://code.jquery.com/jquery-3.5.1.min.js" crossorigin="anonymous"
    integrity="sha256-9/aliU8dGd2tb6OSsuzixeV4y/faTqgFtohetphbbj0=">
  <script type="module" crossorigin src="${INDEX_URL}"></script>
  <link rel="manifest" href="${site.url}manifest.webmanifest"></head>

<body>
  <script>
    function render() {
      let path = new URL(window.location.href).searchParams.get("__renderPath");
      console.log("path", path);
      if (path && path.startsWith("/")) {
        window.history.replaceState({}, null, path);
      } else {
        path = '';
      }
      window.nostrSite.renderCurrentPage(path);
      window.removeEventListener("load", render);
    };
    window.addEventListener("load", render);
  </script>

  <section id="__nostr_site_loading_modal">
    <div class="loader"></div>
  </section>
  <style>
    #__nostr_site_loading_modal {
      position: absolute;
      top: 0;
      left: 0;
      height: 100%;
      width: 100%;
      background-color: #fff;
      z-index: 1000000;
      display: block;
    }

    #__nostr_site_loading_modal .loader {
      width: 48px;
      height: 48px;
      border: 5px solid #bbb;
      border-bottom-color: transparent;
      border-radius: 50%;
      display: inline-block;
      box-sizing: border-box;
      animation: rotation 1s linear infinite;
      position: absolute;
      top: 50%;
      left: 50%;
      margin-left: -24px;
      margin-top: -24px;
    }

    @keyframes rotation {
      0% {
        transform: rotate(0deg);
      }

      100% {
        transform: rotate(360deg);
      }
    }
  </style>
</body>

</html>
`;
}

export async function renderWebsite(
  dir: string,
  naddr: string,
  onlyPathsOrLimit: string[] | number,
  preview?: boolean
) {
  if (dir.endsWith("/")) dir = dir.substring(0, dir.length - 1);

  const limit = onlyPathsOrLimit
    ? Number.isInteger(onlyPathsOrLimit)
      ? (onlyPathsOrLimit as number)
      : (onlyPathsOrLimit as string[]).length
    : 0;
  const onlyPaths =
    !limit && onlyPathsOrLimit ? (onlyPathsOrLimit as string[]) : [];
  console.log("renderWebsite", dir, naddr, limit, onlyPaths);

  // disable debug logging
  const loggers = {
    debug: console.debug,
    log: console.log,
  };
  console.debug = () => {};
  console.log = () => {};

  try {
    const addr = parseAddr(naddr);
    const renderer = new NostrSiteRenderer();
    await renderer.start({
      addr,
      mode: "ssr",
      ssrIndexScriptUrl: INDEX_URL,
      maxObjects: limit ? Math.max(limit, 100) : undefined,
    });
    console.warn(Date.now(), "renderer loaded site", renderer.settings);

    // sitemap
    const sitemapPaths: string[] = await renderer.getSiteMap(limit);
    const paths = sitemapPaths.filter(
      (p) => !onlyPaths.length || onlyPaths.includes(p)
    );
    console.warn("paths", paths);
    if (paths.length < onlyPaths.length)
      console.warn(
        "BAD paths",
        paths,
        "expected",
        onlyPaths,
        "sitemap",
        sitemapPaths
      );

    const site = renderer.settings!;

    // only write sitemap if we've loaded the whole site
    if (!limit) {
      const sitemap = sitemapPaths.map((p) => `${site.origin}${p}`).join("\n");
      fs.writeFileSync(`${dir}/sitemap.txt`, sitemap, { encoding: "utf-8" });
    }

    // FIXME later on read from file events!
    const robots = `
  User-agent: *
  Allow: /
  Sitemap: ${site.origin}${site.url}sitemap.txt
  `;
    fs.writeFileSync(`${dir}/robots.txt`, robots, { encoding: "utf-8" });

    // FIXME could we impring random revisions for each file?
    // also should we include the sw.js itself?
    // if sw.js could be omitted the we could include real hashes of index.js and manifest,
    // otherwise we probably should just force a revision by including random string
    // on every re-build of the files
    const rev = Date.now();
    const sw = `
    importScripts("${INDEX_URL}");
    self.nostrSite.startSW({ index: "${INDEX_URL}", precacheEntries: [{ url: "${INDEX_URL}", revision: "${rev}" }, { url: "${
      site.url
    }sw.js", revision: "${rev + 1}" }, { url: "${
      site.url
    }manifest.webmanifest", revision: "${rev + 2}" }] });
  `;
    fs.writeFileSync(`${dir}/sw.js`, sw, { encoding: "utf-8" });

    const man = {
      name: site.title,
      short_name: site.name,
      start_url: site.url,
      display: "standalone",
      background_color: "#ffffff",
      scope: site.url,
      description: site.description,
      theme_color: site.accent_color,
      icons: [
        // FIXME default icon => npub.pro icon!
        {
          src: site.icon || "",
          sizes: "192x192",
          type: getMime(site.icon),
        },
        {
          src: site.icon || "",
          sizes: "512x512",
          type: getMime(site.icon),
        },
      ],
    };
    fs.writeFileSync(`${dir}/manifest.webmanifest`, JSON.stringify(man), {
      encoding: "utf-8",
    });

    // nostr.json
    let nostrJson = JSON.stringify({
      names: {
        _: site.admin_pubkey,
      },
      relays: {},
    });
    const nostrJsonEvent = await renderer.fetchSiteFile(
      "/.well-known/nostr.json"
    );
    if (nostrJsonEvent) {
      try {
        JSON.parse(nostrJsonEvent.content);
        nostrJson = nostrJsonEvent.content;
      } catch (e) {
        console.error(
          "Invalid nostr.json file event",
          e,
          nostrJsonEvent.content
        );
      }
    }

    // nostr.json
    fs.mkdirSync(`${dir}/.well-known`, { recursive: true });
    fs.writeFileSync(`${dir}/.well-known/nostr.json`, nostrJson);

    // not-found handler.
    // we don't know if object actually doesn't exist or
    // if ssr just hasn't rendered it yet, so we shift the
    // responsibility to the client-side renderer by serving
    // this page. it's a sub with no content
    // that will do the rendering on the client and will
    // render proper 404 error if needed
    fs.writeFileSync(`${dir}/__404.html`, get404(naddr, site), {
      encoding: "utf-8",
    });

    // render using hbs and replace document.html
    for (const p of paths) {
      const { result, context } = await renderer.render(p);
      let file = p;
      if (file === "/") file = "/index";
      else if (file.endsWith("/")) file = file.substring(0, file.length - 1);
      if (!file.endsWith(".html")) file += ".html";
      const subDir = dir + path.dirname(file);
      console.warn("result html size", subDir, p, file, result.length);
      fs.mkdirSync(subDir, { recursive: true });
      fs.writeFileSync(dir + file, result, { encoding: "utf-8" });

      console.warn("context rss", p, renderer.hasRss(p), context.context);
      if (renderer.hasRss(p)) {
        const rssPath = p.endsWith("/") ? p + "rss/" : p + "/rss/";
        const rssFile = file.replace(".html", ".xml");
        console.log("rendering rss for", p, "at", rssFile);
        const { result } = await renderer.render(rssPath);
        console.warn(
          "result rss size",
          subDir,
          rssPath,
          rssFile,
          result.length
        );
        fs.writeFileSync(dir + rssFile, result, { encoding: "utf-8" });
      }
    }
    console.warn("done");

    // release it
    renderer.destroy();

    return renderer.settings;
  } catch (e) {
    throw e;
  } finally {
    console.log = loggers.log;
    console.debug = loggers.debug;
  }
}

export async function releaseWebsite(
  naddr: string,
  paths: number | string[],
  {
    preview = false,
    zip = false,
    domain = "",
  }: {
    preview?: boolean;
    zip?: boolean;
    domain?: string;
  } = {}
) {
  const isLimit = Number.isInteger(paths);
  console.log("release", {
    naddr,
    paths: isLimit ? paths : (paths as string[]).length,
    preview,
    zip,
    domain,
  });
  const dir = "tmp_" + Date.now();
  fs.mkdirSync(dir);
  console.warn(Date.now(), "dir", dir);

  const site = await renderWebsite(dir, naddr, paths, preview);
  console.warn(Date.now(), "origin", site!.origin);

  if (zip) {
    await zipSiteDir(dir, dir + "/dist.zip");
  }

  if (!domain) {
    const url = new URL(site!.origin.toLowerCase());
    if (!url.hostname.endsWith(".npub.pro"))
      throw new Error("Unknown subdomain");
    domain = url.hostname.split(".")[0];
  }

  const s3 = new S3();

  const deleteOldFiles = !paths || (!isLimit && !(paths as string[]).length);
  await s3.uploadWebsite(dir, domain, deleteOldFiles);

  //  fs.rmSync(dir, { recursive: true });
  console.warn(Date.now(), "done uploading", naddr, site!.origin);
}
