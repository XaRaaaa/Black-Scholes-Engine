import { useEffect, useMemo, useState } from "react";
import { fetchCurve, fetchHistory, fetchPrice } from "./api";
import GreekChart from "./components/GreekChart";
import MonteCarloConvergence from "./components/MonteCarloConvergence";
import HistoricalChart from "./components/HistoricalChart";

const SETTINGS_STORAGE_KEY = "options-visualizer-settings";
const COMPARISON_STORAGE_KEY = "options-visualizer-baseline";

const greekLabels = {
  price: "Price",
  delta: "Delta",
  gamma: "Gamma",
  vega: "Vega",
  theta: "Theta",
  rho: "Rho",
};

const defaultParams = {
  spot: "100",
  strike: "100",
  rate: "0.05",
  vol: "0.2",
  time: "1",
  dividend: "0.0",
  optionType: "call",
  method: "blackscholes",
  num_paths: "100000",
  seed: "0",
  antithetic: "true",
};

const defaultRange = {
  min: "60",
  max: "140",
  points: "80",
};

const defaultHistory = {
  symbol: "AAPL",
  outputsize: "compact",
};

const MIN_PATHS = 100;
const MAX_PATHS = 2000000;
const DEFAULT_PATHS = 100000;

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
      optionType: params.get("optionType") || defaultParams.optionType,
      method: params.get("method") || defaultParams.method,
      num_paths: params.get("num_paths") || defaultParams.num_paths,
      seed: params.get("seed") || defaultParams.seed,
      antithetic: params.get("antithetic") || defaultParams.antithetic,
    },
    range: {
      min: params.get("rangeMin") || defaultRange.min,
      max: params.get("rangeMax") || defaultRange.max,
      points: params.get("rangePoints") || defaultRange.points,
    },
    history: {
      symbol: params.get("symbol") || defaultHistory.symbol,
      outputsize: params.get("outputsize") || defaultHistory.outputsize,
    },
    greek: params.get("greek") || "delta",
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
  spot: "Current stock price.",
  strike: "Option strike price.",
  rate: "Annual risk-free rate.",
  vol: "Annualized volatility.",
  time: "Time to expiration, in years.",
  dividend: "Continuous dividend yield.",
  optionType: "Calls benefit from rising prices; puts benefit from falling prices.",
  symbol: "Ticker symbol for historical prices.",
  outputsize: "Recent history or the full available series.",
};

const outputHelp = {
  price: "Option price for the current inputs.",
  delta: "Change in price for a $1 move in the stock.",
  gamma: "How quickly delta changes as the stock moves.",
  vega: "Sensitivity to volatility.",
  theta: "Sensitivity to time decay.",
  rho: "Sensitivity to interest-rate changes.",
  livePrice: "Live option price for the current inputs.",
  greekCurve: "How the selected metric changes across the spot range.",
  historical: "Historical prices for the selected symbol.",
  range: "Spot range used for the curve.",
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

function toInt(value, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return fallback;
  }
  return Math.round(num);
}

function clampInt(value, min, max, fallback) {
  const num = toInt(value, fallback);
  return Math.min(max, Math.max(min, num));
}

function clampNumber(value, min, max, fallback) {
  const num = toNumber(value, fallback);
  return Math.min(max, Math.max(min, num));
}

function toBool(value, fallback) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return value.toLowerCase() === "true";
  }
  return fallback;
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
    return (
      readUrlSettings() || loadStoredSettings() || {
        params: defaultParams,
        range: defaultRange,
        history: defaultHistory,
        greek: "delta",
      }
    );
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

  const isMonteCarlo = ["montecarlo", "mc"].includes((params.method || "").toString().toLowerCase());

  const updateParam = (field) => (event) => {
    setParams((prev) => ({ ...prev, [field]: event.target.value }));
  };

  const updateRange = (field) => (event) => {
    setRange((prev) => ({ ...prev, [field]: event.target.value }));
  };

  const updateHistory = (field) => (event) => {
    setHistory((prev) => ({ ...prev, [field]: event.target.value }));
  };

  const payload = useMemo(() => {
    const method = (params.method || "blackscholes").toLowerCase();
    const numPaths = clampInt(params.num_paths, MIN_PATHS, MAX_PATHS, DEFAULT_PATHS);
    const seed = Math.max(0, toInt(params.seed, 0));
    const antithetic = toBool(params.antithetic, true);

    const spotVal = Math.max(0.01, toNumber(params.spot, 100));
    const strikeVal = Math.max(0.01, toNumber(params.strike, 100));
    const rateVal = clampNumber(params.rate, -1, 1, 0.05);
    const volVal = Math.max(0.000001, toNumber(params.vol, 0.2));
    const timeVal = Math.max(0.000001, toNumber(params.time, 1));
    const divVal = clampNumber(params.dividend, -1, 1, 0);

    return {
      spot: spotVal,
      strike: strikeVal,
      rate: rateVal,
      vol: volVal,
      time: timeVal,
      dividend: divVal,
      option_type: params.optionType,
      method,
      num_paths: numPaths,
      seed,
      antithetic,
    };
  }, [params]);

  const curvePayload = useMemo(() => {
    const rawMin = toNumber(range.min, payload.spot * 0.6);
    const rawMax = toNumber(range.max, payload.spot * 1.4);
    const spotMin = Math.max(0.01, Math.min(rawMin, rawMax));
    const spotMax = Math.max(spotMin * 1.05, Math.max(rawMin, rawMax));
    const points = 80;

    return {
      ...payload,
      greek,
      spot_min: spotMin,
      spot_max: spotMax,
      points,
    };
  }, [payload, range, greek]);

  const historyPayload = useMemo(() => {
    return {
      symbol: history.symbol.trim() || defaultHistory.symbol,
      outputsize: history.outputsize,
    };
  }, [history]);

  const currentSettings = useMemo(() => {
    return {
      params,
      range,
      history,
      greek,
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
      delta: Number(priceData[field]) - Number(baselineSnapshot.priceData[field]),
    }));

    return {
      savedAt: baselineSnapshot.savedAt,
      fields,
    };
  }, [baselineSnapshot, priceData]);

  function safeFixed(val, digits = 6) {
    const n = Number(val);
    if (!Number.isFinite(n)) return "--";
    return n.toFixed(digits);
  }

  function downloadHistoryCsv(points, symbol) {
    if (!points || points.length === 0) {
      return;
    }

    const rows = ["date,close,adjusted_close,volume"];
    points.forEach((point) => {
      rows.push([point.date, point.close, point.adjusted_close, point.volume].join(","));
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
      type: "application/json;charset=utf-8;",
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
      priceData,
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
        const [price, curve] = await Promise.all([fetchPrice(payload), fetchCurve(curvePayload)]);

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

        try {
          const points = historyResult.points || [];
          if (points.length) {
            const last = points[points.length - 1];
            const lastPrice = last.adjusted_close || last.close;
            setParams((prev) => ({
              ...prev,
              spot: String(lastPrice ?? prev.spot),
              vol: String(historyResult.realized_vol ?? prev.vol),
            }));
          }
        } catch {
          // keep UI resilient; ignore history-derived updates on error
        }

        setHistoryStatus({ loading: false, error: "" });
      } catch (error) {
        if (!isMounted) {
          return;
        }

        setHistoryStatus({
          loading: false,
          error: error.message || "Failed to fetch historical data",
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
          <h1>Explore Options pricing models</h1>
          <p>
            Change inputs, switch between Black-Scholes and Monte Carlo, and view
            graphs.
          </p>
        </div>
        <div className="hero-card">
          <div className="hero-label-row">
            <div className="hero-label">Live price</div>
            <InfoBadge label="Live price help" text={outputHelp.livePrice} />
          </div>
          <div className="hero-value">{priceData ? safeFixed(priceData.price, 4) : "--"}</div>
          <div className="hero-subtext">
            {params.optionType.toUpperCase()} - Strike {params.strike}
          </div>
          {priceData && ["montecarlo", "mc"].includes((priceData.method || "").toString().toLowerCase()) && (
            <div className="hero-meta">
              <small>
                standard error: {safeFixed(priceData.stderr, 6)} • paths: {priceData.num_paths}
              </small>
            </div>
          )}
        </div>
      </header>

      <section className="panel">
        <div className="panel-header">
          <div className="header-title">
            <h2>Inputs</h2>
            <InfoBadge label="Inputs help" text="Configure the pricing models." />
          </div>
          <div className="status">{status.loading ? "Updating..." : status.error || "Ready"}</div>
        </div>

        <div className="panel-grid">
          <div className="field small">
            <label>
              <span>Spot (S)</span>
              <InfoBadge text={inputHelp.spot} />
            </label>
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={params.spot}
              onChange={updateParam("spot")}
            />
          </div>

          <div className="field">
            <label>
              <span>Strike (K)</span>
              <InfoBadge text={inputHelp.strike} />
            </label>
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={params.strike}
              onChange={updateParam("strike")}
            />
          </div>

          <div className="field">
            <label>
              <span>Rate (r)</span>
              <InfoBadge text={inputHelp.rate} />
            </label>
            <input
              type="number"
              min="-1"
              max="1"
              step="0.001"
              value={params.rate}
              onChange={updateParam("rate")}
            />
          </div>

          <div className="field">
            <label>
              <span>Volatility (σ)</span>
              <InfoBadge text={inputHelp.vol} />
            </label>
            <input
              type="number"
              min="0.000001"
              step="0.001"
              value={params.vol}
              onChange={updateParam("vol")}
            />
          </div>

          <div className="field">
            <label>
              <span>Time (T, years)</span>
              <InfoBadge text={inputHelp.time} />
            </label>
            <input
              type="number"
              min="0.000001"
              step="0.01"
              value={params.time}
              onChange={updateParam("time")}
            />
          </div>

          <div className="field">
            <label>
              <span>Dividend (q)</span>
              <InfoBadge text={inputHelp.dividend} />
            </label>
            <input
              type="number"
              min="-1"
              max="1"
              step="0.001"
              value={params.dividend}
              onChange={updateParam("dividend")}
            />
          </div>

          <div className="field">
            <label>
              <span>Option type</span>
              <InfoBadge text={inputHelp.optionType} />
            </label>
            <select
              value={params.optionType}
              onChange={(event) => setParams((prev) => ({ ...prev, optionType: event.target.value }))}
            >
              <option value="call">European Call</option>
              <option value="put">European Put</option>
            </select>
          </div>

          <div className="field">
            <label>
              <span>Method</span>
              <InfoBadge text="Choose Black-Scholes or Monte Carlo." />
            </label>
            <select value={params.method} onChange={updateParam("method")}>
              <option value="blackscholes">Black-Scholes</option>
              <option value="montecarlo">Monte Carlo</option>
            </select>
          </div>

          {isMonteCarlo && (
            <>
              <div className="field">
                <label>
                  <span>Monte Carlo paths</span>
                  <InfoBadge text="Number of simulated paths." />
                </label>
                <input
                  type="number"
                  min="100"
                  max="2000000"
                  step="1"
                  value={params.num_paths}
                  onChange={updateParam("num_paths")}
                />
              </div>

              <div className="field">
                <label>
                  <span>Seed</span>
                  <InfoBadge text="Random seed." />
                </label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={params.seed}
                  onChange={updateParam("seed")}
                />
              </div>

              <div className="field">
                <label>
                  <span>Antithetic</span>
                  <InfoBadge text="Use antithetic variates." />
                </label>
                <select value={params.antithetic} onChange={updateParam("antithetic")}>
                  <option value="true">True</option>
                  <option value="false">False</option>
                </select>
              </div>
            </>
          )}
        </div>
      </section>

      <footer className="disclaimer" style={{ padding: "18px 20px", fontSize: "0.85rem", color: "#666" }}>
        This tool is for informational and educational purposes only. It estimates option values using Black-Scholes and Monte Carlo models and is not financial advice. Calculations are theoretical and omit real-world factors; consult a licensed financial advisor before investing.
      </footer>

      <section className="panel stats">
        <div className="panel-header">
          <div className="header-title">
            <h2>Greeks</h2>
            <InfoBadge
              label="Greeks help"
              text="The Greek outputs measure how the option reacts to changes in price, volatility, time, and rates."
            />
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
                {priceData && Number.isFinite(Number(priceData[key])) ? safeFixed(priceData[key], 6) : "--"}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="panel compare-panel">
        <div className="panel-header">
          <div className="header-title">
            <h2>Comparison mode</h2>
            <InfoBadge label="Comparison help" text="Save a snapshot and compare live outputs." />
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
                <div className="contract-meta">Saved {formatSigned(item.baseline, item.field === "price" ? 4 : 6)}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="compare-empty">Save a snapshot to compare live outputs.</div>
        )}
      </section>

      <section className="panel chart-panel">
        <div className="panel-header">
          <div className="header-title">
            <h2>{isMonteCarlo ? "Price convergence" : "Greek curve"}</h2>
            <InfoBadge label="Greek curve help" text={outputHelp.greekCurve} />
          </div>
          <div className="chart-controls">
            {!isMonteCarlo && (
              <>
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
                      min="0.01"
                      step="0.01"
                      value={range.min}
                      onChange={updateRange("min")}
                    />
                  </div>

                  <div className="field small">
                    <label>
                      <span>Max</span>
                      <InfoBadge text={outputHelp.range} />
                    </label>
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={range.max}
                      onChange={updateRange("max")}
                    />
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
        {isMonteCarlo ? (
          <MonteCarloConvergence basePayload={payload} />
        ) : (
          <GreekChart data={curveData} title={`${greekLabels[greek]} vs Spot`} currentSpot={payload.spot} />
        )}
      </section>

      <section className="panel chart-panel">
        <div className="panel-header">
          <div className="header-title">
            <h2>Monthly price history</h2>
            <InfoBadge label="Historical data help" text="Historical closes from Polygon." />
          </div>
          <div className="chart-controls">
            <div className="field small">
              <label>
                <span>Symbol</span>
                <InfoBadge text={inputHelp.symbol} />
              </label>
              <input type="text" value={history.symbol} onChange={updateHistory("symbol")} />
            </div>
            <div className="field small">
              <label>
                <span>Timeframe</span>
                <InfoBadge text={inputHelp.outputsize} />
              </label>
              <select value={history.outputsize} onChange={updateHistory("outputsize")}>
                <option value="compact">Compact</option>
                <option value="full">Full</option>
              </select>
            </div>
            <div className="pill">
              {historyStatus.loading ? "Loading..." : historyStatus.error || `Monthly points: ${historyData.length}`}
            </div>
            <button type="button" className="export-button" onClick={copyShareLink}>
              {shareState.copied ? "Link copied" : "Copy share link"}
            </button>
            <button type="button" className="export-button" onClick={exportSettingsJson}>
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