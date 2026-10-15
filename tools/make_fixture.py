#!/usr/bin/env python3
"""Generate a SYNTHETIC mount analysis PDF for the test suites.

The real fixtures are client site packages and are never committed (see test/fixtures/README.md).
That left the audit job in CI permanently skipped, because nothing could run it without a client
document — so every suite only ever ran on one machine.

This writes a document with the same SHAPE as a mount analysis — a cover with a site block, an
"Antenna Loading" table with numeric cells, member/structure usage tables with a structural rating,
conclusions, drawing sheets with callout lines, and more than a dozen pages — but every name,
number and address in it is invented. It is safe to publish, and CI uses it.

    python3 tools/make_fixture.py test/fixtures/synthetic-mount-analysis.pdf

Needs reportlab (pip install reportlab). Deterministic: same script, same bytes.
"""
import sys
from reportlab.lib.pagesizes import letter, landscape
from reportlab.pdfgen import canvas

OUT = sys.argv[1] if len(sys.argv) > 1 else "test/fixtures/synthetic-mount-analysis.pdf"


def header(c, w, h, title, page):
    c.setFont("Helvetica-Bold", 14)
    c.drawString(54, h - 60, title)
    c.setFont("Helvetica", 8)
    c.drawString(54, h - 74, "EXAMPLE ENGINEERING GROUP  -  Sample Site SAMPLE-0001  -  100 Example Road, Sampleville")
    c.drawRightString(w - 54, 36, f"Page {page}")
    c.setLineWidth(0.6)
    c.line(54, h - 80, w - 54, h - 80)


def table(c, x, y, cols, rows, widths, fs=8.5, rh=15):
    c.setFont("Helvetica-Bold", fs)
    cx = x
    for i, t in enumerate(cols):
        c.drawString(cx + 3, y - 11, t)
        cx += widths[i]
    tw = sum(widths)
    c.setLineWidth(0.5)
    c.rect(x, y - rh * (len(rows) + 1), tw, rh * (len(rows) + 1))
    for r in range(1, len(rows) + 1):
        c.line(x, y - rh * r, x + tw, y - rh * r)
    cx = x
    for wdt in widths[:-1]:
        cx += wdt
        c.line(cx, y, cx, y - rh * (len(rows) + 1))
    c.setFont("Helvetica", fs)
    for r, row in enumerate(rows):
        cx = x
        for i, t in enumerate(row):
            c.drawString(cx + 3, y - rh * (r + 1) - 11, str(t))
            cx += widths[i]
    return y - rh * (len(rows) + 1)


def para(c, x, y, lines, fs=9.5, lead=13):
    c.setFont("Helvetica", fs)
    for ln in lines:
        c.drawString(x, y, ln)
        y -= lead
    return y


def main():
    c = canvas.Canvas(OUT, pagesize=letter, invariant=1)
    c.setTitle("Synthetic Mount Analysis - SAMPLE-0001")
    c.setAuthor("Mark It Up test suite")
    w, h = letter
    n = 1

    # 1 — cover
    header(c, w, h, "MOUNT ANALYSIS REPORT", n)
    y = para(c, 54, h - 120, [
        "Site Name: SAMPLE SITE ALPHA",
        "Site Number: SAMPLE-0001",
        "Site Address: 100 Example Road, Sampleville, XX 00000",
        "Structure Type: 150 ft Monopole",
        "Carrier: EXAMPLE WIRELESS",
        "Mount Type: Sector Frame (3) at 120 ft RAD Center",
        "",
        "Analysis Result: Mount PASSES with modifications",
        "Structural Rating: 87.4%",
    ], fs=11, lead=17)
    y = para(c, 54, y - 20, [
        "This report is a synthetic test document. Every name, address, number and result in it",
        "is invented for the Mark It Up test suite and does not describe any real structure.",
    ])
    c.showPage(); n += 1

    # 2 — loading table
    header(c, w, h, "ANTENNA LOADING", n)
    c.setFont("Helvetica-Bold", 11)
    c.drawString(54, h - 110, "Final Loading Configuration:")
    rows = []
    for s, az in (("A", 0), ("B", 120), ("C", 240)):
        rows += [
            [s, "120.0", "EXAMPLE", "ANT-8800-XL", "(3)", "Proposed", f"{az}"],
            [s, "120.0", "EXAMPLE", "RRH-4402", "(4)", "Proposed", f"{az}"],
            [s, "118.5", "EXAMPLE", "SURGE-12", "(1)", "Existing", f"{az}"],
        ]
    table(c, 54, h - 124, ["Sector", "RAD Center (ft)", "Mfr", "Model", "Qty", "Status", "Azimuth"],
          rows, [50, 85, 70, 110, 40, 70, 60])
    c.showPage(); n += 1

    # 3 — member usage + rating
    header(c, w, h, "STRUCTURE USAGES", n)
    rows = [[f"M{i}", ["Pipe 2.375x0.154", "Angle L2x2x3/16", "Plate 0.5x6"][i % 3],
             f"{40 + (i * 7) % 48}.{i % 10}%", "OK"] for i in range(1, 15)]
    yy = table(c, 54, h - 110, ["Member", "Section", "Usage", "Result"], rows, [80, 170, 90, 90])
    para(c, 54, yy - 30, ["Structural Rating: 87.4%  (Mount Pipe M7 governs)",
                          "Tower Loading: acceptable per the standard referenced in Section 2."], fs=10.5)
    c.showPage(); n += 1

    # 4 — conclusions
    header(c, w, h, "CONCLUSION AND RECOMMENDATIONS", n)
    para(c, 54, h - 120, [
        "1. The existing sector frames are adequate to support the proposed loading after the",
        "   modifications listed below are installed.",
        "2. Install (1) New Sector Frame per sector, part EX-SF-1200.",
        "3. Install (12) New Crossover Plate per sector, part EX-XP-7.",
        "4. Install (6) New Pipe per sector, part EX-P-30120.",
        "5. All bolts shall be torqued to the manufacturer's specification.",
        "6. Contractor shall verify existing conditions prior to installation.",
    ], fs=10.5, lead=16)
    c.showPage(); n += 1

    # 5..9 — drawing sheets (landscape) with callouts
    for d in range(5):
        c.setPageSize(landscape(letter))
        W, H = landscape(letter)
        header(c, W, H, f"MOUNT DRAWING SHEET S-{d + 1}", n)
        c.setLineWidth(1.2)
        cx, cy = W / 2 - 60, H / 2 - 20
        c.rect(cx - 140, cy - 90, 280, 180)
        c.line(cx - 140, cy, cx + 140, cy)
        c.line(cx, cy - 90, cx, cy + 90)
        c.circle(cx, cy, 34)
        c.setLineWidth(0.5)
        for i, lab in enumerate(["NEW PIPE (TYP)", "CROSSOVER PLATE", "EXISTING ANTENNA", "RRH UNIT"]):
            ty = cy + 80 - i * 50
            c.line(cx + 140, cy + 60 - i * 40, W - 230, ty)
            c.setFont("Helvetica", 9)
            c.drawString(W - 225, ty - 3, lab)
        c.rect(W - 200, 40, 150, 70)
        c.setFont("Helvetica", 7.5)
        c.drawString(W - 195, 96, f"SHEET S-{d + 1}")
        c.drawString(W - 195, 84, "SAMPLE-0001")
        c.drawString(W - 195, 72, "DRAWN: EX  CHECKED: EX")
        c.showPage(); n += 1

    # 10..16 — appendix calculation pages
    c.setPageSize(letter)
    for a in range(7):
        header(c, w, h, f"APPENDIX {chr(65 + a)} - CALCULATIONS", n)
        lines = [f"Load case {a + 1}.{k}: wind {90 + k * 5} mph, ice {k * 0.25:.2f} in, "
                 f"usage {50 + (a * 9 + k * 4) % 45}.{k}%" for k in range(1, 30)]
        para(c, 54, h - 110, lines, fs=9, lead=19)
        c.showPage(); n += 1

    c.save()
    print(f"{OUT}  {n - 1} pages")


if __name__ == "__main__":
    main()
