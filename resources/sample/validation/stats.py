"""Standard-library statistics used by the sample validation suite."""
from __future__ import annotations

import math
from typing import Sequence


def _betacf(a: float, b: float, x: float) -> float:
    max_iter, eps, fpmin = 300, 3e-14, 1e-300
    qab, qap, qam = a + b, a + 1.0, a - 1.0
    c, d = 1.0, 1.0 - qab * x / qap
    d = 1.0 / (d if abs(d) > fpmin else fpmin)
    h = d
    for m in range(1, max_iter + 1):
        m2 = 2 * m
        aa = m * (b - m) * x / ((qam + m2) * (a + m2))
        d = 1.0 + aa * d
        d = 1.0 / (d if abs(d) > fpmin else fpmin)
        c = 1.0 + aa / c
        c = c if abs(c) > fpmin else fpmin
        h *= d * c
        aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2))
        d = 1.0 + aa * d
        d = 1.0 / (d if abs(d) > fpmin else fpmin)
        c = 1.0 + aa / c
        c = c if abs(c) > fpmin else fpmin
        de = d * c
        h *= de
        if abs(de - 1.0) < eps:
            break
    return h


def betainc(a: float, b: float, x: float) -> float:
    """Regularized incomplete beta I_x(a, b)."""
    if x <= 0:
        return 0.0
    if x >= 1:
        return 1.0
    lbt = math.lgamma(a + b) - math.lgamma(a) - math.lgamma(b) + a * math.log(x) + b * math.log1p(-x)
    bt = math.exp(lbt)
    if x < (a + 1) / (a + b + 2):
        return bt * _betacf(a, b, x) / a
    return 1.0 - bt * _betacf(b, a, 1 - x) / b


def beta_ppf(q: float, a: float, b: float) -> float:
    lo, hi = 0.0, 1.0
    for _ in range(100):
        mid = (lo + hi) / 2
        if betainc(a, b, mid) < q:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def gammainc_lower(a: float, x: float) -> float:
    """Regularized lower incomplete gamma P(a, x)."""
    if x <= 0:
        return 0.0
    if x < a + 1:
        term = total = 1.0 / a
        ap = a
        for _ in range(500):
            ap += 1
            term *= x / ap
            total += term
            if abs(term) < abs(total) * 1e-15:
                break
        return total * math.exp(-x + a * math.log(x) - math.lgamma(a))
    # continued fraction for Q
    b = x + 1 - a
    c = 1 / 1e-300
    d = 1 / b
    h = d
    for i in range(1, 500):
        an = -i * (i - a)
        b += 2
        d = an * d + b
        d = 1e-300 if abs(d) < 1e-300 else d
        c = b + an / c
        c = 1e-300 if abs(c) < 1e-300 else c
        d = 1 / d
        de = d * c
        h *= de
        if abs(de - 1) < 1e-15:
            break
    return 1.0 - math.exp(-x + a * math.log(x) - math.lgamma(a)) * h


def chi2_sf(x: float, k: int) -> float:
    return 1.0 - gammainc_lower(k / 2.0, x / 2.0)


def norm_sf(z: float) -> float:
    return 0.5 * math.erfc(z / math.sqrt(2))


def jeffreys_pvalue(defaults: int, obligors: int, pd: float) -> float:
    """One-sided Jeffreys test: small p means the PD under-predicts defaults."""
    return betainc(defaults + 0.5, obligors - defaults + 0.5, pd)


def jeffreys_interval(defaults: int, obligors: int, level: float = 0.95) -> tuple[float, float]:
    a, b = defaults + 0.5, obligors - defaults + 0.5
    alpha = (1 - level) / 2
    lo = 0.0 if defaults == 0 else beta_ppf(alpha, a, b)
    hi = 1.0 if defaults == obligors else beta_ppf(1 - alpha, a, b)
    return lo, hi


def hosmer_lemeshow(obligors: Sequence[int], defaults: Sequence[int], pds: Sequence[float]) -> tuple[float, float]:
    stat = sum((d - n * p) ** 2 / (n * p * (1 - p)) for n, d, p in zip(obligors, defaults, pds) if n > 0 and 0 < p < 1)
    return stat, chi2_sf(stat, len(obligors))


def auc_from_grades(obligors: Sequence[int], defaults: Sequence[int]) -> float:
    """AUC when higher grade index means higher risk; ties count one half."""
    goods = [n - d for n, d in zip(obligors, defaults)]
    total_d, total_g = sum(defaults), sum(goods)
    if total_d == 0 or total_g == 0:
        return float("nan")
    s, goods_below = 0.0, 0
    for d, g in zip(defaults, goods):
        s += d * (goods_below + 0.5 * g)
        goods_below += g
    return s / (total_d * total_g)


def ks_from_grades(obligors: Sequence[int], defaults: Sequence[int]) -> float:
    goods = [n - d for n, d in zip(obligors, defaults)]
    td, tg = sum(defaults), sum(goods)
    cd = cg = 0.0
    best = 0.0
    for d, g in zip(reversed(defaults), reversed(goods)):
        cd += d / td
        cg += g / tg
        best = max(best, abs(cd - cg))
    return best


def psi(expected: Sequence[float], actual: Sequence[float]) -> float:
    eps = 1e-6
    return sum((a - e) * math.log((a + eps) / (e + eps)) for e, a in zip(expected, actual))
