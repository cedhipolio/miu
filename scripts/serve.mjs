#!/usr/bin/env node
/**
 * A local static server for the built site, with no dependencies — `npm install` is never needed for
 * this repo and this script is not the place to start.
 *
 * It mirrors the two Vercel behaviours that matter while developing: `cleanUrls`, so /app serves
 * public/app.html exactly as it will in production, and the same single output directory. It also
 * watches src/ and site/ and rebuilds on change, so editing app.css and hitting reload is the loop.
 *
 *   node scripts/serve.mjs [--port 5173]
 */
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { watch } from "node:fs";
import { extname, join, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = join(ROOT, "public");
const argv = process.argv.slice(2);
const PORT = Number(argv[argv.indexOf("--port") + 1]) || Number(process.env.PORT) || 5173;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".json": "application/json; charset=utf-8",
  ".pdf": "application/pdf",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};

let building = false;
function build(why) {
  if (building) return;
  building = true;
  try {
    process.stdout.write(`\n[${new Date().toLocaleTimeString()}] rebuilding (${why})\n`);
    execFileSync(process.execPath, [join(ROOT, "build.mjs"), "--target=web"], {
      cwd: ROOT,
      stdio: "inherit",
    });
  } catch {
    process.stdout.write("build failed — the last good output is still being served\n");
  } finally {
    building = false;
  }
}

/* resolve a URL path to a file inside public/, the way `cleanUrls: true` does */
async function resolveFile(urlPath) {
  /* normalize() plus the prefix check is what keeps ../../etc/passwd out */
  const rel = normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, "");
  let p = join(PUBLIC, rel);
  if (!p.startsWith(PUBLIC)) return null;
  const tryPaths = [p];
  if (!extname(p)) tryPaths.push(`${p}.html`, join(p, "index.html"));
  if (urlPath === "/") tryPaths.unshift(join(PUBLIC, "index.html"));
  for (const candidate of tryPaths) {
    try {
      const s = await stat(candidate);
      if (s.isFile()) return candidate;
    } catch {
      /* next candidate */
    }
  }
  return null;
}

build("startup");

for (const dir of ["src", "site"]) {
  let t = null;
  watch(join(ROOT, dir), { recursive: true }, (_e, file) => {
    clearTimeout(t);
    t = setTimeout(() => build(`${dir}/${file}`), 120);
  });
}

createServer(async (req, res) => {
  const urlPath = new URL(req.url, "http://localhost").pathname;
  const file = await resolveFile(urlPath);
  if (!file) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end(`404 — nothing at ${urlPath}\n`);
    return;
  }
  const body = await readFile(file);
  res.writeHead(200, {
    "content-type": TYPES[extname(file)] || "application/octet-stream",
    "content-length": body.length,
    "cache-control": "no-store",
  });
  res.end(body);
}).listen(PORT, () => {
  console.log(`\n  Mark It Up — local\n  landing  http://localhost:${PORT}/\n  tool     http://localhost:${PORT}/app\n`);
});
