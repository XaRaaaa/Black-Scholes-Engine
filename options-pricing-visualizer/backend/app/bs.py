"""Black‑Scholes pricing and Greeks implemented with JAX.

This module provides a small, well‑documented API for computing
European call/put prices and the standard Greeks (delta, gamma,
vega, theta, rho). The functions operate on JAX arrays so they can be
used with JIT/VMAP if desired.
"""

from typing import Dict, Tuple

import jax.numpy as jnp
from jax.scipy.special import erf

SUPPORTED_GREEKS = ("price", "delta", "gamma", "vega", "theta", "rho")


def _norm_cdf(x: jnp.ndarray) -> jnp.ndarray:
    """Standard normal cumulative distribution function.

    Args:
        x: Input array.

    Returns:
        CDF evaluated elementwise.
    """
    return 0.5 * (1.0 + erf(x / jnp.sqrt(2.0)))


def _norm_pdf(x: jnp.ndarray) -> jnp.ndarray:
    """Standard normal probability density function (elementwise)."""
    return jnp.exp(-0.5 * x * x) / jnp.sqrt(2.0 * jnp.pi)


def _d1_d2(
    spot: jnp.ndarray,
    strike: jnp.ndarray,
    rate: jnp.ndarray,
    vol: jnp.ndarray,
    time: jnp.ndarray,
    dividend: jnp.ndarray,
) -> Tuple[jnp.ndarray, jnp.ndarray, jnp.ndarray]:
    """Compute d1, d2 and sqrt(T) with numerical safeguards.

    Ensures time and volatility are floored to avoid division by zero
    or NaNs when values are extremely small.
    """
    time = jnp.maximum(time, 1e-8)
    vol = jnp.maximum(vol, 1e-12)
    sqrt_t = jnp.sqrt(time)
    d1 = (jnp.log(spot / strike) + (rate - dividend + 0.5 * vol * vol) * time) / (vol * sqrt_t)
    d2 = d1 - vol * sqrt_t
    return d1, d2, sqrt_t


def price_and_greeks(
    spot: jnp.ndarray,
    strike: jnp.ndarray,
    rate: jnp.ndarray,
    vol: jnp.ndarray,
    time: jnp.ndarray,
    dividend: jnp.ndarray,
    option_type: str,
) -> Dict[str, jnp.ndarray]:
    """Return price and Greeks for a call or put option.

    Args:
        spot: Spot price (may be scalar or array).
        strike: Strike price (scalar or array).
        rate: Risk-free rate (annualized).
        vol: Volatility (annualized).
        time: Time to expiry in years.
        dividend: Continuous dividend yield.
        option_type: "call" or "put".

    Returns:
        A dict with keys 'price','delta','gamma','vega','theta','rho', each
        mapped to a JAX array matching the broadcasted input shape.
    """
    d1, d2, sqrt_t = _d1_d2(spot, strike, rate, vol, time, dividend)
    disc_r = jnp.exp(-rate * time)
    disc_q = jnp.exp(-dividend * time)

    nd1 = _norm_cdf(d1)
    nd2 = _norm_cdf(d2)
    nmd1 = _norm_cdf(-d1)
    nmd2 = _norm_cdf(-d2)
    pdf = _norm_pdf(d1)

    call_price = spot * disc_q * nd1 - strike * disc_r * nd2
    put_price = strike * disc_r * nmd2 - spot * disc_q * nmd1

    gamma = disc_q * pdf / (spot * vol * sqrt_t)
    vega = spot * disc_q * pdf * sqrt_t

    call_delta = disc_q * nd1
    put_delta = disc_q * (nd1 - 1.0)

    call_theta = (
        -(spot * disc_q * pdf * vol) / (2.0 * sqrt_t)
        - rate * strike * disc_r * nd2
        + dividend * spot * disc_q * nd1
    )
    put_theta = (
        -(spot * disc_q * pdf * vol) / (2.0 * sqrt_t)
        + rate * strike * disc_r * nmd2
        - dividend * spot * disc_q * nmd1
    )

    call_rho = strike * time * disc_r * nd2
    put_rho = -strike * time * disc_r * nmd2

    if option_type == "call":
        price = call_price
        delta = call_delta
        theta = call_theta
        rho = call_rho
    else:
        price = put_price
        delta = put_delta
        theta = put_theta
        rho = put_rho

    return {
        "price": price,
        "delta": delta,
        "gamma": gamma,
        "vega": vega,
        "theta": theta,
        "rho": rho,
    }
