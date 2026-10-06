#!/usr/bin/env python3
"""Headless smoke test: load the packed tool, open a Mount Analysis PDF, run a scenario.

Usage: python3 harness.py <packed.html> [pdf] [--shot out.png] [--script snippet.js]
"""
import argparse, asyncio, os, pathlib, sys
from playwright.async_api import async_playwright

HERE = pathlib.Path(__file__).resolve().parent
WRAP = HERE / "_wrapped.html"


def wrap(packed: pathlib.Path) -> pathlib.Path:
    """The artifact source carries no <html> skeleton — add one so a browser can load it."""
    body = packed.read_text(encoding="utf-8")
    WRAP.write_text(
        "<!doctype html><html><head></head><body>\n" + body + "\n</body></html>",
        encoding="utf-8",
    )
    return WRAP


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("packed")
    ap.add_argument("pdf", nargs="?")
    ap.add_argument("--shot")
    ap.add_argument("--script")
    ap.add_argument("--pdf2", help="a second PDF, fed to the as-built import")
    ap.add_argument("--wait", type=int, default=4000)
    ap.add_argument("--download-dir")
    a = ap.parse_args()

    page_html = wrap(pathlib.Path(a.packed))
    logs, errors = [], []
    async with async_playwright() as p:
        browser = await p.chromium.launch(args=["--no-sandbox"])
        ctx = await browser.new_context(
            viewport={"width": 1600, "height": 1000},
            accept_downloads=True,
        )
        page = await ctx.new_page()
        saved = []

        async def grab(dl):
            dest = pathlib.Path(a.download_dir or ".") / dl.suggested_filename
            await dl.save_as(str(dest))
            saved.append(str(dest))

        page.on("download", lambda dl: asyncio.create_task(grab(dl)))
        page.on("console", lambda m: logs.append(f"{m.type}: {m.text}"[:400]))
        page.on("pageerror", lambda e: errors.append(str(e)[:400]))
        await page.goto(page_html.as_uri())
        await page.wait_for_timeout(2500)

        if a.pdf:
            await page.set_input_files("#file", a.pdf)
            await page.wait_for_timeout(a.wait)

        if a.pdf2:
            await page.evaluate("maPanelOpen(true); maSetTab('import');")
            await page.set_input_files("#maFile", a.pdf2)
            await page.wait_for_timeout(6000)

        result = None
        if a.script:
            snippet = pathlib.Path(a.script).read_text(encoding="utf-8")
            result = await page.evaluate(f"(async()=>{{{snippet}}})()")
            await page.wait_for_timeout(4000)

        if a.shot:
            await page.screenshot(path=a.shot, full_page=False)
        await browser.close()

    print("=== page errors ===")
    for e in errors:
        print(" !", e)
    print("=== console (last 40) ===")
    for l in logs[-40:]:
        print("  ", l)
    if result is not None:
        print("=== script result ===")
        print(result)
    if saved:
        print("=== downloaded ===")
        for f in saved:
            print(" ", f)
    sys.exit(1 if errors else 0)


asyncio.run(main())
