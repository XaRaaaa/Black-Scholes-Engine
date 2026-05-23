import { useEffect, useMemo, useState } from "react";
import { fetchCurve, fetchHistory, fetchPrice } from "./api";
import GreekChart from "./components/GreekChart";
import HistoricalChart from "./components/HistoricalChart";

const SETTINGS_STORAGE_KEY = "options-visualizer-settings";
const COMPARISON_STORAGE_KEY = "options-visualizer-baseline";

const greekLabels = {
  price: "Price",
  delta: "Delta",
  gamma: "Gamma",
  vega: "Vega",
  theta: "Theta",
  rho: "Rho"
};

const defaultParams = {
  spot: "100",
  strike: "100",
  rate: "0.05",
  vol: "0.2",
  time: "1",
  dividend: "0.0",
  optionType: "call"
};

const defaultRange = {
  min: "60",
  max: "140",
  points: "80"
};

const defaultHistory = {
  symbol: "AAPL",
  outputsize: "compact"
};

function readUrlSettings() {
  if (typeof window === "undefined") {
    return null;
  }

  const params = new URLSearchParams(window.location.search);
  if (!params.size) {
    return null;
  }

  return {
    params: {
      spot: params.get("spot") || defaultParams.spot,
      strike: params.get("strike") || defaultParams.strike,
      rate: params.get("rate") || defaultParams.rate,
      vol: params.get("vol") || defaultParams.vol,
      time: params.get("time") || defaultParams.time,
      dividend: params.get("dividend") || defaultParams.dividend,
      optionType: params.get("optionType") || defaultParams.optionType
    },
    range: {
      min: params.get("rangeMin") || defaultRange.min,
      max: params.get("rangeMax") || defaultRange.max,
      points: params.get("rangePoints") || defaultRange.points
    },
    history: {
      symbol: params.get("symbol") || defaultHistory.symbol,
      outputsize: params.get("outputsize") || defaultHistory.outputsize
    },
    greek: params.get("greek") || "delta"
  };
}

function loadStoredSettings() {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveStoredSettings(settings) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // ignore storage failures
  }
}

function loadBaselineSnapshot() {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(COMPARISON_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveBaselineSnapshot(snapshot) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(COMPARISON_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // ignore storage failures
  }
}

const inputHelp = {
  spot: "Current price of the underlying stock used as the starting point for the option model.",
  strike: "The fixed exercise price specified by the option contract.",
  rate: "Annual risk-free interest rate. This comes from market conditions, not the stock itself.",
  vol: "Annualized volatility estimate for the underlying stock price.",
  time: "Time to expiration, measured in years.",
  dividend: "Continuous dividend yield. This is a separate market assumption, not a stock-price field.",
  optionType: "Call options gain value when the stock rises. Put options gain value when the stock falls.",
  symbol: "Ticker symbol for the stock whose historical prices are being fetched.",
  outputsize: "Compact returns a shorter recent history. Full returns the largest available series."
};

const outputHelp = {
  price: "Theoretical Black-Scholes price for the current inputs.",
  delta: "Estimated change in option price for a $1 move in the stock price.",
  gamma: "How quickly delta changes as the stock price moves.",
  vega: "Sensitivity to volatility. This app reports vega per 1.0 volatility, not per 1%.",
  theta: "Sensitivity to time passing. Negative values indicate time decay.",
  rho: "Sensitivity to interest-rate changes.",
  livePrice: "The computed option premium using the current input values.",
  greekCurve: "How the selected output changes as the stock price moves across the chosen range.",
  historical: "Monthly close prices for the selected stock symbol.",
  range: "Controls how far the spot-price curve extends around the current stock price."
};

function InfoBadge({ text, label }) {
  return (
    <span className="info-badge" title={text} aria-label={label || text}>
      i
    </span>
  );
}

function toNumber(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function toDaysUntilExpiration(expiration) {
  if (!expiration) {
    return null;
  }

  const expiry = new Date(`${expiration}T00:00:00Z`);
  if (Number.isNaN(expiry.getTime())) {
    return null;
  }

  const millisPerDay = 1000 * 60 * 60 * 24;
  return Math.max(0, (expiry.getTime() - Date.now()) / millisPerDay / 365);
}

function formatPercent(value) {
  if (!Number.isFinite(value)) {
    return "--";
  }

  return `${(value * 100).toFixed(2)}%`;
}

function formatSigned(value, digits = 4) {
  if (!Number.isFinite(value)) {
    return "--";
  }

  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}`;
}

function buildQueryString(settings) {
  const query = new URLSearchParams();
  query.set("spot", settings.params.spot);
  query.set("strike", settings.params.strike);
  query.set("rate", settings.params.rate);
  query.set("vol", settings.params.vol);
  query.set("time", settings.params.time);
  query.set("dividend", settings.params.dividend);
  query.set("optionType", settings.params.optionType);
  query.set("rangeMin", settings.range.min);
  query.set("rangeMax", settings.range.max);
  query.set("rangePoints", settings.range.points);
  query.set("symbol", settings.history.symbol);
  query.set("outputsize", settings.history.outputsize);
  query.set("greek", settings.greek);
  return query.toString();
}

export default function App() {
  const initialSettings = useMemo(() => {
    return readUrlSettings() || loadStoredSettings() || {
      params: defaultParams,
      range: defaultRange,
      history: defaultHistory,
      greek: "delta"
    };
  }, []);

  const [params, setParams] = useState(initialSettings.params);
  const [range, setRange] = useState(initialSettings.range);
  const [history, setHistory] = useState(initialSettings.history);
  const [greek, setGreek] = useState(initialSettings.greek);
  const [priceData, setPriceData] = useState(null);
  const [curveData, setCurveData] = useState([]);
  const [historyData, setHistoryData] = useState([]);
  const [status, setStatus] = useState({ loading: false, error: "" });
  const [historyStatus, setHistoryStatus] = useState({ loading: false, error: "" });
  const [baselineSnapshot, setBaselineSnapshot] = useState(() => loadBaselineSnapshot());
  const [shareState, setShareState] = useState({ copied: false, exported: false });

  const payload = useMemo(() => {
    return {
      spot: toNumber(params.spot, 100),
      strike: toNumber(params.strike, 100),
      rate: toNumber(params.rate, 0.05),
      vol: toNumber(params.vol, 0.2),
      time: toNumber(params.time, 1),
      dividend: toNumber(params.dividend, 0),
      option_type: params.optionType
    };
  }, [params]);

  const curvePayload = useMemo(() => {
    const rawMin = toNumber(range.min, payload.spot * 0.6);
    const rawMax = toNumber(range.max, payload.spot * 1.4);
    const spotMin = Math.max(0.01, Math.min(rawMin, rawMax));
    const spotMax = Math.max(spotMin * 1.05, Math.max(rawMin, rawMax));
    const points = Math.min(200, Math.max(20, Math.round(toNumber(range.points, 80))));

    return {
      ...payload,
      greek,
      spot_min: spotMin,
      spot_max: spotMax,
      points
    };
  }, [payload, range, greek]);

  const historyPayload = useMemo(() => {
    return {
      symbol: history.symbol.trim() || defaultHistory.symbol,
      outputsize: history.outputsize
    };
  }, [history]);

  const currentSettings = useMemo(() => {
    return {
      params,
      range,
      history,
      greek
    };
  }, [params, range, history, greek]);

  const baselineComparison = useMemo(() => {
    if (!baselineSnapshot?.priceData || !priceData) {
      return null;
    }

    const fields = ["price", "delta", "gamma", "vega", "theta", "rho"].map((field) => ({
      field,
      baseline: baselineSnapshot.priceData[field],
      current: priceData[field],
      delta: Number(priceData[field]) - Number(baselineSnapshot.priceData[field])
    }));

    return {
      savedAt: baselineSnapshot.savedAt,
      fields
    };
  }, [baselineSnapshot, priceData]);

  function downloadHistoryCsv(points, symbol) {
    if (!points || points.length === 0) {
      return;
    }

    const rows = ["date,close,adjusted_close,volume"];
    points.forEach((point) => {
      rows.push([
        point.date,
        point.close,
        point.adjusted_close,
        point.volume
      ].join(","));
    });

    const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${symbol.toUpperCase()}-history.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function persistCurrentSettings(nextSettings) {
    saveStoredSettings(nextSettings);
    if (typeof window !== "undefined") {
      const nextUrl = `${window.location.pathname}?${buildQueryString(nextSettings)}`;
      window.history.replaceState({}, "", nextUrl);
    }
  }

  function exportSettingsJson() {
    const blob = new Blob([JSON.stringify(currentSettings, null, 2)], {
      type: "application/json;charset=utf-8;"
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `options-visualizer-settings.json`;
    link.click();
    URL.revokeObjectURL(url);
    setShareState({ copied: false, exported: true });
  }

  async function copyShareLink() {
    if (typeof window === "undefined") {
      return;
    }

    const shareUrl = `${window.location.origin}${window.location.pathname}?${buildQueryString(currentSettings)}`;
    await navigator.clipboard.writeText(shareUrl);
    setShareState({ copied: true, exported: false });
  }

  function saveComparisonSnapshot() {
    const snapshot = {
      savedAt: new Date().toISOString(),
      settings: currentSettings,
      priceData
    };
    setBaselineSnapshot(snapshot);
    saveBaselineSnapshot(snapshot);
  }

  function clearComparisonSnapshot() {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(COMPARISON_STORAGE_KEY);
    }
    setBaselineSnapshot(null);
  }

  function resetStatusFlags() {
    if (shareState.copied || shareState.exported) {
      setShareState({ copied: false, exported: false });
    }
  }

  useEffect(() => {
    let isMounted = true;
    setStatus({ loading: true, error: "" });

    const timer = setTimeout(async () => {
      try {
        const [price, curve] = await Promise.all([
          fetchPrice(payload),
          fetchCurve(curvePayload)
        ]);

        if (!isMounted) {
          return;
        }

        setPriceData(price);
        setCurveData(curve.points || []);
        setStatus({ loading: false, error: "" });
      } catch (error) {
        if (!isMounted) {
          return;
        }

        setStatus({ loading: false, error: error.message || "Failed to fetch data" });
      }
    }, 300);

    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [payload, curvePayload]);

  useEffect(() => {
    persistCurrentSettings(currentSettings);
    resetStatusFlags();
  }, [currentSettings]);

  useEffect(() => {
    let isMounted = true;
    setHistoryStatus({ loading: true, error: "" });

    const timer = setTimeout(async () => {
      try {
        const historyResult = await fetchHistory(historyPayload);

        if (!isMounted) {
          return;
        }

        setHistoryData(historyResult.points || []);

        // Auto-fill spot and vol from fetched history when available.
        try {
          const points = historyResult.points || [];
          if (points.length) {
            const last = points[points.length - 1];
            const lastPrice = last.adjusted_close || last.close;
            setParams((prev) => ({
              ...prev,
              spot: String(lastPrice ?? prev.spot),
              vol: String(historyResult.realized_vol ?? prev.vol)
            }));
          }
        } catch (e) {
          // keep UI resilient; ignore history-derived updates on error
        }
        setHistoryStatus({ loading: false, error: "" });
      } catch (error) {
        if (!isMounted) {
          return;
        }

        setHistoryStatus({
          loading: false,
          error: error.message || "Failed to fetch historical data"
        });
      }
    }, 500);

    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [historyPayload]);

  return (
    <div className="app">
      <header className="hero">
        <div>
          <span className="eyebrow">Options Pricing Visualizer</span>
          <h1>Black-Scholes built for exploration.</h1>
          <p>
            Tune inputs, compare call and put sensitivity, and inspect Greeks across
            the spot curve with D3.
          </p>
        </div>
        <div className="hero-card">
          <div className="hero-label-row">
            <div className="hero-label">Live price</div>
            <InfoBadge label="Live price help" text={outputHelp.livePrice} />
          </div>
          <div className="hero-value">
            {priceData ? priceData.price.toFixed(4) : "--"}
          </div>
          <div className="hero-subtext">
            {params.optionType.toUpperCase()} - Strike {params.strike}
          </div>
        </div>
      </header>

      <section className="panel">
        <div className="panel-header">
          <div className="header-title">
            <h2>Inputs</h2>
            <InfoBadge label="Inputs help" text="These values drive the Black-Scholes pricing model." />
          </div>
          <div className="status">
            {status.loading ? "Updating..." : status.error ? status.error : "Synced"}
          </div>
        </div>
        <div className="panel-grid">
          <div className="field">
            <label>
              <span>Spot (S)</span>
              <InfoBadge text={inputHelp.spot} />
            </label>
            <input
              type="number"
              value={params.spot}
              onChange={(event) =>
                setParams((prev) => ({ ...prev, spot: event.target.value }))
              }
            />
          </div>
          <div className="field">
            <label>
              <span>Strike (K)</span>
              <InfoBadge text={inputHelp.strike} />
            </label>
            <input
              type="number"
              value={params.strike}
              onChange={(event) =>
                setParams((prev) => ({ ...prev, strike: event.target.value }))
              }
            />
          </div>
          <div className="field">
            <label>
              <span>Rate (r)</span>
              <InfoBadge text={inputHelp.rate} />
            </label>
            <input
              type="number"
              step="0.001"
              value={params.rate}
              onChange={(event) =>
                setParams((prev) => ({ ...prev, rate: event.target.value }))
              }
            />
          </div>
          <div className="field">
            <label>
              <span>Volatility (σ)</span>
              <InfoBadge text={inputHelp.vol} />
            </label>
            <input
              type="number"
              step="0.001"
              value={params.vol}
              onChange={(event) =>
                setParams((prev) => ({ ...prev, vol: event.target.value }))
              }
            />
          </div>
          <div className="field">
            <label>
              <span>Time (T, years)</span>
              <InfoBadge text={inputHelp.time} />
            </label>
            <input
              type="number"
              step="0.01"
              value={params.time}
              onChange={(event) =>
                setParams((prev) => ({ ...prev, time: event.target.value }))
              }
            />
          </div>
          <div className="field">
            <label>
              <span>Dividend (q)</span>
              <InfoBadge text={inputHelp.dividend} />
            </label>
            <input
              type="number"
              step="0.001"
              value={params.dividend}
              onChange={(event) =>
                setParams((prev) => ({ ...prev, dividend: event.target.value }))
              }
            />
          </div>
          <div className="field">
            <label>
              <span>Option type</span>
              <InfoBadge text={inputHelp.optionType} />
            </label>
            <select
              value={params.optionType}
              onChange={(event) =>
                setParams((prev) => ({ ...prev, optionType: event.target.value }))
              }
            >
              <option value="call">Call</option>
              <option value="put">Put</option>
            </select>
          </div>
        </div>
      </section>

      <section className="panel stats">
        <div className="panel-header">
          <div className="header-title">
            <h2>Greeks</h2>
            <InfoBadge label="Greeks help" text="The Greek outputs measure how the option reacts to changes in price, volatility, time, and rates." />
          </div>
          <div className="pill">Per unit change</div>
        </div>
        <div className="stats-grid">
          {Object.keys(greekLabels).map((key) => (
            <div className="stat" key={key}>
              <div className="stat-label">
                <span>{greekLabels[key]}</span>
                <InfoBadge text={outputHelp[key]} />
              </div>
              <div className="stat-value">
                {priceData ? priceData[key].toFixed(6) : "--"}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="panel compare-panel">
        <div className="panel-header">
          <div className="header-title">
            <h2>Comparison mode</h2>
            <InfoBadge
              label="Comparison help"
              text="Save the current snapshot and compare live option outputs against it."
            />
          </div>
          <div className="chart-controls">
            <div className="pill">
              {baselineSnapshot ? `Saved ${new Date(baselineSnapshot.savedAt).toLocaleString()}` : "No saved snapshot"}
            </div>
            <button type="button" className="export-button" onClick={saveComparisonSnapshot}>
              Save snapshot
            </button>
            <button type="button" className="export-button" onClick={clearComparisonSnapshot} disabled={!baselineSnapshot}>
              Clear snapshot
            </button>
          </div>
        </div>
        {baselineComparison ? (
          <div className="compare-grid">
            {baselineComparison.fields.map((item) => (
              <div className="compare-card" key={item.field}>
                <div className="contract-label">{item.field}</div>
                <div className="contract-value">{formatSigned(item.current, item.field === "price" ? 4 : 6)}</div>
                <div className="contract-meta">
                  Saved {formatSigned(item.baseline, item.field === "price" ? 4 : 6)}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="compare-empty">Save a snapshot to compare the current price and Greeks against it.</div>
        )}
      </section>

      <section className="panel chart-panel">
        <div className="panel-header">
          <div className="header-title">
            <h2>Greek curve</h2>
            <InfoBadge label="Greek curve help" text={outputHelp.greekCurve} />
          </div>
          <div className="chart-controls">
            <select
              value={greek}
              onChange={(event) => setGreek(event.target.value)}
              aria-label="Select Greek output"
            >
              {Object.keys(greekLabels).map((key) => (
                <option key={key} value={key}>
                  {greekLabels[key]}
                </option>
              ))}
            </select>
            <div className="range-group">
              <div className="field small">
                <label>
                  <span>Min</span>
                  <InfoBadge text={outputHelp.range} />
                </label>
                <input
                  type="number"
                  value={range.min}
                  onChange={(event) =>
                    setRange((prev) => ({ ...prev, min: event.target.value }))
                  }
                />
              </div>
              <div className="field small">
                <label>
                  <span>Max</span>
                  <InfoBadge text={outputHelp.range} />
                </label>
                <input
                  type="number"
                  value={range.max}
                  onChange={(event) =>
                    setRange((prev) => ({ ...prev, max: event.target.value }))
                  }
                />
              </div>
              <div className="field small">
                <label>
                  <span>Points</span>
                  <InfoBadge text="Number of sample points used to draw the curve." />
                </label>
                <input
                  type="number"
                  value={range.points}
                  onChange={(event) =>
                    setRange((prev) => ({ ...prev, points: event.target.value }))
                  }
                />
              </div>
            </div>
          </div>
        </div>
        <GreekChart data={curveData} title={`${greekLabels[greek]} vs Spot`} />
      </section>

      <section className="panel chart-panel">
        <div className="panel-header">
          <div className="header-title">
            <h2>Monthly price history</h2>
            <InfoBadge label="Historical data help" text="Monthly closes from Polygon shown as a time series." />
          </div>
          <div className="chart-controls">
            <div className="field small">
              <label>
                <span>Symbol</span>
                <InfoBadge text={inputHelp.symbol} />
              </label>
              <input
                type="text"
                value={history.symbol}
                onChange={(event) =>
                  setHistory((prev) => ({ ...prev, symbol: event.target.value }))
                }
              />
            </div>
            <div className="field small">
              <label>
                <span>Range</span>
                <InfoBadge text={inputHelp.outputsize} />
              </label>
              <select
                value={history.outputsize}
                onChange={(event) =>
                  setHistory((prev) => ({ ...prev, outputsize: event.target.value }))
                }
              >
                <option value="compact">Compact</option>
                <option value="full">Full</option>
              </select>
            </div>
            <div className="pill">
              {historyStatus.loading ? "Loading..." : historyStatus.error || `Monthly points: ${historyData.length}`}
            </div>
            <button
              type="button"
              className="export-button"
              onClick={copyShareLink}
            >
              {shareState.copied ? "Link copied" : "Copy share link"}
            </button>
            <button
              type="button"
              className="export-button"
              onClick={exportSettingsJson}
            >
              {shareState.exported ? "JSON exported" : "Export JSON"}
            </button>
            <button
              type="button"
              className="export-button"
              onClick={() => downloadHistoryCsv(historyData, historyPayload.symbol)}
              disabled={!historyData.length}
            >
              Export CSV
            </button>
          </div>
        </div>
        <HistoricalChart
          data={historyData}
          title={`${historyPayload.symbol.toUpperCase()} monthly close history`}
        />
      </section>
    </div>
  );
}
