"""Figure fig:fit: fitted against observed values on the holdout sample.

Needs matplotlib (pip install matplotlib). TeXWriter runs this script and includes the PDF
it saves to TEXWRITER_OUTPUT.
"""
import os
import sys

from fit_model import fit, load  # the model script next to this one

OUTPUT = os.environ.get("TEXWRITER_OUTPUT", "outputs/fit.pdf")

try:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
except ImportError:
    sys.exit("This figure needs matplotlib: run  pip install matplotlib")

beta, _ = fit(load("train"))
holdout = load("holdout")
observed = [float(r["y"]) for r in holdout]
fitted = [beta[0] + beta[1] * float(r["x1"]) + beta[2] * float(r["x2"]) for r in holdout]

fig, ax = plt.subplots(figsize=(4.5, 4))
ax.scatter(fitted, observed, s=14, alpha=0.7)
lo, hi = min(fitted + observed), max(fitted + observed)
ax.plot([lo, hi], [lo, hi], color="black", linewidth=1, linestyle="--", label="y = x")
ax.set_xlabel("Fitted")
ax.set_ylabel("Observed")
ax.legend(frameon=False)
ax.grid(alpha=0.3)
os.makedirs(os.path.dirname(OUTPUT) or ".", exist_ok=True)
fig.savefig(OUTPUT, bbox_inches="tight")
print(f"wrote {OUTPUT}")
