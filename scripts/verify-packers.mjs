#!/usr/bin/env node
/**
 * Assert that build.mjs and build.py produce EQUIVALENT artifacts.
 *
 * They are not byte-identical and are not meant to be: Node's zlib and CPython's zlib choose
 * different deflate block boundaries for the same input. What has to match is everything the browser
 * actually sees — each inflated blob, and the HTML around the blobs. If those agree, the two packers
 * cannot disagree about behaviour, and whichever one you reach for locally is safe.
 *
 * Exits non-zero with the first mismatch named. Run by `npm run verify:packers` and by CI.
 */
import { execFileSync } from "node:child_process";
import { gunzipSync } from "node:zlib";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BLOB = /<script id="(pk-[a-z]+)" type="text\/plain">([A-Za-z0-9+/=]*)<\/script>/g;

/** split a packed file into {blobs: {id: inflated}, skeleton: html with blob bodies blanked} */
function dissect(html) {
  const blobs = {};
  const skeleton = html.replace(BLOB, (_, id, b64) => {
    blobs[id] = gunzipSync(Buffer.from(b64, "base64")).toString("utf8");
    return `<script id="${id}" type="text/plain">[[${id}]]</script>`;
  });
  return { blobs, skeleton };
}

const fail = (msg) => {
  console.error(`verify-packers: ${msg}`);
  process.exit(1);
};

const tmp = mkdtempSync(join(tmpdir(), "miu-verify-"));
try {
  execFileSync(process.execPath, [join(ROOT, "build.mjs"), "--target=artifact"], {
    cwd: ROOT,
    stdio: "inherit",
  });
  const pyOut = join(tmp, "from-python.html");
  execFileSync("python3", [join(ROOT, "build.py"), pyOut], { cwd: ROOT, stdio: "inherit" });

  const node = dissect(readFileSync(join(ROOT, "dist", "mark-it-up.artifact.html"), "utf8"));
  const py = dissect(readFileSync(pyOut, "utf8"));

  const ids = [...new Set([...Object.keys(node.blobs), ...Object.keys(py.blobs)])].sort();
  if (!ids.length) fail("no packed blobs found — has the <script type=\"text/plain\"> shape changed?");

  for (const id of ids) {
    if (!(id in node.blobs)) fail(`${id} is in the Python build but not the Node one`);
    if (!(id in py.blobs)) fail(`${id} is in the Node build but not the Python one`);
    if (node.blobs[id] !== py.blobs[id]) {
      const a = node.blobs[id], b = py.blobs[id];
      let i = 0;
      while (i < a.length && i < b.length && a[i] === b[i]) i++;
      fail(
        `${id} inflates differently (node ${a.length} chars, python ${b.length}); ` +
          `first difference at ${i}:\n  node: ${JSON.stringify(a.slice(i, i + 60))}\n` +
          `  py:   ${JSON.stringify(b.slice(i, i + 60))}`
      );
    }
  }

  if (node.skeleton !== py.skeleton) fail("the HTML around the blobs differs between the two builders");

  const bytes = ids.reduce((n, id) => n + Buffer.byteLength(node.blobs[id]), 0);
  console.log(
    `verify-packers: ok — ${ids.length} blobs, ${(bytes / 1048576).toFixed(2)} MB inflated, ` +
      `identical from both packers`
  );
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
