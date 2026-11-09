// Copies site/ to _site/ and stamps the release version into it:
//   - sw.js: `const VERSION = ...` becomes "nitrox-fill-<version>", so every release gets a new cache
//     and reaches installed phones (required: the build fails if the line is missing);
//   - index.html: every "__APP_VERSION__" becomes <version> (optional: no placeholder, no change).
// Usage: node scripts/build.mjs [version]   (defaults to "dev"; works from any cwd)
import { cpSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const repo = resolve(import.meta.dirname, "..");
const src = join(repo, "site");
const out = join(repo, "_site");
const version = (process.argv[2] || "dev").replace(/[^\w.-]/g, "-");

rmSync(out, { recursive: true, force: true });
cpSync(src, out, { recursive: true });

const swPath = join(out, "sw.js");
const sw = readFileSync(swPath, "utf8");
const stamped = sw.replace(/^const VERSION = .*$/m, `const VERSION = "nitrox-fill-${version}";`);
if (stamped === sw && !sw.includes(`const VERSION = "nitrox-fill-${version}";`)) throw new Error("VERSION line not found in sw.js");
writeFileSync(swPath, stamped);

const htmlPath = join(out, "index.html");
const html = readFileSync(htmlPath, "utf8");
const placeholders = html.split("__APP_VERSION__").length - 1;
writeFileSync(htmlPath, html.replaceAll("__APP_VERSION__", version));

console.log(`Built _site/ as nitrox-fill-${version} (${placeholders} __APP_VERSION__ placeholder(s) stamped)`);
