import fs from "fs";
import postcss from "postcss";
import postcssUrl from "postcss-url";
import postcssImport from "postcss-import";
// @ts-ignore
import postcssNestedImport from "postcss-nested-import";

export async function bundleCss(assetPath: string) {
  // const absPath = path.resolve(assetPath);
  const data = fs.readFileSync(assetPath, "utf-8");

  const result = await postcss()
    // must go first to merge all css into one
    .use(postcssImport())
    // same here
    .use(postcssNestedImport())
    // now we can inline urls of the merged css
    .use(
      // @ts-ignore
      postcssUrl({
        url: "inline",
      })
    )
    .process(data, {
      from: assetPath,
    });

  console.log(
    "bundled",
    assetPath,
    "from",
    data.length,
    "to",
    result.css.length
  );
  return result.css;
}
