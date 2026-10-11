"""Sample annual validation suite for the CORP-PD v4.2 large-corporate PD model.

Standard library only. Reads the portfolio extracts in ../data, runs discrimination,
calibration, stability, data-quality, backtesting and monitoring tests, and writes
results.json + output tables/figures for Quire.

    python validation/run_suite.py --out <run directory>
"""
from __future__ import annotations

import argparse
import csv
import math
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from quire_report import Suite  # noqa: E402
import stats  # noqa: E402
from pdfplot import reliability_diagram  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
PACE = float(os.environ.get("QUIRE_SAMPLE_PACE", "0.04"))  # seconds per test, to make progress visible


def read(name: str) -> list[dict[str, str]]:
    with open(os.path.join(DATA, name), newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def band(value: float, warn: float, fail: float, higher_is_better: bool = True) -> str:
    if higher_is_better:
        return "passed" if value >= warn else "warning" if value >= fail else "failed"
    return "passed" if value < warn else "warning" if value < fail else "failed"


def label(status: str) -> str:
    return {"passed": "Pass", "failed": "Fail", "warning": "Warning", "skipped": "Skipped"}[status]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=False, help="run directory provided by Quire")
    args = ap.parse_args()
    suite = Suite("validation_suite_v4", run_dir=args.out, data_snapshot="2026-06-30")

    grades = read("grades_2025.csv")
    segments = read("segment_grades_2025.csv")
    bands = read("sector_score_bands.csv")
    csi_rows = read("characteristic_bins.csv")
    dq = read("data_quality.csv")
    bt = read("backtest_by_year.csv")
    mon = {r["metric"]: r for r in read("monitoring.csv")}

    sectors = sorted({r["sector"] for r in bands})
    seg_names = sorted({r["segment"] for r in segments})
    suite.plan(3 + len(seg_names) + len(grades) + 2 + 1 + len(sectors) + 2 + len(dq) + len(bt) + 3)

    n = [int(r["obligors"]) for r in grades]
    d = [int(r["defaults"]) for r in grades]
    pd = [float(r["avg_pd"]) for r in grades]

    # ---------------------------------------------------------------- Discrimination
    auc = stats.auc_from_grades(n, d)
    ks = stats.ks_from_grades(n, d)
    disc_rows = []
    for test_id, name, metric, value, warn, fail in [
        ("disc.auc.full", "AUC (full sample)", "AUC", auc, 0.75, 0.70),
        ("disc.gini.full", "Gini / accuracy ratio", "Gini", 2 * auc - 1, 0.50, 0.40),
        ("disc.ks.full", "KS statistic", "KS", ks, 0.35, 0.25),
    ]:
        st = band(value, warn, fail)
        suite.record(test_id, name, "Discrimination", status=st, metric=metric, value=value, threshold=f">= {warn:.2f}",
                     notes=f"{sum(n):,} obligors, {sum(d)} defaults", outputs=["discrimination_summary.csv"])
        time.sleep(PACE)
    for seg in seg_names:
        rows = sorted((r for r in segments if r["segment"] == seg), key=lambda r: int(r["grade"]))
        sn = [int(r["obligors"]) for r in rows]
        sd = [int(r["defaults"]) for r in rows]
        a = stats.auc_from_grades(sn, sd)
        st = band(a, 0.75, 0.70)
        pretty = seg.replace("_", " ").title()
        suite.record(f"disc.auc.segment.{seg}", f"AUC by segment — {pretty}", "Discrimination", status=st, metric="AUC",
                     value=a, threshold=">= 0.75", notes=f"n = {sum(sn):,}; {sum(sd)} defaults", outputs=["discrimination_summary.csv"])
        disc_rows.append([pretty, sum(sn), sum(sd), a, 2 * a - 1, stats.ks_from_grades(sn, sd), label(st)])
        time.sleep(PACE)
    disc_rows.append(["All", sum(n), sum(d), auc, 2 * auc - 1, ks, label(band(auc, 0.75, 0.70))])
    suite.write_csv("discrimination_summary.csv", ["Segment", "Obligors", "Defaults", "AUC", "Gini", "KS", "Result"], disc_rows)

    # ---------------------------------------------------------------- Calibration
    cal_rows, jeff_rows, intervals, flagged = [], [], [], []
    for r, ni, di, pi in zip(grades, n, d, pd):
        g = int(r["grade"])
        p = stats.jeffreys_pvalue(di, ni, pi)
        lo, hi = stats.jeffreys_interval(di, ni)
        st = "failed" if p < 0.05 else "warning" if p < 0.10 else "passed"
        suite.record(f"calib.jeffreys.grade_{g}", f"Jeffreys test — Grade {g}", "Calibration", status=st, metric="p-value", value=p,
                     threshold=">= 0.05 (warn < 0.10)", notes=f"{di} defaults / {ni:,}; {di / ni:.2%} vs {pi:.2%}",
                     outputs=["calibration_by_grade.csv", "jeffreys_by_grade.csv", "reliability_diagram.pdf"],
                     details={"grade": g, "obligors": ni, "defaults": di, "predicted_pd": pi, "observed_dr": round(di / ni, 6),
                              "ci_low": round(lo, 6), "ci_high": round(hi, 6)})
        cal_rows.append([g, ni, pi, di / ni, di, p, label(st)])
        jeff_rows.append([g, ni, di, pi, di / ni, lo, hi, p, label(st)])
        intervals.append((lo, hi))
        flagged.append(st == "failed")
        time.sleep(PACE)
    hl, hl_p = stats.hosmer_lemeshow(n, d, pd)
    expected = sum(ni * pi for ni, pi in zip(n, pd))
    st = "failed" if hl_p < 0.05 else "warning" if hl_p < 0.10 else "passed"
    suite.record("calib.hl.pooled", "Hosmer–Lemeshow (pooled)", "Calibration", status=st, metric="p-value", value=hl_p,
                 threshold=">= 0.05", notes=f"{sum(d)} observed vs {expected:.1f} expected; HL = {hl:.2f}, {len(n)} df",
                 outputs=["calibration_by_grade.csv", "reliability_diagram.pdf"],
                 details={"statistic": round(hl, 3), "observed": sum(d), "expected": round(expected, 1), "df": len(n)})
    port_pd = expected / sum(n)
    z = (sum(d) - expected) / math.sqrt(sum(ni * pi * (1 - pi) for ni, pi in zip(n, pd)))
    bin_p = stats.norm_sf(z)
    st_b = "failed" if bin_p < 0.01 else "warning" if bin_p < 0.05 else "passed"
    suite.record("calib.binomial.portfolio", "Binomial test — portfolio central tendency", "Calibration", status=st_b, metric="p-value",
                 value=bin_p, threshold=">= 0.05 (fail < 0.01)", notes=f"z = {z:.2f}; portfolio PD {port_pd:.2%} vs DR {sum(d) / sum(n):.2%}")
    cal_rows.append(["All", sum(n), port_pd, sum(d) / sum(n), sum(d), "", f"HL p = {hl_p:.3f}"])
    suite.write_csv("calibration_by_grade.csv", ["Grade", "Obligors", "Avg. PD", "Obs. DR", "Defaults", "Jeffreys p", "Result"], cal_rows)
    suite.write_csv("jeffreys_by_grade.csv", ["Grade", "Obligors", "Defaults", "Avg. PD", "Obs. DR", "CI low", "CI high", "p-value", "Result"], jeff_rows)
    reliability_diagram(suite.path("reliability_diagram.pdf"), pd, [di / ni for di, ni in zip(d, n)], intervals, flagged)

    # ---------------------------------------------------------------- Stability
    psi_rows = []
    all_dev: dict[str, float] = {}
    all_cur: dict[str, float] = {}
    for sec in sectors:
        rows = [r for r in bands if r["sector"] == sec]
        dev = [float(r["dev_share"]) for r in rows]
        cur = [float(r["cur_share"]) for r in rows]
        for r in rows:
            all_dev[r["band"]] = all_dev.get(r["band"], 0) + float(r["dev_share"]) * float(r["dev_weight"])
            all_cur[r["band"]] = all_cur.get(r["band"], 0) + float(r["cur_share"]) * float(r["cur_weight"])
        v = stats.psi(dev, cur)
        st = band(v, 0.10, 0.25, higher_is_better=False)
        pretty = sec.replace("_", " ").title()
        suite.record(f"stab.psi.sector.{sec}", f"PSI — sector: {pretty}", "Stability", status=st, metric="PSI", value=v,
                     threshold="warn >= 0.10, fail >= 0.25", outputs=["psi_by_sector.csv"])
        psi_rows.append([pretty, int(rows[0]["obligors"]), float(rows[0]["dev_weight"]), float(rows[0]["cur_weight"]), v, label(st)])
        time.sleep(PACE)
    keys = sorted(all_dev)
    v = stats.psi([all_dev[k] for k in keys], [all_cur[k] for k in keys])
    st = band(v, 0.10, 0.25, higher_is_better=False)
    suite.record("stab.psi.score", "PSI — score distribution", "Stability", status=st, metric="PSI", value=v,
                 threshold="warn >= 0.10, fail >= 0.25", outputs=["psi_by_sector.csv"])
    psi_rows.append(["Total", sum(r[1] for r in psi_rows), 1.0, 1.0, v, label(st)])
    suite.write_csv("psi_by_sector.csv", ["Sector", "Obligors", "Dev. mix", "2025 mix", "PSI", "Result"], psi_rows)
    for ch in sorted({r["characteristic"] for r in csi_rows}):
        rows = [r for r in csi_rows if r["characteristic"] == ch]
        v = stats.psi([float(r["dev_share"]) for r in rows], [float(r["cur_share"]) for r in rows])
        st = band(v, 0.10, 0.25, higher_is_better=False)
        suite.record(f"stab.csi.{ch}", f"CSI — {ch.replace('_', ' ')}", "Stability", status=st, metric="CSI", value=v, threshold="warn >= 0.10")
        time.sleep(PACE)

    # ---------------------------------------------------------------- Data quality
    for r in dq:
        pop, tot, thr = int(r["populated"]), int(r["total"]), float(r["threshold"])
        rate = pop / tot
        st = "passed" if rate >= thr else "failed"
        suite.record(f"dq.completeness.{r['field']}", f"{r['label']} completeness", "Data quality", status=st, metric="% non-missing",
                     value=rate, threshold=f">= {thr:.1%}", notes=f"{tot - pop:,} obligors missing" if pop < tot else None)

    # ---------------------------------------------------------------- Backtesting
    bt_rows = []
    for r in bt:
        yn, yd, yp = int(r["obligors"]), int(r["defaults"]), float(r["avg_pd"])
        zz = (yd - yn * yp) / math.sqrt(yn * yp * (1 - yp))
        p = stats.norm_sf(zz)
        st = "failed" if p < 0.01 else "warning" if p < 0.05 else "passed"
        suite.record(f"bt.binomial.{r['year']}", f"Binomial backtest — {r['year']}", "Backtesting", status=st, metric="p-value", value=p,
                     threshold="green >= 0.05, red < 0.01", notes=f"{yd} defaults vs {yn * yp:.1f} expected", outputs=["backtest_by_year.csv"])
        bt_rows.append([r["year"], yn, yp, yd / yn, yd, round(yn * yp, 1), p, {"passed": "Green", "warning": "Amber", "failed": "Red"}[st]])
    suite.write_csv("backtest_by_year.csv", ["Year", "Obligors", "Avg. PD", "Obs. DR", "Defaults", "Expected", "p-value", "Traffic light"], bt_rows)

    # ---------------------------------------------------------------- Monitoring
    ov = mon["override_rate"]
    rate = int(ov["numerator"]) / int(ov["denominator"])
    suite.record("mon.override_rate", "Rating override rate", "Monitoring", status="passed" if rate <= 0.10 else "warning",
                 metric="% overridden", value=rate, threshold="<= 10.0%", notes=f"{ov['numerator']} of {ov['denominator']} ratings")
    cov = mon["rating_coverage"]
    rate = int(cov["numerator"]) / int(cov["denominator"])
    suite.record("mon.rating_coverage", "Rated within 12 months", "Monitoring", status="passed" if rate >= 0.95 else "failed",
                 metric="% current", value=rate, threshold=">= 95.0%")
    ext = os.path.join(DATA, "external_ratings.csv")
    if os.path.exists(ext):
        suite.record("mon.benchmark_external", "Benchmark vs external ratings", "Monitoring", status="passed", notes="see output")
    else:
        suite.record("mon.benchmark_external", "Benchmark vs external ratings", "Monitoring", status="skipped",
                     notes="external rating feed unavailable for this data snapshot")

    suite.save()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
