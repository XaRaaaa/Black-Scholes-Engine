import { useEffect, useMemo, useState } from "react";
import { fetchCurve, fetchHistory, fetchPrice } from "./api";
import GreekChart from "./components/GreekChart";
import HistoricalChart from "./components/HistoricalChart";

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

function toNumber(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

export default function App() {
  const [params, setParams] = useState(defaultParams);
  const [range, setRange] = useState(defaultRange);
  const [history, setHistory] = useState(defaultHistory);
  const [greek, setGreek] = useState("delta");
  const [priceData, setPriceData] = useState(null);
  const [curveData, setCurveData] = useState([]);
  const [historyData, setHistoryData] = useState([]);
  const [status, setStatus] = useState({ loading: false, error: "" });
  const [historyStatus, setHistoryStatus] = useState({ loading: false, error: "" });

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

  // CSV export will be added in a later commit; keep UI minimal for now.

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
    let isMounted = true;
    setHistoryStatus({ loading: true, error: "" });

    const timer = setTimeout(async () => {
      try {
        const historyResult = await fetchHistory(historyPayload);

        if (!isMounted) {
          return;
        }

        setHistoryData(historyResult.points || []);
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
          <div className="hero-label">Live price</div>
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
          <h2>Inputs</h2>
          <div className="status">
            {status.loading ? "Updating..." : status.error ? status.error : "Synced"}
          </div>
        </div>
        <div className="panel-grid">
          <div className="field">
            <label>Spot (S)</label>
            <input
              type="number"
              value={params.spot}
              onChange={(event) =>
                setParams((prev) => ({ ...prev, spot: event.target.value }))
              }
            />
          </div>
          <div className="field">
            <label>Strike (K)</label>
            <input
              type="number"
              value={params.strike}
              onChange={(event) =>
                setParams((prev) => ({ ...prev, strike: event.target.value }))
              }
            />
          </div>
          <div className="field">
            <label>Rate (r)</label>
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
            <label>Volatility (sigma)</label>
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
            <label>Time (T, years)</label>
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
            <label>Dividend (q)</label>
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
            <label>Option type</label>
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
          <h2>Greeks</h2>
          <div className="pill">Per unit change</div>
        </div>
        <div className="stats-grid">
          {Object.keys(greekLabels).map((key) => (
            <div className="stat" key={key}>
              <div className="stat-label">{greekLabels[key]}</div>
              <div className="stat-value">
                {priceData ? priceData[key].toFixed(6) : "--"}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="panel chart-panel">
        <div className="panel-header">
          <h2>Greek curve</h2>
          <div className="chart-controls">
            <select value={greek} onChange={(event) => setGreek(event.target.value)}>
              {Object.keys(greekLabels).map((key) => (
                <option key={key} value={key}>
                  {greekLabels[key]}
                </option>
              ))}
            </select>
            <div className="range-group">
              <div className="field small">
                <label>Min S</label>
                <input
                  type="number"
                  value={range.min}
                  onChange={(event) =>
                    setRange((prev) => ({ ...prev, min: event.target.value }))
                  }
                />
              </div>
              <div className="field small">
                <label>Max S</label>
                <input
                  type="number"
                  value={range.max}
                  onChange={(event) =>
                    setRange((prev) => ({ ...prev, max: event.target.value }))
                  }
                />
              </div>
              <div className="field small">
                <label>Points</label>
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
          <h2>Historical data</h2>
          <div className="chart-controls">
            <div className="field small">
              <label>Symbol</label>
              <input
                type="text"
                value={history.symbol}
                onChange={(event) =>
                  setHistory((prev) => ({ ...prev, symbol: event.target.value }))
                }
              />
            </div>
            <div className="field small">
              <label>Range</label>
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
              {historyStatus.loading ? "Loading..." : historyStatus.error || "Alpha Vantage"}
            </div>
            {/* CSV export button removed for initial scaffold */}
          </div>
        </div>
        <HistoricalChart
          data={historyData}
          title={`${historyPayload.symbol.toUpperCase()} daily close`}
        />
      </section>
    </div>
  );
}
