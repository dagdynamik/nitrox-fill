// Static checks on site/: the service worker precaches every file, every file the page references
// exists, nothing uses a root-absolute path (GitHub Pages serves the app under /<repo>/), and the
// manifest is valid. Run: node scripts/check.mjs
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, resolve, posix } from "node:path";
import { runInNewContext } from "node:vm";

const root = resolve(import.meta.dirname, "..", "site");
const errors = [];

// Dotfiles are skipped: actions/upload-pages-artifact leaves them out of the deployed site.
const walk = d => readdirSync(d).filter(f => !f.startsWith(".")).flatMap(f =>
  statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [relative(root, join(d, f)).split("\\").join("/")]);
const files = walk(root);

// A reference we should check: a relative path into the site. Returns the normalised path, or null
// for anything that is not a local file (data:, http(s):, mailto:, protocol-relative, fragment-only).
function localPath(ref, where) {
  ref = ref.trim();
  if (!ref || ref.startsWith("#") || ref.startsWith("//") || /^[a-z][a-z0-9+.-]*:/i.test(ref)) return null;
  if (ref.startsWith("/")) {
    errors.push(`${where} uses root-absolute path "${ref}"; GitHub Pages serves under /<repo>/, use a relative path`);
    return null;
  }
  let path;
  try { path = posix.normalize(decodeURI(ref.split(/[?#]/)[0])); }
  catch { errors.push(`${where} has a malformed reference "${ref}"`); return null; }
  if (path.startsWith("../")) { errors.push(`${where} references "${ref}" outside the site`); return null; }
  return path === "." || path === "./" ? "index.html" : path.replace(/^\.\//, "");
}

// --- service worker -------------------------------------------------------------------------------
const sw = readFileSync(join(root, "sw.js"), "utf8");
if (!/^const VERSION = .*$/m.test(sw)) errors.push("sw.js has no `const VERSION = ...` line for scripts/build.mjs to stamp");

const filesMatch = sw.match(/const FILES\s*=\s*(\[[\s\S]*?\])\s*;/);
let listed = [];
if (!filesMatch) errors.push("sw.js has no `const FILES = [...];` array");
else {
  try {
    // Evaluate the literal rather than JSON.parse it: tolerates single quotes, trailing commas, comments.
    listed = runInNewContext(`(${filesMatch[1]})`, Object.create(null), { timeout: 1000 });
    if (!Array.isArray(listed) || !listed.every(f => typeof f === "string")) throw new Error("not an array of strings");
  } catch (e) {
    errors.push(`sw.js FILES is not a plain array of strings: ${e.message}`);
    listed = [];
  }
}
const seen = new Set();
for (const f of listed) {
  if (seen.has(f)) errors.push(`sw.js FILES lists ${f} twice`);
  seen.add(f);
  const p = localPath(f, "sw.js FILES");
  if (p && !files.includes(p)) errors.push(`sw.js FILES lists missing file: ${f}`);
}
const precached = new Set(listed.map(f => localPath(f, "sw.js FILES")).filter(Boolean));
for (const f of files) if (f !== "sw.js" && !precached.has(f)) errors.push(`site/${f} is not in sw.js FILES (it won't work offline)`);
if (!listed.includes("./")) errors.push('sw.js FILES should include "./" so the start URL works offline');

// --- manifest -------------------------------------------------------------------------------------
let manifest = {};
try { manifest = JSON.parse(readFileSync(join(root, "manifest.webmanifest"), "utf8")); }
catch (e) { errors.push(`manifest.webmanifest is not valid JSON: ${e.message}`); }
for (const k of ["name", "short_name", "start_url", "display", "icons"]) if (!manifest[k]) errors.push(`manifest is missing ${k}`);
for (const k of ["start_url", "scope"]) if (manifest[k]?.startsWith("/")) errors.push(`manifest ${k} "${manifest[k]}" is root-absolute; use "./" for GitHub Pages`);
for (const i of manifest.icons ?? []) {
  const p = localPath(i.src ?? "", "manifest icon");
  if (p && !files.includes(p)) errors.push(`manifest icon missing: ${i.src}`);
}
if (!(manifest.icons ?? []).some(i => i.sizes?.split(/\s+/).includes("512x512"))) errors.push("manifest needs a 512x512 icon");

// --- index.html -----------------------------------------------------------------------------------
// One pass over href="", src="" (either quote) and url() with optional quotes; each reference checked once.
const html = readFileSync(join(root, "index.html"), "utf8");
const refRe = /\b(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)')|url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"'\s]*))\s*\)/gi;
for (const m of html.matchAll(refRe)) {
  const ref = m.slice(1).find(g => g !== undefined);
  const p = localPath(ref, "index.html");
  if (p && !files.includes(p)) errors.push(`index.html references missing file: ${ref}`);
}
// navigator.serviceWorker.register("sw.js"), possibly through an alias (const sw = navigator.serviceWorker).
const reg = html.includes("serviceWorker") && html.match(/\.register\(\s*["'`]([^"'`]+\.js)["'`]/);
if (!reg) errors.push('index.html does not register the service worker (expected .register("sw.js"))');
else {
  const p = localPath(reg[1], "serviceWorker.register");
  if (p && !files.includes(p)) errors.push(`index.html registers a missing service worker: ${reg[1]}`);
}

if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
console.log(`OK: ${files.length} files, all precached, all references resolve, manifest valid`);
