"""Table tab:coefficients: fit a linear model and write its coefficients.

TeXWriter runs this script with the project folder as the working directory and turns the
CSV it writes into the LaTeX table. Run it from the table's Run button, or with Run all.
Replace this with your own model: anything that writes a CSV to TEXWRITER_OUTPUT works
(pandas: df.to_csv(os.environ["TEXWRITER_OUTPUT"], index=False)).
"""
import csv
import math
import os

OUTPUT = os.environ.get("TEXWRITER_OUTPUT", "outputs/coefficients.csv")


def load(sample):
    """Rows of the observations file for one sample ('train' or 'holdout')."""
    with open("data/observations.csv", newline="") as f:
        return [r for r in csv.DictReader(f) if r["sample"] == sample]


def solve(a, b):
    """Solve a x = b for a small square system (Gauss-Jordan elimination)."""
    n = len(b)
    m = [row[:] + [b[i]] for i, row in enumerate(a)]
    for c in range(n):
        p = max(range(c, n), key=lambda r: abs(m[r][c]))
        m[c], m[p] = m[p], m[c]
        for r in range(n):
            if r != c:
                k = m[r][c] / m[c][c]
                m[r] = [x - k * y for x, y in zip(m[r], m[c])]
    return [m[i][n] / m[i][i] for i in range(n)]


def fit(rows):
    """Ordinary least squares of y on an intercept, x1 and x2. Returns estimates and standard errors."""
    X = [[1.0, float(r["x1"]), float(r["x2"])] for r in rows]
    y = [float(r["y"]) for r in rows]
    k = len(X[0])
    xtx = [[sum(x[i] * x[j] for x in X) for j in range(k)] for i in range(k)]
    xty = [sum(x[i] * v for x, v in zip(X, y)) for i in range(k)]
    beta = solve(xtx, xty)
    resid = [v - sum(b * xi for b, xi in zip(beta, x)) for x, v in zip(X, y)]
    sigma2 = sum(e * e for e in resid) / (len(y) - k)
    # standard errors: sqrt of the diagonal of sigma^2 (X'X)^-1
    se = [math.sqrt(sigma2 * solve(xtx, [1.0 if j == i else 0.0 for j in range(k)])[i]) for i in range(k)]
    return beta, se


if __name__ == "__main__":
    beta, se = fit(load("train"))
    os.makedirs(os.path.dirname(OUTPUT) or ".", exist_ok=True)
    with open(OUTPUT, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["Term", "Estimate", "Std. error", "t value"])
        for name, b, s in zip(["Intercept", "x1", "x2"], beta, se):
            w.writerow([name, b, s, b / s])
    print(f"wrote {OUTPUT}")
