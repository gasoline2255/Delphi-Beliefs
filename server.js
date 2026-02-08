const express = require("express");
const path = require("path");

const app = express();
const PORT = 3000;

const MARKET_ID = 4;
const MODEL_COUNT = 4;

app.use(express.static(path.join(__dirname, "public")));

let fetchFn = global.fetch;
if (!fetchFn) {
  fetchFn = (...args) =>
    import("node-fetch").then(({ default: fetch }) => fetch(...args));
}
const fetch = fetchFn;

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "Mozilla/5.0",
    },
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
}

async function fetchJson(url) {
  const { ok, status, text } = await fetchText(url);
  try {
    const json = JSON.parse(text);
    return { ok, status, json, text };
  } catch {
    return { ok: false, status, json: null, text };
  }
}

// ✅ CORRECT MAPPING with FULL model names
function getCorrectEntryMap() {
  return {
    "0": "claude-haiku-4-5",              // 12.2%
    "1": "gemini-3-flash-preview",        // 12.6%
    "2": "gpt-5-mini",                    // 12.1%
    "3": "grok-4.1-fast-reasoning",       // 63.1% WINNER!
  };
}

app.get("/api/entry-map", async (req, res) => {
  try {
    const marketId = Number(req.query.market_id || MARKET_ID);
    const map = getCorrectEntryMap();

    res.setHeader("Cache-Control", "no-store");
    res.json({
      market_id: marketId,
      entry_count: MODEL_COUNT,
      fetched_at: new Date().toISOString(),
      map,
      map_source: "correct_mapping",
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.get("/api/delphi-chart", async (req, res) => {
  try {
    const timeframe = String(req.query.timeframe || "auto");
    const marketId = Number(req.query.market_id || MARKET_ID);
    const entryMap = getCorrectEntryMap();

    const url = `https://delphi.gensyn.ai/api/markets/${marketId}/chart?timeframe=${encodeURIComponent(timeframe)}`;

    const r = await fetchJson(url);
    if (!r.json) {
      return res.status(502).json({
        error: "bad_upstream_json",
        chart_source: url,
        status: r.status,
        body_preview: (r.text || "").slice(0, 200),
      });
    }

    const chart = r.json;
    let market_chart = null;
    if (chart.market_chart?.data_points) market_chart = chart.market_chart;
    else if (chart.data_points) market_chart = chart;
    else if (chart.data?.market_chart?.data_points) market_chart = chart.data.market_chart;

    if (!market_chart) {
      return res.status(502).json({
        error: "unexpected_upstream_shape",
        chart_source: url,
        keys: Object.keys(chart || {}),
      });
    }

    res.setHeader("Cache-Control", "no-store");
    res.json({
      market_id: marketId,
      timeframe,
      fetched_at: new Date().toISOString(),
      chart_source: url,
      market_chart,
      entry_map: entryMap,
      entry_map_source: "correct_mapping",
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.get("/api/human-belief", async (req, res) => {
  try {
    const markets = await fetchJson(
      "https://delphi.gensyn.ai/api/markets?limit=1&status=ongoing"
    );
    const market = markets?.json?.items?.[0] || null;

    const evalUrls = Array.from({ length: MODEL_COUNT }, (_, i) =>
      `https://delphi.gensyn.ai/api/markets/${MARKET_ID}/evals?modelIdx=${i}`
    );
    const rawResponses = await Promise.all(evalUrls.map(fetchJson));
    const raw = rawResponses.map((r) => r.json);

    const entryMap = getCorrectEntryMap();
    const modelNames = Array.from({ length: MODEL_COUNT }, (_, i) => {
      return entryMap[String(i)] || `Entry #${i}`;
    });

    res.setHeader("Cache-Control", "no-store");
    res.json({
      market_id: MARKET_ID,
      market_name: market?.market_name || null,
      status: market?.status || null,
      fetched_at: new Date().toISOString(),
      model_names: modelNames,
      model_names_source: "correct_mapping",
      raw,
      eval_sources: evalUrls,
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true, node: process.version });
});

app.listen(PORT, () => {
  console.log(`✅ Website: http://localhost:${PORT}`);
  console.log(`✅ Correct mapping: Entry 3=grok-4.1-fast-reasoning (WINNER)`);
  console.log(`✅ Health:  http://localhost:${PORT}/api/health`);
  console.log(`✅ Map:     http://localhost:${PORT}/api/entry-map?market_id=${MARKET_ID}`);
  console.log(`✅ Chart:   http://localhost:${PORT}/api/delphi-chart?timeframe=auto&market_id=${MARKET_ID}`);
  console.log(`✅ Belief:  http://localhost:${PORT}/api/human-belief`);
});