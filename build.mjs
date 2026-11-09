#!/usr/bin/env node
/**
 * Pack Mark It Up into one self-contained HTML file.
 *
 * Every asset is gzipped, base64'd into a <script type="text/plain"> block, and inflated at load by
 * the boot script in src/boot.html. The result has no network dependencies at all: pdf.js, its
 * worker, pdf-lib and the fonts are all inside the file.
 *
 * Two outputs, because the file is served two ways and they need different envelopes:
 *
 *   --target=web       public/index.html
 *                      A COMPLETE HTML DOCUMENT, with its own doctype, <html>, <head> and <body>.
 *                      This is what Vercel serves at /, and what a browser opens directly. There is
 *                      no landing page in front of it: the site IS the tool, so what a visitor sees
 *                      is the loading screen and then the opening screen, with nothing to click
 *                      through first.
 *
 *   --target=artifact  dist/mark-it-up.artifact.html
 *                      A FRAGMENT, with no skeleton. claude.ai's Artifact host wraps what it is given
 *                      in its own document, so a second <html> here produces a nested document and a
 *                      page that renders in quirks mode.
 *
 * `--target=both` (the default) writes both.
 *
 * This is the canonical builder: it is what CI and Vercel run, because Node is the one runtime both
 * are guaranteed to have. build.py is kept beside it for local work and for the Playwright suite.
 *
 * The two are EQUIVALENT, not byte-identical. Node's zlib and CPython's zlib are different builds and
 * pick different deflate block boundaries — measured on the CSS blob, 102,269 bytes against 102,371
 * for the same input — so the packed files differ while the thing that matters, every byte the
 * browser ends up running, does not. `npm run verify:packers` inflates both outputs and compares the
 * payloads and the surrounding HTML, which is the equality worth asserting.
 *
 * Each builder on its own IS reproducible: same source in, same bytes out, because neither writes a
 * timestamp into the gzip header.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "src");
const SITE = join(HERE, "site");

/* What goes into each blob, and in what order, lives in src/manifest.json — the ONE list, read by this
   file and by build.py alike. Until v60 each packer carried its own copy, and a file added to one and
   not the other was a build that differed by machine. */
const MANIFEST = JSON.parse(readFileSync(join(SRC, "manifest.json"), "utf8"));
const ASSETS = MANIFEST.blobs;
const OURS = MANIFEST.ours;

function checkSyntax() {
  for (const name of OURS) {
    try {
      execFileSync(process.execPath, ["--check", join(SRC, name)], { stdio: "pipe" });
    } catch (e) {
      process.stderr.write(String(e.stderr || e.message));
      throw new Error(`syntax error in src/${name}`);
    }
  }
}

/* The files are joined by a single newline — no trailing one — which is what build.py's
   `b"\n".join(...)` does, and the two outputs have to agree byte for byte.
   The build is reproducible: Node writes a zero MTIME into the gzip header, so the same source
   always gives the same bytes. (Python needs `mtime=0` passed explicitly for that; see build.py.) */
const NL = Buffer.from("\n");
const pack = (names) => {
  const raw = Buffer.concat(
    names.flatMap((n, i) => (i ? [NL, readFileSync(join(SRC, n))] : [readFileSync(join(SRC, n))]))
  );
  return gzipSync(raw, { level: 9 }).toString("base64");
};

function body() {
  const parts = [readFileSync(join(SRC, "shell.html"), "utf8")];
  for (const [id, names, attrs] of ASSETS) {
    /* v85 — a blob may carry attributes for its tag (pk-rfds: the RFDS build's title, sha and embed date) */
    const at = Object.entries(attrs || {}).map(([k, v]) => ` ${k}="${String(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"`).join("");
    parts.push(`<script id="${id}" type="text/plain"${at}>${pack(names)}</script>\n`);
  }
  parts.push(readFileSync(join(SRC, "boot.html"), "utf8"));
  return parts.join("");
}

/* The standalone envelope. `src/shell.html` opens with its own <meta charset>, viewport and <title>,
   which a browser hoists into the head on its own — but only after it has already begun parsing in
   whatever encoding it guessed. Declaring them here, before any content, removes the guess. */
function standalone(inner) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="dark light">
<meta name="robots" content="noindex">
<!-- no <link rel=icon> here on purpose: src/shell.html carries the app's own pen favicon as a data
     URL and swaps it at runtime (the workspace moves it into <head>, v86). A second icon link would race
     it. What a browser asks for before any script has run — /favicon.ico and /apple-touch-icon.png — is
     served from site/ (v86), so the tab is never the blank globe. -->
<title>Mark It Up</title>
</head>
<body>
${inner}
</body>
</html>
`;
}

function main() {
  const argv = process.argv.slice(2);
  const target = (argv.find((a) => a.startsWith("--target=")) || "--target=both").split("=")[1];
  if (!["web", "artifact", "both"].includes(target)) {
    throw new Error(`--target must be web, artifact or both (got ${target})`);
  }

  checkSyntax();
  const inner = body();
  const written = [];

  if (target === "web" || target === "both") {
    const out = join(HERE, "public");
    rmSync(out, { recursive: true, force: true });
    mkdirSync(out, { recursive: true });
    /* static files served beside the tool — the icon, and anything added later. There is deliberately
       no index.html in here: the tool is the index. */
    if (existsSync(SITE)) cpSync(SITE, out, { recursive: true });
    writeFileSync(join(out, "index.html"), standalone(inner));
    written.push(join(out, "index.html"));
  }

  if (target === "artifact" || target === "both") {
    const out = join(HERE, "dist");
    mkdirSync(out, { recursive: true });
    const p = join(out, "mark-it-up.artifact.html");
    writeFileSync(p, inner);
    written.push(p);
  }

  for (const p of written) {
    const buf = readFileSync(p);
    const mb = (buf.length / 1048576).toFixed(2);
    const sha = createHash("sha256").update(buf).digest("hex").slice(0, 12);
    console.log(`${resolve(p).replace(HERE + "/", "")}  ${mb} MB  sha256:${sha}`);
  }
}

main();
