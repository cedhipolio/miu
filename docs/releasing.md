# Releasing

Ced: *"Always update the repo for this tool every update."*

The repo had fallen five versions behind while every one of them was described as "committed" — the
commits existed, there was no remote, and nothing had ever left the machine. This is the checklist
that stops that, and `npm run release:check` is the half of it a script can enforce.

## Every published version

Run these in order. Nothing here is optional, and the last two are the ones that get skipped.

```bash
export MIU_FIXTURE="test/fixtures/<a real site package>.pdf"

# 1. build both targets and prove the two packers agree
node build.mjs --target=both
npm run verify:packers

# 2. the five suites — all of them, every time
npm test                 # tools.py       · 215 checks
npm run test:wysiwyg     # wysiwyg.py     · marks, screen against export
npm run test:text        # textparity.py  · type, screen against export
npm run test:stamp       # stampparity.py · the COP stamp as a block
npm run test:behave      # behave.py      · twelve behaviours, real mouse and keyboard

for s in v19 v14 v12; do
  python3 test/harness.py dist/mark-it-up.artifact.html "$MIU_FIXTURE" \
    --script "test/scenarios/scenario_$s.js"
done

# 3. bump the version and write the changelog section for it
#    package.json "version": "<N>.0.0"   ·   docs/CHANGELOG.md "## v<N>" at the top

# 4. the bookkeeping check — it will tell you which of the above you skipped
npm run release:check

# 5. commit with the version as the first word of the subject, and PUSH
git add -A && git commit -m "v<N> — <what changed>"
git push
```

## What `release:check` asserts

- `package.json`'s version moved, and `docs/CHANGELOG.md` has a `## v<N>` section — **at the top**,
  not written underneath an older one.
- Both targets exist, and they are the two different shapes: the web build a complete document, the
  artifact build a fragment. Publishing one as the other is the mistake this catches — a web build
  published to claude.ai renders a nested document in quirks mode, and an artifact build served from
  a web server has no `<head>`.
- Neither build is implausibly small, which is what a packer that silently dropped its blobs looks
  like.
- **No source in `src/` is newer than the build.** Editing a source and then publishing yesterday's
  build is the commonest way to ship the wrong thing, and the file dates say so for free.
- The working tree is committed, and `HEAD`'s subject starts with the version.
- Whether there is a remote at all. Not fatal — a repo with no remote is still a repo — but it says
  so out loud every run, because that is exactly the thing that went unnoticed.

It does **not** assert that the suites passed; it cannot see that. CI runs them on the same push,
which is where that is caught.

## Pushing

The repo has no remote yet. To give it one:

```bash
git remote add origin git@github.com:<you>/mark-it-up.git
git push -u origin main
```

A Claude session can only push for you if GitHub is linked to it — Settings → Connectors → GitHub on
claude.ai. Without that link a session can commit locally and hand you a zip, which is what happened
for v37 through v42, and the commits are all there waiting in the history.

## What never goes in

- **Fixture PDFs.** `.gitignore` excludes every `*.pdf`. The documents the suite runs against are
  live client site packages — site numbers, addresses, carrier and vendor names, engineers'
  signatures. They are not ours to publish, not even in a private repo someone may be added to
  later. They go in `test/fixtures/`, which is ignored wholesale, and the suite is pointed at one
  with `MIU_FIXTURE`.
- **Build output.** `public/` and `dist/` are generated; committing them puts 1.5 MB of base64 in
  every diff.
