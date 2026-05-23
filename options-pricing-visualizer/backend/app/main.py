import json
import math
import os
import statistics
from datetime import date as current_date, timedelta
from typing import List, Optional
from urllib.error import URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import jax.numpy as jnp
from dotenv import load_dotenv

load_dotenv()

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


def _fetch_polygon_history(symbol: str, outputsize: str) -> dict[str, object]:
    api_key = os.getenv("POLYGON_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="POLYGON_API_KEY is not set on the backend",
        )

    days_back = 120 if outputsize == "compact" else 730
    end_date = current_date.today()
    start_date = end_date - timedelta(days=days_back)

    query = urlencode(
        {
            "adjusted": "true",
            "sort": "asc",
            "limit": 50000,
            "apiKey": api_key,
        }
    )
    request = Request(
        f"https://api.polygon.io/v2/aggs/ticker/{symbol.upper()}/range/1/day/{start_date.isoformat()}/{end_date.isoformat()}?{query}",
        headers={"Accept": "application/json"},
    )

    try:
        with urlopen(request, timeout=15) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except URLError as exc:
        raise HTTPException(status_code=502, detail="Polygon request failed") from exc

    if payload.get("status") == "ERROR":
        raise HTTPException(status_code=400, detail=payload.get("error", "Polygon returned an error"))

    series = payload.get("results")
    if not isinstance(series, list):
        raise HTTPException(status_code=502, detail="Polygon returned no daily series")

    points = []
    for item in series:
        points.append(
            {
                "date": current_date.fromtimestamp(item["t"] / 1000).isoformat(),
                "close": float(item.get("c", 0) or 0),
                "adjusted_close": float(item.get("c", 0) or 0),
                "volume": float(item.get("v", 0) or 0),
            }
        )

    meta = {
        "ticker": payload.get("ticker", symbol.upper()),
        "adjusted": True,
        "count": payload.get("count", len(points)),
    }
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


def _safe_float(value, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _fetch_polygon_options(symbol: str, expiration: Optional[str] = None) -> dict:
    api_key = os.getenv("POLYGON_API_KEY")
    if not api_key:
        raise HTTPException(status_code=503, detail="POLYGON_API_KEY is not set on the backend")

    params = {
        "apiKey": api_key,
        "limit": 250,
    }
    if expiration:
        params["expiration_date"] = expiration

    query = urlencode(params)
    url = f"https://api.polygon.io/v3/snapshot/options/{symbol.upper()}?{query}"

    try:
        with urlopen(Request(url, headers={"Accept": "application/json"}), timeout=15) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except URLError as exc:
        raise HTTPException(status_code=502, detail="Polygon request failed") from exc

    if payload.get("status") == "ERROR":
        raise HTTPException(status_code=502, detail=payload.get("error", "Polygon returned an error"))

    items = payload.get("results") or []
    simplified = []
    for item in items:
        details = item.get("details") or {}
        day = item.get("day") or {}
        last_quote = item.get("last_quote") or {}
        last_trade = item.get("last_trade") or {}
        greeks = item.get("greeks") or {}
        underlying = item.get("underlying_asset") or {}

        simplified.append(
            {
                "symbol": details.get("ticker") or item.get("ticker"),
                "expiration": details.get("expiration_date"),
                "strike": _safe_float(details.get("strike_price")),
                "type": details.get("contract_type"),
                "bid": _safe_float(last_quote.get("bid")),
                "ask": _safe_float(last_quote.get("ask")),
                "last": _safe_float(last_trade.get("price")),
                "volume": int(day.get("volume", 0) or 0),
                "open_interest": int(item.get("open_interest", 0) or 0),
                "implied_volatility": _safe_float(greeks.get("implied_volatility")),
                "delta": _safe_float(greeks.get("delta")),
                "gamma": _safe_float(greeks.get("gamma")),
                "theta": _safe_float(greeks.get("theta")),
                "vega": _safe_float(greeks.get("vega")),
                "rho": _safe_float(greeks.get("rho")),
                "underlying_price": _safe_float(underlying.get("price")),
            }
        )

    return {"symbol": symbol.upper(), "options": simplified}


app = FastAPI(title="Options Pricing Visualizer API", version="0.136.1")

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

    return _fetch_polygon_history(symbol, outputsize)


@app.post("/api/options")
def options(params: OptionsParams) -> dict[str, object]:
    """Fetch option chains for a symbol (Polygon).

    Returns a list of options with key fields for display.
    """
    symbol = params.symbol.strip().upper()
    if not symbol:
        raise HTTPException(status_code=400, detail="symbol is required")

    return _fetch_polygon_options(symbol, expiration=params.expiration)
