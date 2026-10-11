"""Tiny, dependency-free helper for writing Quire test-run results.

Quire runs your suite with a run directory (``--out``/``QUIRE_RUN_DIR``). The suite
writes ``results.json`` there plus any output files under ``outputs/``. Each recorded
test becomes a row in Quire's Test results view and can populate report content.

    from quire_report import Suite
    suite = Suite("validation_suite_v4")
    suite.record("disc.auc.full", "AUC (full sample)", "Discrimination",
                 status="passed", metric="AUC", value=0.812, threshold=">= 0.75")
    suite.write_csv("discrimination_summary.csv", ["Segment", "AUC"], rows)
    suite.save()
"""
from __future__ import annotations

import csv
import json
import os
import sys
from datetime import datetime, timezone
from typing import Any, Iterable, Sequence

STATUSES = {"passed", "failed", "warning", "skipped"}


class Suite:
    def __init__(self, name: str, run_dir: str | None = None, data_snapshot: str | None = None) -> None:
        self.name = name
        self.run_dir = run_dir or os.environ.get("QUIRE_RUN_DIR") or os.path.join(os.getcwd(), "quire-run")
        self.outputs_dir = os.path.join(self.run_dir, "outputs")
        os.makedirs(self.outputs_dir, exist_ok=True)
        self.data_snapshot = data_snapshot
        self.tests: list[dict[str, Any]] = []
        self._planned = 0

    # progress -------------------------------------------------------------
    def plan(self, n: int) -> None:
        """Declare how many tests will run so Quire can show progress."""
        self._planned = n

    def progress(self, label: str) -> None:
        done = len(self.tests)
        total = max(self._planned, done)
        print(f"QUIRE_PROGRESS {done}/{total} {label}", flush=True)

    # recording ------------------------------------------------------------
    def record(
        self,
        test_id: str,
        name: str,
        category: str,
        *,
        status: str,
        metric: str | None = None,
        value: float | int | str | None = None,
        threshold: str | None = None,
        notes: str | None = None,
        outputs: Sequence[str] = (),
        details: dict[str, Any] | None = None,
    ) -> None:
        if status not in STATUSES:
            raise ValueError(f"status must be one of {sorted(STATUSES)}, got {status!r}")
        if isinstance(value, float):
            value = round(value, 6)
        self.tests.append(
            {
                "id": test_id,
                "name": name,
                "category": category,
                "status": status,
                "metric": metric,
                "value": value,
                "threshold": threshold,
                "notes": notes,
                "outputs": [f"outputs/{o}" for o in outputs],
                "details": details or {},
                "finishedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            }
        )
        self.progress(name)

    # outputs --------------------------------------------------------------
    def path(self, filename: str) -> str:
        p = os.path.join(self.outputs_dir, filename)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        return p

    def write_csv(self, filename: str, header: Sequence[str], rows: Iterable[Sequence[Any]]) -> str:
        p = self.path(filename)
        with open(p, "w", newline="", encoding="utf-8") as fh:
            w = csv.writer(fh)
            w.writerow(header)
            for r in rows:
                w.writerow(["" if v is None else (round(v, 6) if isinstance(v, float) else v) for v in r])
        return p

    def save(self) -> str:
        p = os.path.join(self.run_dir, "results.json")
        with open(p, "w", encoding="utf-8") as fh:
            json.dump({"suite": self.name, "dataSnapshot": self.data_snapshot, "tests": self.tests}, fh, indent=2)
        counts = {s: sum(t["status"] == s for t in self.tests) for s in sorted(STATUSES)}
        print(f"Wrote {len(self.tests)} results to {p}: {counts}", file=sys.stderr, flush=True)
        return p
