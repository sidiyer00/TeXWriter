"""A very small vector PDF writer for report figures (no matplotlib needed).

Coordinates are in points with the origin at the bottom-left of the page.
"""
from __future__ import annotations

import math
from typing import Sequence


class Canvas:
    def __init__(self, width: float, height: float) -> None:
        self.w, self.h = width, height
        self.ops: list[str] = []

    def _c(self, rgb: Sequence[float]) -> str:
        return " ".join(f"{v:.3f}" for v in rgb)

    def line(self, x1, y1, x2, y2, rgb=(0, 0, 0), width=0.6, dash: Sequence[float] | None = None) -> None:
        d = f"[{' '.join(str(x) for x in dash)}] 0 d" if dash else "[] 0 d"
        self.ops.append(f"q {self._c(rgb)} RG {width} w {d} {x1:.2f} {y1:.2f} m {x2:.2f} {y2:.2f} l S Q")

    def polyline(self, pts, rgb=(0, 0, 0), width=1.0) -> None:
        if not pts:
            return
        p = " ".join(f"{x:.2f} {y:.2f} {'m' if i == 0 else 'l'}" for i, (x, y) in enumerate(pts))
        self.ops.append(f"q {self._c(rgb)} RG {width} w {p} S Q")

    def circle(self, cx, cy, r, fill=(0, 0, 0), stroke=None, width=0.8) -> None:
        k = 0.5523 * r
        path = (
            f"{cx + r:.2f} {cy:.2f} m "
            f"{cx + r:.2f} {cy + k:.2f} {cx + k:.2f} {cy + r:.2f} {cx:.2f} {cy + r:.2f} c "
            f"{cx - k:.2f} {cy + r:.2f} {cx - r:.2f} {cy + k:.2f} {cx - r:.2f} {cy:.2f} c "
            f"{cx - r:.2f} {cy - k:.2f} {cx - k:.2f} {cy - r:.2f} {cx:.2f} {cy - r:.2f} c "
            f"{cx + k:.2f} {cy - r:.2f} {cx + r:.2f} {cy - k:.2f} {cx + r:.2f} {cy:.2f} c"
        )
        if fill is not None and stroke is not None:
            self.ops.append(f"q {self._c(fill)} rg {self._c(stroke)} RG {width} w {path} B Q")
        elif fill is not None:
            self.ops.append(f"q {self._c(fill)} rg {path} f Q")
        else:
            self.ops.append(f"q {self._c(stroke or (0, 0, 0))} RG {width} w {path} S Q")

    def text(self, x, y, s: str, size=8.0, rgb=(0.2, 0.2, 0.2), anchor="start", rotate=0.0) -> None:
        # Helvetica average glyph width ~0.5em for anchoring
        est = 0.52 * size * len(s)
        dx = {"start": 0, "middle": -est / 2, "end": -est}[anchor]
        esc = s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
        if rotate:
            c, sn = math.cos(math.radians(rotate)), math.sin(math.radians(rotate))
            tx = x - sn * 0 + c * dx
            ty = y + sn * dx
            self.ops.append(f"q BT {self._c(rgb)} rg /F1 {size} Tf {c:.4f} {sn:.4f} {-sn:.4f} {c:.4f} {tx:.2f} {ty:.2f} Tm ({esc}) Tj ET Q")
        else:
            self.ops.append(f"q BT {self._c(rgb)} rg /F1 {size} Tf {x + dx:.2f} {y:.2f} Td ({esc}) Tj ET Q")

    def save(self, path: str) -> None:
        content = "\n".join(self.ops).encode("latin-1", "replace")
        objs = [
            b"<< /Type /Catalog /Pages 2 0 R >>",
            b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {self.w:.0f} {self.h:.0f}] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>".encode(),
            b"<< /Length " + str(len(content)).encode() + b" >>\nstream\n" + content + b"\nendstream",
            b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
        ]
        out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
        offsets = []
        for i, o in enumerate(objs, start=1):
            offsets.append(len(out))
            out += f"{i} 0 obj\n".encode() + o + b"\nendobj\n"
        xref = len(out)
        out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode()
        for off in offsets:
            out += f"{off:010d} 00000 n \n".encode()
        out += f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
        with open(path, "wb") as fh:
            fh.write(out)


def reliability_diagram(path: str, pds: Sequence[float], drs: Sequence[float], intervals: Sequence[tuple[float, float]], flagged: Sequence[bool]) -> None:
    W, H = 360, 250
    c = Canvas(W, H)
    x0, x1, y0, y1 = 52, 340, 40, 232
    lo, hi = -4.0, -0.5  # log10 of 0.01% .. ~31.6%

    def tx(v: float) -> float:
        v = max(v, 10 ** lo)
        return x0 + (math.log10(v) - lo) / (hi - lo) * (x1 - x0)

    def ty(v: float) -> float:
        v = max(v, 10 ** lo)
        return y0 + (math.log10(v) - lo) / (hi - lo) * (y1 - y0)

    grey = (0.55, 0.53, 0.49)
    for e in (-4, -3, -2, -1):
        v = 10 ** e
        c.line(tx(v), y0, tx(v), y1, rgb=(0.9, 0.89, 0.87), width=0.5)
        c.line(x0, ty(v), x1, ty(v), rgb=(0.9, 0.89, 0.87), width=0.5)
        label = f"{v * 100:g}%"
        c.text(tx(v), y0 - 12, label, size=7.5, anchor="middle")
        c.text(x0 - 5, ty(v) - 2.5, label, size=7.5, anchor="end")
    c.line(x0, y0, x1, y0, rgb=grey, width=0.8)
    c.line(x0, y0, x0, y1, rgb=grey, width=0.8)
    c.line(x0, y0, x1, y1, rgb=grey, width=0.7, dash=(3, 3))
    c.text((x0 + x1) / 2, 10, "Average predicted PD", size=8.5, rgb=(0.1, 0.1, 0.1), anchor="middle")
    c.text(14, (y0 + y1) / 2, "Observed default rate", size=8.5, rgb=(0.1, 0.1, 0.1), anchor="middle", rotate=90)
    red = (0.70, 0.21, 0.12)
    for i, (p, d, (l, h), bad) in enumerate(zip(pds, drs, intervals, flagged)):
        col = red if bad else (0.1, 0.1, 0.09)
        x = tx(p)
        c.line(x, ty(max(l, 1e-4)), x, ty(min(h, 10 ** hi)), rgb=col, width=0.8)
        if d <= 0:
            c.circle(x, ty(1e-4), 3.0, fill=(1, 1, 1), stroke=col)
        else:
            c.circle(x, ty(d), 3.4 if bad else 3.0, fill=col)
        if bad:
            c.text(x + 7, ty(max(d, 1e-4)) - 2.5, f"Grade {i + 1}", size=7.5, rgb=red)
    c.save(path)
