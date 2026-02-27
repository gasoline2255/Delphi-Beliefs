const express = require("express");
const path = require("path");
const compression = require("compression");

const app = express();
const PORT = 3000;

// ─── Cache config ─────────────────────────────────────────────────────────────
let delphiChartCache = null;
let delphiChartCacheTime = 0;
const CACHE_DURATION_MS = 5000;

let humanBeliefCache = null;
let humanBeliefCacheTime = 0;
const HUMAN_BELIEF_CACHE_MS = 8000;
const HUMAN_BELIEF_TIMEOUT_MS = 9000;

let historicalCache = null;
let historicalCacheTime = 0;
const HISTORICAL_CACHE_MS = 30000;

app.use(compression());
app.use(express.static(path.join(__dirname, "public")));

// ─── Safe fetch ───────────────────────────────────────────────────────────────
async function safeFetch(url, opts = {}) {
  if (global.fetch) return global.fetch(url, opts);
  const { default: nodeFetch } = await import("node-fetch");
  return nodeFetch(url, opts);
}

async function fetchText(url) {
  const res = await safeFetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "Mozilla/5.0",
      "cache-control": "no-cache, no-store, must-revalidate",
      pragma: "no-cache",
    },
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
}

async function fetchJson(url) {
  const { ok, status, text } = await fetchText(url);
  try {
    return { ok, status, json: JSON.parse(text), text };
  } catch {
    return { ok: false, status, json: null, text };
  }
}

async function fetchJsonWithTimeout(url, timeoutMs = HUMAN_BELIEF_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await safeFetch(url, {
      signal: ctrl.signal,
      headers: {
        accept: "application/json",
        "user-agent": "Mozilla/5.0",
        "cache-control": "no-cache, no-store, must-revalidate",
        pragma: "no-cache",
      },
    });
    const text = await res.text();
    try {
      return { ok: res.ok, status: res.status, json: JSON.parse(text), text };
    } catch {
      return { ok: false, status: res.status, json: null, text };
    }
  } catch (e) {
    return { ok: false, status: 0, json: null, text: String(e) };
  } finally {
    clearTimeout(t);
  }
}

function normalizeName(name) {
  return String(name || "").trim().toLowerCase().replace(/\s+/g, " ");
}

// ─── MARKET CONFIG ────────────────────────────────────────────────────────────
//
//  Delphi UI order (oldest → newest) mapped to API market_ids:
//
//  Display # | API ID | Market Name                                    | Winner
//  ──────────┼────────┼────────────────────────────────────────────────┼──────────────────────────────────
//  Market 1  |   0    | Middleweight General Reasoning Benchmark        | Qwen/Qwen3-30B-A3B-Instruct-2507
//  Market 2  |   1    | Middleweight General Reasoning Benchmark (II)   | Qwen/Qwen3-30B-A3B-Instruct-2507
//  Market 3  |   3    | Lightweight General Reasoning Benchmark         | Qwen/Qwen3-8B
//  Market 4  |   4    | Commercial-Fast Reasoning Benchmark             | grok-4.1-fast-reasoning
//
//  API ID 2 = ghost/ongoing entry with no valid evals or chart → excluded entirely.
// ─────────────────────────────────────────────────────────────────────────────

const MARKET_CONFIG = {
  "0": {
    displayNum: 1,
    name: "Gensyn Middleweight General Reasoning Benchmark",
    closedDate: "Dec 29, 2024",
    confirmedWinner: "Qwen/Qwen3-30B-A3B-Instruct-2507",
    entryMap: {
      "0": "Qwen/Qwen3-30B-A3B-Instruct-2507",
      "1": "zai-org/glm-4-32b-0414",
      "2": "tiiuae/falcon-h1-34b-instruct",
      "3": "google/gemma-3-27b-it",
      "4": "openai/gpt-oss-20b",
    },
  },
  "1": {
    displayNum: 2,
    name: "Gensyn Middleweight General Reasoning Benchmark (II)",
    closedDate: "Dec 29, 2024",
    confirmedWinner: "Qwen/Qwen3-30B-A3B-Instruct-2507",
    entryMap: {
      "0": "Qwen/Qwen3-30B-A3B-Instruct-2507",
      "1": "openai/gpt-oss-20b",
      "2": "google/gemma-3-27b-it",
      "3": "zai-org/glm-4-32b-0414",
      "4": "tiiuae/falcon-h1-34b-instruct",
    },
  },
  "3": {
    displayNum: 3,
    name: "Gensyn Lightweight General Reasoning Benchmark",
    closedDate: "Jan 30, 2025",
    confirmedWinner: "Qwen/Qwen3-8B",
    // Confirmed from /api/debug-market/3:
    // modelIdx=0 → Qwen/Qwen3-8B      → avgAggregate 42.59
    // modelIdx=1 → mistralai           → avgAggregate 43.54 (higher score but Qwen actually won)
    // modelIdx=2 → ibm-granite         → avgAggregate 37.02
    // modelIdx=3 → allenai/olmo        → avgAggregate 34.29
    // modelIdx=4 → meta-llama          → avgAggregate 38.05
    // NOTE: Mistralai scored highest on evals AND had 88.5% market price —
    // but Qwen won. Genuine incorrect prediction by belief system (not a mapping bug).
    entryMap: {
      "0": "Qwen/Qwen3-8B",
      "1": "mistralai/ministral-3-8b-instruct-2512",
      "2": "ibm-granite/granite-4.0-h-tiny",
      "3": "allenai/olmo-3-7b-instruct",
      "4": "meta-llama/llama-3.1-8b-instruct",
    },
  },
  "4": {
    displayNum: 4,
    name: "Gensyn Commercial-Fast Reasoning Benchmark",
    closedDate: "Feb 27, 2025",
    confirmedWinner: "grok-4.1-fast-reasoning",
    entryMap: {
      "0": "claude-haiku-4-5",
      "1": "gemini-3-flash-preview",
      "2": "gpt-5-mini",
      "3": "grok-4.1-fast-reasoning",
    },
  },
};

// Oldest → newest display order (known settled markets)
const MARKET_ORDER = ["0", "1", "3", "4"];

// ─── Dynamic live market detection ───────────────────────────────────────────
// No more hardcoded current market ID.
// Server checks Delphi API for any ongoing market automatically.
// Falls back to latest known settled market (ID "4") if nothing is live.

let liveMarketCache = null;
let liveMarketCacheTime = 0;
const LIVE_MARKET_CACHE_MS = 60000; // re-check Delphi API every 60s

// Ghost IDs — market IDs that appear as "ongoing" in the Delphi API
// but have no real eval/chart data and should never be treated as live.
// Only ID "2" is a confirmed ghost (stale entry Gensyn never cleaned up).
// IDs 0,1,3,4 are real settled markets and handled via the fallback path.
const GHOST_MARKET_IDS = new Set(["2"]);

// Validate a market actually has real eval data (not a ghost)
async function marketHasRealData(marketId) {
  // Quick check: probe modelIdx=0, need at least 1 eval returned
  const r = await fetchJson(
    `https://delphi.gensyn.ai/api/markets/${marketId}/evals?modelIdx=0`
  ).catch(() => ({ ok: false, json: null }));
  const evals = r?.json?.evals;
  return Array.isArray(evals) && evals.length > 0;
}

async function detectLiveMarket() {
  const now = Date.now();
  if (liveMarketCache && now - liveMarketCacheTime < LIVE_MARKET_CACHE_MS) {
    return liveMarketCache;
  }

  try {
    const r = await fetchJson("https://delphi.gensyn.ai/api/markets?limit=10&status=ongoing");
    const items = r?.json?.items || [];

    // Step 1: filter out known ghost IDs
    const candidates = items
      .filter(m => !GHOST_MARKET_IDS.has(String(m.market_id)))
      .sort((a, b) => (b.created_ts || 0) - (a.created_ts || 0)); // newest first

    // Step 2: validate each candidate actually has real eval data
    for (const candidate of candidates) {
      const marketId = String(candidate.market_id);
      const hasData = await marketHasRealData(marketId);

      if (!hasData) {
        console.log(`[live-market] Skipping market ID ${marketId} "${candidate.market_name}" — no real eval data (ghost)`);
        // Auto-add to ghost set so future checks skip it instantly
        GHOST_MARKET_IDS.add(marketId);
        continue;
      }

      // Valid live market found
      if (MARKET_CONFIG[marketId]) {
        liveMarketCache = {
          market_id: marketId,
          market_name: MARKET_CONFIG[marketId].name,
          status: "ongoing",
          entryMap: MARKET_CONFIG[marketId].entryMap,
          isKnown: true,
        };
      } else {
        console.log(`[live-market] New market detected: ID ${marketId} "${candidate.market_name}" — discovering models...`);
        const entryMap = await discoverEntryMap(marketId);
        liveMarketCache = {
          market_id: marketId,
          market_name: candidate.market_name || `Market #${marketId}`,
          status: "ongoing",
          entryMap,
          isKnown: false,
        };
      }

      liveMarketCacheTime = now;
      console.log(`[live-market] ✅ Active market → ID=${marketId} "${liveMarketCache.market_name}"`);
      return liveMarketCache;
    }
  } catch (e) {
    console.error("[live-market] Check failed:", e.message);
  }

  // Nothing live (or all candidates were ghosts) — fall back to latest settled market
  liveMarketCache = {
    market_id: "4",
    market_name: MARKET_CONFIG["4"].name,
    status: "closed",
    entryMap: MARKET_CONFIG["4"].entryMap,
    isKnown: true,
  };
  liveMarketCacheTime = Date.now();
  console.log(`[live-market] No active market found — showing latest settled (ID 4)`);
  return liveMarketCache;
}

// Probe modelIdx 0-9 to discover models in an unknown new market
async function discoverEntryMap(marketId) {
  const probes = await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      fetchJson(`https://delphi.gensyn.ai/api/markets/${marketId}/evals?modelIdx=${i}`)
        .then(r => ({ idx: i, ok: r.ok && r.json && Array.isArray(r.json.evals) && r.json.evals.length > 0 }))
        .catch(() => ({ idx: i, ok: false }))
    )
  );
  const entryMap = {};
  for (const p of probes) {
    if (p.ok) entryMap[String(p.idx)] = `Entry #${p.idx}`;
  }
  console.log(`[discoverEntryMap] Market ${marketId}: found ${Object.keys(entryMap).length} models`);
  return entryMap;
}

// ─── Chart winner helper ──────────────────────────────────────────────────────
function pickWinnerFromChart(chartJson, entryMap) {
  let market_chart = null;
  if (chartJson?.market_chart?.data_points)            market_chart = chartJson.market_chart;
  else if (chartJson?.data_points)                     market_chart = chartJson;
  else if (chartJson?.data?.market_chart?.data_points) market_chart = chartJson.data.market_chart;

  const pts = market_chart?.data_points;
  if (!Array.isArray(pts) || pts.length === 0) return null;

  const last = pts[pts.length - 1];
  const entries = last?.entries;
  if (!Array.isArray(entries) || entries.length === 0) return null;

  let best = null;
  for (const e of entries) {
    const price = typeof e.price === "string" ? Number(e.price)
                : typeof e.price === "number" ? e.price : NaN;
    if (!Number.isFinite(price)) continue;
    if (!best || price > best.price) best = { idx: String(e.entry_idx), price };
  }
  if (!best) return null;
  return entryMap?.[best.idx] || null;
}

async function resolveWinnerFromChart(marketId, entryMap, confirmedWinner) {
  // For closed markets, always use the confirmed winner from Delphi UI.
  // The chart top price is unreliable for closed markets — the final
  // settlement price doesn't always reflect the actual winner index.
  if (confirmedWinner) {
    return { actualWinner: confirmedWinner, source: "confirmed" };
  }
  // No confirmed winner — try chart as last resort (live/unknown markets)
  const r = await fetchJson(`https://delphi.gensyn.ai/api/markets/${marketId}/chart?timeframe=auto`);
  if (r.ok && r.json) {
    const w = pickWinnerFromChart(r.json, entryMap);
    if (w) return { actualWinner: w, source: "chart_top_price" };
  }
  return { actualWinner: "TBD", source: "unavailable" };
}

// ─── Compute prediction from evals ───────────────────────────────────────────
async function computeMarketPrediction(marketId, entryMap) {
  const idxKeys = Object.keys(entryMap);
  if (idxKeys.length === 0) {
    return { perModel: {}, beliefs: {}, predictedWinner: null, topBelief: 0, evalCount: 0, rankings: [] };
  }

  const allEvals = await Promise.all(
    idxKeys.map((idxStr) =>
      fetchJson(`https://delphi.gensyn.ai/api/markets/${marketId}/evals?modelIdx=${idxStr}`)
        .then((r) => {
          if (!r.ok || !r.json) {
            console.warn(`  [evals] market=${marketId} idx=${idxStr} → ${r.status}`);
          }
          return { modelIdx: idxStr, ok: r.ok, json: r.json };
        })
        .catch((err) => ({ modelIdx: idxStr, ok: false, json: null, error: err.message }))
    )
  );

  const perModel = {};
  let evalCount = 0;

  for (const r of allEvals) {
    const modelName = entryMap[String(r.modelIdx)] || `Entry #${r.modelIdx}`;
    const evals = Array.isArray(r?.json?.evals) ? r.json.evals : [];
    evalCount = Math.max(evalCount, evals.length);

    const aggregates = evals.map((e) =>
      typeof e?.aggregate === "number" && Number.isFinite(e.aggregate) ? e.aggregate : 0
    );
    const avgAggregate = aggregates.length > 0
      ? aggregates.reduce((a, b) => a + b, 0) / aggregates.length
      : 0;

    perModel[modelName] = {
      modelIdx: r.modelIdx,
      avgAggregate,
      perEvalAggregates: aggregates,
      evalsRaw: evals,
      upstream_ok: !!r.ok,
    };
  }

  const totalScore = Object.values(perModel).reduce((s, o) => s + o.avgAggregate, 0);
  const beliefs = {};
  let predictedWinner = null, topBelief = 0;

  if (totalScore > 0) {
    for (const [model, obj] of Object.entries(perModel)) {
      const belief = (obj.avgAggregate / totalScore) * 100;
      beliefs[model] = belief;
      if (belief > topBelief) { topBelief = belief; predictedWinner = model; }
    }
  }

  const rankings = Object.entries(perModel)
    .map(([model, obj]) => ({
      model,
      modelIdx: obj.modelIdx,
      avgScore: obj.avgAggregate,
      perEvalAggregates: obj.perEvalAggregates,
    }))
    .sort((a, b) => b.avgScore - a.avgScore);

  return { perModel, beliefs, predictedWinner, topBelief, evalCount, rankings };
}

// ─── Pages ────────────────────────────────────────────────────────────────────
app.get("/settled-markets",        (req, res) => res.sendFile(path.join(__dirname, "public", "settled-markets.html")));
app.get("/what-is-delphi-beliefs", (req, res) => res.sendFile(path.join(__dirname, "public", "what-is-delphi-beliefs.html")));

// ─── Debug endpoints ──────────────────────────────────────────────────────────
app.get("/api/test-upstream", async (req, res) => {
  try {
    const r = await fetchJson("https://delphi.gensyn.ai/api/markets?limit=3&status=closed");
    res.json({ ok: r.ok, status: r.status, preview: JSON.stringify(r.json).slice(0, 500) });
  } catch (e) {
    res.json({ ok: false, error: String(e) });
  }
});

app.get("/api/debug-markets", async (req, res) => {
  try {
    const [closed, ongoing] = await Promise.all([
      fetchJson("https://delphi.gensyn.ai/api/markets?limit=50&status=closed"),
      fetchJson("https://delphi.gensyn.ai/api/markets?limit=10&status=ongoing"),
    ]);
    res.json({
      closed:  { ok: closed.ok,  status: closed.status,  data: closed.json  },
      ongoing: { ok: ongoing.ok, status: ongoing.status, data: ongoing.json },
    });
  } catch (e) {
    res.json({ ok: false, error: String(e) });
  }
});

app.get("/api/debug-market/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const entryMap = MARKET_CONFIG[id]?.entryMap || {};
    const modelCount = Math.max(Object.keys(entryMap).length, 5);

    const [chart, ...evalResults] = await Promise.all([
      fetchJson(`https://delphi.gensyn.ai/api/markets/${id}/chart?timeframe=auto`),
      ...Array.from({ length: modelCount }, (_, i) =>
        fetchJson(`https://delphi.gensyn.ai/api/markets/${id}/evals?modelIdx=${i}`)
          .then(r => ({
            idx: i,
            ok: r.ok,
            status: r.status,
            evals: r.json?.evals || [],
          }))
      ),
    ]);

    const pts = chart.json?.data_points || chart.json?.market_chart?.data_points;
    const lastPoint = pts?.[pts.length - 1] || null;

    res.json({
      config: MARKET_CONFIG[id] || "not in config",
      chart_entry_count: chart.json?.entry_count,
      chart_winner: pickWinnerFromChart(chart.json, entryMap),
      chart_last_entries: lastPoint?.entries || null,
      evals: Object.fromEntries(
        evalResults.map(r => [
          `modelIdx_${r.idx}`,
          {
            modelName: entryMap[String(r.idx)] || "unknown",
            ok: r.ok,
            status: r.status,
            evalCount: r.evals.length,
            avgAggregate: r.evals.length > 0
              ? +(r.evals.reduce((s, e) => s + (e.aggregate || 0), 0) / r.evals.length).toFixed(2)
              : 0,
            benchmarks: r.evals.map(e => ({ name: e.benchmark, aggregate: e.aggregate })),
          }
        ])
      ),
    });
  } catch (e) {
    res.json({ error: String(e) });
  }
});

// ─── HISTORICAL ANALYSIS ─────────────────────────────────────────────────────
app.get("/api/historical-analysis", async (req, res) => {
  try {
    const now = Date.now();
    if (historicalCache && now - historicalCacheTime < HISTORICAL_CACHE_MS) {
      return res.json(historicalCache);
    }

    const results = [];

    for (const marketId of MARKET_ORDER) {
      const config = MARKET_CONFIG[marketId];
      if (!config) continue;

      const { name, closedDate, entryMap, confirmedWinner, displayNum } = config;

      try {
        console.log(`\n[Market ${marketId} / Display #${displayNum}] "${name}"`);

        // 1) Compute prediction from evals
        const { perModel, beliefs, predictedWinner, topBelief, evalCount, rankings } =
          await computeMarketPrediction(marketId, entryMap);

        // 2) Resolve actual winner from chart, fallback to confirmedWinner
        const { actualWinner, source: actual_winner_source } =
          await resolveWinnerFromChart(marketId, entryMap, confirmedWinner);

        // 3) Compare case-insensitively
        const correct =
          !!predictedWinner &&
          !!actualWinner &&
          actualWinner !== "TBD" &&
          normalizeName(predictedWinner) === normalizeName(actualWinner);

        console.log(`  predicted="${predictedWinner}" actual="${actualWinner}" correct=${correct} evals=${evalCount}`);

        results.push({
          marketId,
          displayNum,
          marketName: name,
          market_status: "settled",
          closedDate,
          actualWinner,
          actual_winner_source,
          predictedWinner: predictedWinner || "No prediction",
          beliefScore: topBelief,
          correct,
          evalCount,
          beliefs,
          rankings,
          perModel,
        });
      } catch (error) {
        console.error(`[Market ${marketId}] ERROR:`, error.message);
        results.push({
          marketId,
          displayNum: config.displayNum,
          marketName: name,
          closedDate,
          error: error.message,
        });
      }
    }

    const successfulResults  = results.filter((r) => !r.error);
    const correctPredictions = successfulResults.filter((r) => r.correct).length;
    const winRate = successfulResults.length > 0
      ? (correctPredictions / successfulResults.length) * 100
      : 0;

    console.log(`\n[historical-analysis] ${correctPredictions}/${successfulResults.length} correct — ${winRate.toFixed(1)}% win rate`);

    const payload = {
      markets: results,
      winRate,
      totalMarkets: successfulResults.length,
      settledMarkets: successfulResults.length,
      correctPredictions,
    };

    historicalCache = payload;
    historicalCacheTime = Date.now();
    res.json(payload);
  } catch (error) {
    console.error("[historical-analysis] FATAL:", error.message, error.stack);
    res.status(500).json({ error: "Failed to fetch historical data", detail: error.message });
  }
});

// ─── Entry map ────────────────────────────────────────────────────────────────
app.get("/api/entry-map", async (req, res) => {
  try {
    const live = await detectLiveMarket();
    const marketId = req.query.market_id ? String(req.query.market_id) : live.market_id;
    const config = MARKET_CONFIG[marketId];
    const entryMap = config?.entryMap || (marketId === live.market_id ? live.entryMap : {});
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.json({
      market_id: marketId,
      entry_count: Object.keys(entryMap).length,
      fetched_at: new Date().toISOString(),
      map: entryMap,
      map_source: config ? "confirmed_config" : "dynamic_discovery",
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ─── Delphi chart ─────────────────────────────────────────────────────────────
app.get("/api/delphi-chart", async (req, res) => {
  try {
    const timeframe = String(req.query.timeframe || "auto");
    const live = await detectLiveMarket();
    const marketId = req.query.market_id ? String(req.query.market_id) : live.market_id;
    const config = MARKET_CONFIG[marketId];
    const entryMap = config?.entryMap || (marketId === live.market_id ? live.entryMap : {});

    const now = Date.now();
    // Invalidate cache if market changed
    if (delphiChartCache && delphiChartCache.market_id !== marketId) {
      delphiChartCache = null;
      delphiChartCacheTime = 0;
    }
    if (delphiChartCache && now - delphiChartCacheTime < CACHE_DURATION_MS) return res.json(delphiChartCache);

    const url = `https://delphi.gensyn.ai/api/markets/${marketId}/chart?timeframe=${encodeURIComponent(timeframe)}`;
    const r = await fetchJson(url);

    if (!r.json) {
      return res.status(502).json({ error: "bad_upstream_json", status: r.status, body_preview: (r.text || "").slice(0, 200) });
    }

    const chart = r.json;
    let market_chart = null;
    if (chart.market_chart?.data_points)            market_chart = chart.market_chart;
    else if (chart.data_points)                     market_chart = chart;
    else if (chart.data?.market_chart?.data_points) market_chart = chart.data.market_chart;

    if (!market_chart) {
      return res.status(502).json({ error: "unexpected_upstream_shape", keys: Object.keys(chart || {}) });
    }

    const response = {
      market_id: marketId,
      timeframe,
      fetched_at: new Date().toISOString(),
      market_chart,
      entry_map: entryMap,
      entry_map_source: "confirmed_config",
    };

    delphiChartCache = response;
    delphiChartCacheTime = now;

    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.json(response);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ─── Human belief ─────────────────────────────────────────────────────────────
app.get("/api/human-belief", async (req, res) => {
  try {
    const live = await detectLiveMarket();
    const marketId   = live.market_id;
    const entryMap   = live.entryMap;
    const modelCount = Object.keys(entryMap).length;

    const now = Date.now();
    // Invalidate cache if the market has changed
    if (humanBeliefCache && humanBeliefCache.market_id !== marketId) {
      humanBeliefCache = null;
      humanBeliefCacheTime = 0;
    }
    if (humanBeliefCache && now - humanBeliefCacheTime < HUMAN_BELIEF_CACHE_MS) return res.json(humanBeliefCache);

    const evalTasks = Array.from({ length: modelCount }, (_, i) =>
      fetchJsonWithTimeout(`https://delphi.gensyn.ai/api/markets/${marketId}/evals?modelIdx=${i}`)
    );
    const settled    = await Promise.allSettled(evalTasks);
    const raw        = settled.map((s) => (s.status === "fulfilled" ? s.value.json : null));
    const modelNames = Array.from({ length: modelCount }, (_, i) => entryMap[String(i)] || `Entry #${i}`);

    const payload = {
      market_id:   marketId,
      market_name: live.market_name,
      status:      live.status,
      fetched_at:  new Date().toISOString(),
      model_names: modelNames,
      raw,
    };

    humanBeliefCache     = payload;
    humanBeliefCacheTime = now;

    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.json(payload);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ─── Live market endpoint (auto-detects current market) ──────────────────────
// The frontend calls this first on load to know which market to display.
// Returns ongoing market if one exists, otherwise latest settled market.
app.get("/api/live-market", async (req, res) => {
  try {
    const live = await detectLiveMarket();
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.json({
      market_id: live.market_id,
      market_name: live.market_name,
      status: live.status,
      is_live: live.status === "ongoing",
      entry_map: live.entryMap,
      entry_count: Object.keys(live.entryMap).length,
      is_known_market: live.isKnown,
      fetched_at: new Date().toISOString(),
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ─── Health ───────────────────────────────────────────────────────────────────
app.get("/api/health", (req, res) => res.json({ ok: true, node: process.version }));

app.listen(PORT, () => {
  console.log(`\n✅ Delphi Beliefs Dashboard Started`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📊 Main Dashboard:     http://localhost:${PORT}`);
  console.log(`🔬 Settled Markets:    http://localhost:${PORT}/settled-markets`);
  console.log(`🩺 Upstream Test:      http://localhost:${PORT}/api/test-upstream`);
  console.log(`🐛 Debug Markets:      http://localhost:${PORT}/api/debug-markets`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`\n📋 Markets (oldest → newest):`);
  for (const id of MARKET_ORDER) {
    const c = MARKET_CONFIG[id];
    console.log(`   #${c.displayNum} [API:${id}] ${c.name}`);
    console.log(`         Closed:  ${c.closedDate}`);
    console.log(`         Winner:  ${c.confirmedWinner}`);
    console.log(`         Models:  ${Object.values(c.entryMap).join(", ")}`);
  }
  console.log();
});
