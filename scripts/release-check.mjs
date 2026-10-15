#!/usr/bin/env node
/* Does this working copy look like a release that was actually finished?
 *
 * Ced: "Always update the repo for this tool every update."
 *
 * The repo falling behind is not a thing anyone decides to do — it is a thing that happens when the
 * interesting work is done and the bookkeeping is the last item on a long list. So the bookkeeping
 * gets a check of its own, and the check runs in CI, where forgetting is not an option.
 *
 * It asserts only the MECHANICAL half of a release: the version moved, both targets build, the two
 * packers agree, the changelog has a section for this version, and nothing is uncommitted. The
 * half it cannot assert — that the seven test suites were run and were green — is asserted by CI
 * running them on the same push.
 *
 *   node scripts/release-check.mjs
 */
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const fail = [];
const note = [];

function read(p) {
  return readFileSync(join(ROOT, p), "utf8");
}
function git(...args) {
  try {
    return execFileSync("git", ["-C", ROOT, ...args], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

/* ---- 1. the version moved, and the changelog says what it is ----------------------------------- */
const pkg = JSON.parse(read("package.json"));
const major = String(pkg.version).split(".")[0];
note.push(`version ${pkg.version}`);

const log = read("docs/CHANGELOG.md");
if (!new RegExp(`^## v${major}\\b`, "m").test(log)) {
  fail.push(`docs/CHANGELOG.md has no "## v${major}" section — the version in package.json is ` +
            `v${major}, so either the changelog was not written or the version was not bumped.`);
}
/* and the newest section in the file is this one, not one above it */
const first = (log.match(/^## v(\d+)/m) || [])[1];
if (first && Number(first) !== Number(major)) {
  fail.push(`docs/CHANGELOG.md leads with v${first} but package.json says v${major} — ` +
            `a newer section was written above an older one, or the bump was missed.`);
}

/* v60 — the version the TOOL reports (guard.js, shown in Help and in every "Copy details" report)
   is the version the repo says it is. Two numbers that can drift will; this one is checked. */
{
  const g = read("src/guard.js").match(/MIU_VERSION\s*=\s*"([^"]+)"/);
  if (!g) fail.push("src/guard.js has no MIU_VERSION — the tool would not be able to say what version it is.");
  else if (g[1] !== pkg.version)
    fail.push(`src/guard.js says MIU_VERSION ${g[1]} but package.json says ${pkg.version} — bump both.`);
}

/* ---- 2. both targets exist, and they are the two different shapes ------------------------------ */
const web = "public/index.html", art = "dist/mark-it-up.artifact.html";
for (const f of [web, art]) {
  if (!existsSync(join(ROOT, f))) {
    fail.push(`${f} is missing — run \`node build.mjs --target=both\` before releasing.`);
  }
}
if (existsSync(join(ROOT, web)) && existsSync(join(ROOT, art))) {
  const strip = s => s.replace(/<!--[\s\S]*?-->/g, "");
  const w = strip(read(web)), a = strip(read(art));
  if (!/<html[\s>]/i.test(w)) {
    fail.push(`${web} has no <html> — the web target must be a complete document; Vercel serves it ` +
              `as the page.`);
  }
  if (/<html[\s>]/i.test(a)) {
    fail.push(`${art} has an <html> — the artifact target must be a FRAGMENT; claude.ai supplies ` +
              `the skeleton, and a nested document renders in quirks mode.`);
  }
  for (const f of [web, art]) {
    const kb = statSync(join(ROOT, f)).size / 1024;
    note.push(`${f} ${kb.toFixed(0)} KB`);
    if (kb < 400) fail.push(`${f} is only ${kb.toFixed(0)} KB — a packed build is well over a megabyte, ` +
                            `so this one is missing its blobs.`);
  }
}

/* ---- 3. every source the packer reads is older than the build it produced ---------------------- */
/* The commonest way to publish the wrong thing is to edit a source and publish yesterday's build. */
if (existsSync(join(ROOT, art))) {
  const built = statSync(join(ROOT, art)).mtimeMs;
  const stale = [];
  for (const f of execFileSync("ls", [join(ROOT, "src")], { encoding: "utf8" }).trim().split("\n")) {
    const p = join(ROOT, "src", f);
    if (statSync(p).mtimeMs > built) stale.push(f);
  }
  if (stale.length) {
    fail.push(`these sources are newer than ${art}: ${stale.join(", ")} — rebuild before releasing.`);
  }
}

/* ---- 4. the tree is committed ------------------------------------------------------------------ */
const dirty = git("status", "--porcelain");
if (dirty === null) {
  note.push("not a git checkout — skipping the commit check");
} else if (dirty) {
  fail.push("the working tree has uncommitted changes:\n    " +
            dirty.split("\n").slice(0, 12).join("\n    "));
} else {
  const head = git("log", "-1", "--pretty=%s");
  note.push(`HEAD: ${head}`);
  if (head && !new RegExp(`^v${major}\\b`).test(head)) {
    fail.push(`HEAD is "${head}" but this is v${major} — the release commit is missing.`);
  }
}

/* ---- 5. a remote to push to -------------------------------------------------------------------- */
/* Not fatal: the repo is useful without one. But it is the thing that was missing for five versions
   while every one of them was "committed", so it says so out loud rather than staying quiet. */
const remote = git("remote");
if (dirty !== null && !remote) {
  note.push("NO GIT REMOTE — nothing has been pushed anywhere. `git remote add origin <url>` " +
            "and push, or the repo exists only on this machine.");
}

/* ---- say so ------------------------------------------------------------------------------------ */
for (const n of note) console.log("  ·", n);
if (fail.length) {
  console.error("\nrelease-check: NOT READY\n");
  for (const f of fail) console.error("  ✗ " + f);
  console.error("");
  process.exit(1);
}
console.log("\nrelease-check: ok — version, changelog, both targets, freshness and the commit.");
