import json
import math
import os
import statistics
from typing import List, Optional
from urllib.error import URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import jax.numpy as jnp

from .bs import SUPPORTED_GREEKS, price_and_greeks


class OptionParams(BaseModel):
    spot: float = Field(..., gt=0)
    strike: float = Field(..., gt=0)
    rate: float = Field(..., ge=-1, le=1)
    vol: float = Field(..., gt=0)
    time: float = Field(..., gt=0)
    dividend: float = Field(0.0, ge=-1, le=1)
    option_type: str = Field("call")


class CurveParams(OptionParams):
    greek: str = Field("delta")
    spot_min: float = Field(..., gt=0)
    spot_max: float = Field(..., gt=0)
    points: int = Field(60, ge=20, le=400)


class HistoryParams(BaseModel):
    symbol: str = Field("AAPL", min_length=1, max_length=16)
    outputsize: str = Field("compact")


class OptionsParams(BaseModel):
    symbol: str = Field(..., min_length=1, max_length=16)
    expiration: Optional[str] = None


def _fetch_alpha_vantage_history(symbol: str, outputsize: str) -> dict[str, object]:
    api_key = os.getenv("ALPHAVANTAGE_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="ALPHAVANTAGE_API_KEY is not set on the backend",
        )

    query = urlencode(
        {
            "function": "TIME_SERIES_DAILY_ADJUSTED",
            "symbol": symbol,
            "outputsize": outputsize,
            "apikey": api_key,
        }
    )
    request = Request(
        f"https://www.alphavantage.co/query?{query}",
        headers={"User-Agent": "Mozilla/5.0"},
    )

    try:
        with urlopen(request, timeout=15) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except URLError as exc:
        raise HTTPException(status_code=502, detail="Alpha Vantage request failed") from exc

    if "Error Message" in payload:
        raise HTTPException(status_code=400, detail=payload["Error Message"])
    if "Note" in payload:
        raise HTTPException(status_code=429, detail=payload["Note"])

    series = payload.get("Time Series (Daily)")
    if not isinstance(series, dict):
        raise HTTPException(status_code=502, detail="Alpha Vantage returned no daily series")

    points = []
    for date, values in sorted(series.items()):
        points.append(
            {
                "date": date,
                "close": float(values["4. close"]),
                "adjusted_close": float(values["5. adjusted close"]),
                "volume": float(values["6. volume"]),
            }
        )

    meta = payload.get("Meta Data", {})
    result = {
        "symbol": symbol.upper(),
        "meta": meta,
        "points": points,
    }

    # Attach a small realized volatility estimate (30 days)
    try:
        rv = _realized_vol_from_points(points, window=30)
        if rv is not None:
            result["realized_vol"] = float(rv)
    except Exception:
        # keep history resilient; don't fail the whole request for vol calc issues
        pass

    return result


def _realized_vol_from_points(points: List[dict], window: int = 30) -> Optional[float]:
    """Compute annualized realized volatility from a list of price points.

    Uses log returns over the window closes and annualizes by
    sqrt(252). Returns `None` if insufficient data.
    """
    closes = [p.get("adjusted_close", p.get("close")) for p in points]
    closes = [c for c in closes if isinstance(c, (int, float))]
    if len(closes) < 2:
        return None

    tail = closes[-(window + 1) :]
    if len(tail) < 2:
        return None

    returns = []
    for prev, cur in zip(tail, tail[1:]):
        if prev <= 0 or cur <= 0:
            continue
        returns.append(math.log(cur / prev))

    if len(returns) < 2:
        return None

    vol_daily = statistics.stdev(returns)
    vol_annual = vol_daily * math.sqrt(252)
    return vol_annual


def _fetch_tradier_options(symbol: str, expiration: Optional[str] = None) -> dict:
    token = os.getenv("TRADIER_TOKEN")
    if not token:
        raise HTTPException(status_code=503, detail="TRADIER_TOKEN is not set on the backend")

    params = {"symbol": symbol}
    if expiration:
        params["expiration"] = expiration

    query = urlencode(params)
    url = f"https://api.tradier.com/v1/markets/options/chains?{query}"
    req = Request(url, headers={"Authorization": f"Bearer {token}", "Accept": "application/json"})

    try:
        with urlopen(req, timeout=15) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except URLError as exc:
        raise HTTPException(status_code=502, detail="Tradier request failed") from exc

    # Tradier returns {"options": {"option": [...]}} or may return a single option
    opts = payload.get("options") or {}
    items = opts.get("option")
    if items is None:
        return {"symbol": symbol.upper(), "options": []}

    if isinstance(items, dict):
        items = [items]

    simplified = []
    for o in items:
        simplified.append(
            {
                "symbol": o.get("symbol"),
                "expiration": o.get("expiration_date") or o.get("expiration"),
                "strike": float(o.get("strike", 0)),
                "type": o.get("option_type") or o.get("type"),
                "bid": float(o.get("bid", 0) or 0),
                "ask": float(o.get("ask", 0) or 0),
                "last": float(o.get("last", 0) or 0),
                "volume": int(o.get("volume", 0) or 0),
            }
        )

    return {"symbol": symbol.upper(), "options": simplified}


app = FastAPI(title="Options Pricing Visualizer API", version="0.1.0")

# Configure CORS origins from env.
raw_origins = os.getenv("CORS_ORIGINS", "http://localhost:5173")
allow_origins = [o.strip() for o in raw_origins.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict[str, str]:
    """Health check for the API.
    """
    return {"status": "ok"}


@app.post("/api/price")
def price(params: OptionParams) -> dict[str, object]:
    """Compute price and Greeks for the specified option parameters.

    The Pydantic `OptionParams` model validates inputs. Returns
    numeric values coerced to Python floats for JSON serialization.
    """

    option_type = params.option_type.lower()
    if option_type not in {"call", "put"}:
        raise HTTPException(status_code=400, detail="option_type must be call or put")

    results = price_and_greeks(
        spot=jnp.array(params.spot),
        strike=jnp.array(params.strike),
        rate=jnp.array(params.rate),
        vol=jnp.array(params.vol),
        time=jnp.array(params.time),
        dividend=jnp.array(params.dividend),
        option_type=option_type,
    )

    return {"option_type": option_type, **{key: float(value) for key, value in results.items()}}


@app.post("/api/curve")
def curve(params: CurveParams) -> dict[str, object]:
    """Return a series of (spot, value) points for the requested Greek.

    The response includes the requested greek, the option_type, and
    a points list for plotting on the frontend.
    """

    option_type = params.option_type.lower()
    if option_type not in {"call", "put"}:
        raise HTTPException(status_code=400, detail="option_type must be call or put")

    greek = params.greek.lower()
    if greek not in SUPPORTED_GREEKS:
        raise HTTPException(
            status_code=400,
            detail=f"greek must be one of: {', '.join(SUPPORTED_GREEKS)}",
        )

    spot_min = min(params.spot_min, params.spot_max)
    spot_max = max(params.spot_min, params.spot_max)
    if spot_max == spot_min:
        spot_max = spot_min * 1.01

    spots = jnp.linspace(spot_min, spot_max, params.points)

    results = price_and_greeks(
        spot=spots,
        strike=jnp.array(params.strike),
        rate=jnp.array(params.rate),
        vol=jnp.array(params.vol),
        time=jnp.array(params.time),
        dividend=jnp.array(params.dividend),
        option_type=option_type,
    )

    values = results[greek]

    return {
        "greek": greek,
        "option_type": option_type,
        "points": [
            {"spot": float(s), "value": float(v)}
            for s, v in zip(spots.tolist(), values.tolist())
        ],
    }


@app.post("/api/history")
def history(params: HistoryParams) -> dict[str, object]:
    """Fetch daily historical prices for a symbol (Alpha Vantage)."""

    outputsize = params.outputsize.lower()
    if outputsize not in {"compact", "full"}:
        raise HTTPException(status_code=400, detail="outputsize must be compact or full")

    symbol = params.symbol.strip().upper()
    if not symbol:
        raise HTTPException(status_code=400, detail="symbol is required")

    return _fetch_alpha_vantage_history(symbol, outputsize)


@app.post("/api/options")
def options(params: OptionsParams) -> dict[str, object]:
    """Fetch option chains for a symbol (Tradier).

    Returns a list of options with key fields for display.
    """
    symbol = params.symbol.strip().upper()
    if not symbol:
        raise HTTPException(status_code=400, detail="symbol is required")

    return _fetch_tradier_options(symbol, expiration=params.expiration)
