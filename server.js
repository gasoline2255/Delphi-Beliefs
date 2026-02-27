const express = require("express");
const path = require("path");

// ✅ (phone/network optimization) gzip compression for faster loads on mobile
const compression = require("compression");

const app = express();
const PORT = 3000;

// Live market (your current dashboard)
const MARKET_ID = 4;
const MODEL_COUNT = 4;

// ✅ REDUCED CACHE DURATION - Force more frequent updates
let delphiChartCache = null;
let delphiChartCacheTime = 0;
const CACHE_DURATION_MS = 5000; // 5 seconds only

// ✅ ADD: small cache + timeout only for /api/human-belief (fixes 15s+ load)
let humanBeliefCache = null;
let humanBeliefCacheTime = 0;
const HUMAN_BELIEF_CACHE_MS = 8000; // serve cached for 8s to avoid slow upstream spikes
const HUMAN_BELIEF_TIMEOUT_MS = 9000; // abort upstream if hanging/pending

// ✅ (phone/network optimization) enable gzip
app.use(compression());

app.use(express.static(path.join(__dirname, "public")));

// node-fetch fallback (kept)
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
    const json = JSON.parse(text);
    return { ok, status, json, text };
  } catch {
    return { ok: false, status, json: null, text };
  }
}

// ✅ ADD: timeout fetchJson (used ONLY by /api/human-belief)
async function fetchJsonWithTimeout(url, timeoutMs = HUMAN_BELIEF_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
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
      const json = JSON.parse(text);
      return { ok: res.ok, status: res.status, json, text };
    } catch {
      return { ok: false, status: res.status, json: null, text };
    }
  } catch (e) {
    return { ok: false, status: 0, json: null, text: String(e) };
  } finally {
    clearTimeout(t);
  }
}

// ✅ CORRECT MAPPING with FULL model names for current market
function getCorrectEntryMap() {
  return {
    "0": "claude-haiku-4-5",
    "1": "gemini-3-flash-preview",
    "2": "gpt-5-mini",
    "3": "grok-4.1-fast-reasoning",
  };
}

// ------------------------------
// ✅ Settled/validation markets config
// ------------------------------
// NOTE: we keep your settled markets (0,1,3)
// and we ADD market 4 (current live) for Strategy Validation view.
const SETTLED_MARKETS_CONFIG = {
  0: {
    name: "Middleweight General Reasoning",
    winner: "QWEN/QWEN3-30B-A3B-INSTRUCT-2507",
    closedDate: "Dec 29, 2024",
    entryMap: {
      "0": "QWEN/QWEN3-30B-A3B-INSTRUCT-2507",
      "1": "ZAI-ORG/GLM-4-32B-0414",
      "2": "TIIUAE/FALCON-H1-34B-INSTRUCT",
      "3": "GOOGLE/GEMMA-3-27B-IT",
      "4": "OPENAI/GPT-OSS-20B",
    },
  },
  1: {
    name: "Middleweight General Reasoning (II)",
    winner: "QWEN/QWEN3-30B-A3B-INSTRUCT-2507",
    closedDate: "Dec 29, 2024",
    entryMap: {
      "0": "QWEN/QWEN3-30B-A3B-INSTRUCT-2507",
      "1": "OPENAI/GPT-OSS-20B",
      "2": "GOOGLE/GEMMA-3-27B-IT",
      "3": "ZAI-ORG/GLM-4-32B-0414",
      "4": "TIIUAE/FALCON-H1-34B-INSTRUCT",
    },
  },
  3: {
    name: "Lightweight General Reasoning",
    winner: "QWEN/QWEN3-8B",
    closedDate: "Jan 30, 2025",
    entryMap: {
      "0": "QWEN/QWEN3-8B",
      "1": "MISTRALAI/MINISTRAL-3-8B-INSTRUCT-2512",
      "2": "IBM-GRANITE/GRANITE-4.0-H-TINY",
      "3": "ALLENAI/OLMO-3-7B-INSTRUCT",
      "4": "META-LLAMA/LLAMA-3.1-8B-INSTRUCT",
    },
  },

  // ✅ ADD Market 4 to Strategy Validation
  4: {
    name: "Gensyn Lightweight General Reasoning Benchmark",
    // Winner will be fetched from Delphi API; keep fallback for safety:
    winner: "grok-4.1-fast-reasoning",
    closedDate: "Live",
    entryMap: getCorrectEntryMap(),
  },
};

// ------------------------------
// ✅ Winner resolution helpers
// ------------------------------
function isFiniteNumber(x) {
  return typeof x === "number" && Number.isFinite(x);
}

function pickWinnerFromChart(chartJson, entryMap) {
  // chartJson shape can vary; your /api/delphi-chart already handles it
  let market_chart = null;
  if (chartJson?.market_chart?.data_points) market_chart = chartJson.market_chart;
  else if (chartJson?.data_points) market_chart = chartJson;
  else if (chartJson?.data?.market_chart?.data_points) market_chart = chartJson.data.market_chart;

  const pts = market_chart?.data_points;
  if (!Array.isArray(pts) || pts.length === 0) return null;

  const last = pts[pts.length - 1];
  const entries = last?.entries;
  if (!Array.isArray(entries) || entries.length === 0) return null;

  let best = null;
  for (const e of entries) {
    const idx = String(e.entry_idx);
    const priceRaw = e.price;
    const price =
      typeof priceRaw === "string" ? Number(priceRaw) : typeof priceRaw === "number" ? priceRaw : NaN;
    if (!Number.isFinite(price)) continue;

    if (!best || price > best.price) best = { idx, price };
  }

  if (!best) return null;
  return entryMap?.[best.idx] || null;
}

async function fetchMarketDetailsById(marketId) {
  // Try common endpoint first
  const u1 = `https://delphi.gensyn.ai/api/markets/${marketId}`;
  const r1 = await fetchJson(u1);
  if (r1.ok && r1.json) return { source: u1, json: r1.json };

  // Fallback: list markets and find it
  const u2 = `https://delphi.gensyn.ai/api/markets?limit=100`;
  const r2 = await fetchJson(u2);
  const items = r2?.json?.items;
  if (r2.ok && Array.isArray(items)) {
    const found = items.find((m) => Number(m.market_id ?? m.id) === Number(marketId));
    if (found) return { source: u2, json: found };
  }

  return { source: null, json: null };
}

function readWinnerFromMarketObject(marketObj, entryMap) {
  if (!marketObj) return null;

  // If API already gives winner as string model name
  const directWinner =
    marketObj.winner ||
    marketObj.winning_model ||
    marketObj.winning_model_name ||
    marketObj.resolved_winner ||
    marketObj.resolution_winner;

  if (typeof directWinner === "string" && directWinner.trim()) return directWinner.trim();

  // If API gives winner index-like fields
  const idxFields = [
    "winning_entry_idx",
    "winner_entry_idx",
    "winner_idx",
    "resolved_entry_idx",
    "resolution_entry_idx",
    "resolution_idx",
  ];

  for (const f of idxFields) {
    const v = marketObj[f];
    if (isFiniteNumber(v) || (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)))) {
      const idx = String(v);
      return entryMap?.[idx] || null;
    }
  }

  // Sometimes nested resolution objects
  const nested =
    marketObj.resolution ||
    marketObj.resolve ||
    marketObj.settlement ||
    marketObj.settled ||
    marketObj.outcome;

  const nestedIdx = nested?.entry_idx ?? nested?.winner_entry_idx ?? nested?.winner_idx;
  if (isFiniteNumber(nestedIdx) || (typeof nestedIdx === "string" && Number.isFinite(Number(nestedIdx)))) {
    const idx = String(nestedIdx);
    return entryMap?.[idx] || null;
  }

  return null;
}

async function resolveActualWinner(marketId, entryMap, fallbackWinner) {
  // 1) Market details
  const { json: marketObj } = await fetchMarketDetailsById(marketId);
  const marketStatus = (marketObj?.status || marketObj?.market_status || "").toString().toLowerCase();

  const w1 = readWinnerFromMarketObject(marketObj, entryMap);
  if (w1) {
    return {
      actualWinner: w1,
      marketStatus: marketStatus || "unknown",
      winnerStatus: "from_market_api",
    };
  }

  // 2) Fallback: use chart last point highest price
  const chartUrl = `https://delphi.gensyn.ai/api/markets/${marketId}/chart?timeframe=auto`;
  const chartRes = await fetchJson(chartUrl);
  if (chartRes.ok && chartRes.json) {
    const w2 = pickWinnerFromChart(chartRes.json, entryMap);
    if (w2) {
      return {
        actualWinner: w2,
        marketStatus: marketStatus || "unknown",
        winnerStatus: "from_chart_top_price",
      };
    }
  }

  // 3) final fallback
  return {
    actualWinner: fallbackWinner || "TBD",
    marketStatus: marketStatus || "unknown",
    winnerStatus: "fallback_config",
  };
}

// ------------------------------
// Routes
// ------------------------------
app.get("/settled-markets", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "settled-markets.html"));
});

app.get("/what-is-delphi-beliefs", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "what-is-delphi-beliefs.html"));
});

// ✅ HISTORICAL ANALYSIS - now includes Market #4 + winner fetched from Delphi API
app.get("/api/historical-analysis", async (req, res) => {
  try {
    const results = [];

    for (const [marketIdStr, config] of Object.entries(SETTLED_MARKETS_CONFIG)) {
      const id = Number(marketIdStr);

      try {
        console.log(`\n🔄 Analyzing Market #${id}: ${config.name}`);

        const entryMap = config.entryMap || {};
        const modelCount = Object.keys(entryMap).length;

        console.log(`   Models: ${modelCount}`);

        // fetch evals for all entries
        const evalPromises = [];
        for (let idx = 0; idx < modelCount; idx++) {
          const evalUrl = `https://delphi.gensyn.ai/api/markets/${id}/evals?modelIdx=${idx}`;
          evalPromises.push(
            fetchJson(evalUrl)
              .then((r) => ({
                modelIdx: idx,
                data: r.json,
                success: r.ok,
              }))
              .catch((err) => ({
                modelIdx: idx,
                data: null,
                success: false,
                error: err.message,
              }))
          );
        }

        const allEvals = await Promise.all(evalPromises);

        const modelScores = {};
        let evalCount = 0;

        allEvals.forEach(({ modelIdx, data, success }) => {
          const modelName = entryMap[String(modelIdx)] || `Entry #${modelIdx}`;

          if (success && data && Array.isArray(data.evals) && data.evals.length) {
            const evals = data.evals;
            evalCount = Math.max(evalCount, evals.length);

            const aggregates = evals.map((e) => (typeof e.aggregate === "number" ? e.aggregate : 0));
            const avgAggregate = aggregates.reduce((sum, val) => sum + val, 0) / aggregates.length;

            modelScores[modelName] = avgAggregate;
            console.log(`   ${modelName}: ${avgAggregate.toFixed(2)} avg (${evals.length} evals)`);
          } else {
            console.log(`   ${modelName}: No data available`);
            modelScores[modelName] = 0;
          }
        });

        // predicted winner from eval averages
        const totalScore = Object.values(modelScores).reduce((sum, s) => sum + s, 0);
        const beliefs = {};
        let topModel = null;
        let topBelief = 0;

        if (totalScore > 0) {
          for (const [model, score] of Object.entries(modelScores)) {
            const belief = (score / totalScore) * 100;
            beliefs[model] = belief;
            if (belief > topBelief) {
              topBelief = belief;
              topModel = model;
            }
          }
        }

        // ✅ actual winner resolved from Delphi API (or chart) (fixes your grok issue)
        const winnerResolved = await resolveActualWinner(id, entryMap, config.winner);

        const actualWinner = winnerResolved.actualWinner;

        console.log(`   📊 Prediction: ${topModel} (${topBelief.toFixed(1)}%)`);
        console.log(`   🎯 Actual: ${actualWinner} (${winnerResolved.winnerStatus})`);

        const correct = !!topModel && !!actualWinner && String(topModel).trim() === String(actualWinner).trim();
        console.log(`   ${correct ? "✅ CORRECT" : "❌ INCORRECT"}`);

        // rankings
        const rankings = Object.entries(modelScores)
          .map(([model, score]) => ({ model, avgScore: score }))
          .sort((a, b) => b.avgScore - a.avgScore);

        results.push({
          marketId: id,
          marketName: config.name,
          market_status: winnerResolved.marketStatus || "unknown",
          closedDate: config.closedDate || "",
          actualWinner,
          actual_winner_source: winnerResolved.winnerStatus,

          predictedWinner: topModel || "No prediction",
          beliefScore: topBelief,

          correct,
          evalCount,
          allBeliefs: beliefs,
          rankings,
        });
      } catch (error) {
        console.error(`❌ Error processing market ${marketIdStr}:`, error);
        results.push({
          marketId: id,
          marketName: config?.name || `Market #${id}`,
          error: error.message || "Failed to fetch data",
        });
      }
    }

    const successfulResults = results.filter((r) => !r.error);
    const correctPredictions = successfulResults.filter((r) => r.correct).length;
    const winRate = successfulResults.length > 0 ? (correctPredictions / successfulResults.length) * 100 : 0;

    console.log(`\n📊 FINAL RESULTS:`);
    console.log(`   Total Markets: ${successfulResults.length}`);
    console.log(`   Correct: ${correctPredictions}`);
    console.log(`   Win Rate: ${winRate.toFixed(0)}%`);

    res.json({
      markets: results,
      winRate,
      totalMarkets: successfulResults.length,
      correctPredictions,
    });
  } catch (error) {
    console.error("❌ Historical analysis error:", error);
    res.status(500).json({ error: "Failed to fetch historical data" });
  }
});

app.get("/api/entry-map", async (req, res) => {
  try {
    const marketId = Number(req.query.market_id || MARKET_ID);
    const map = getCorrectEntryMap();

    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");

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

    const now = Date.now();
    if (delphiChartCache && now - delphiChartCacheTime < CACHE_DURATION_MS) {
      console.log("✅ Returning cached Delphi chart");
      return res.json(delphiChartCache);
    }

    const url = `https://delphi.gensyn.ai/api/markets/${marketId}/chart?timeframe=${encodeURIComponent(timeframe)}`;

    console.log("🔄 Fetching fresh Delphi chart from:", url);
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

    const response = {
      market_id: marketId,
      timeframe,
      fetched_at: new Date().toISOString(),
      chart_source: url,
      market_chart,
      entry_map: entryMap,
      entry_map_source: "correct_mapping",
    };

    delphiChartCache = response;
    delphiChartCacheTime = now;

    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.json(response);
  } catch (e) {
    console.error("❌ Error fetching Delphi chart:", e);
    res.status(500).json({ error: String(e) });
  }
});

app.get("/api/human-belief", async (req, res) => {
  try {
    const now = Date.now();

    if (humanBeliefCache && now - humanBeliefCacheTime < HUMAN_BELIEF_CACHE_MS) {
      return res.json(humanBeliefCache);
    }

    const timestamp = Date.now();
    console.log(`🔄 [${timestamp}] Fetching FRESH human belief data...`);

    const tasks = [
      fetchJsonWithTimeout("https://delphi.gensyn.ai/api/markets?limit=1&status=ongoing"),
      ...Array.from({ length: MODEL_COUNT }, (_, i) =>
        fetchJsonWithTimeout(`https://delphi.gensyn.ai/api/markets/${MARKET_ID}/evals?modelIdx=${i}`)
      ),
    ];

    const settled = await Promise.allSettled(tasks);

    const marketsResponse = settled[0].status === "fulfilled" ? settled[0].value : { ok: false, json: null };
    const evalResponses = settled.slice(1).map((s) => (s.status === "fulfilled" ? s.value : { ok: false, json: null }));

    const market = marketsResponse?.json?.items?.[0] || null;

    const raw = evalResponses.map((r) => r.json);

    const entryMap = getCorrectEntryMap();
    const modelNames = Array.from({ length: MODEL_COUNT }, (_, i) => entryMap[String(i)] || `Entry #${i}`);

    console.log(`✅ Human belief data fetched (with timeout protection):`);
    raw.forEach((evalData, idx) => {
      const count = Array.isArray(evalData?.evals) ? evalData.evals.length : 0;
      console.log(`   ${modelNames[idx]}: ${count} evals`);
    });

    const payload = {
      market_id: MARKET_ID,
      market_name: market?.market_name || "AI Model Performance",
      status: market?.status || "Active",
      fetched_at: new Date().toISOString(),
      model_names: modelNames,
      model_names_source: "correct_mapping",
      raw,
    };

    humanBeliefCache = payload;
    humanBeliefCacheTime = now;

    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");

    res.json(payload);
  } catch (e) {
    console.error("❌ Error fetching human belief:", e);
    res.status(500).json({ error: String(e) });
  }
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true, node: process.version });
});

app.listen(PORT, () => {
  console.log(`\n✅ Delphi Beliefs Dashboard Started`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📊 Main Dashboard:     http://localhost:${PORT}`);
  console.log(`🔬 Settled Markets:    http://localhost:${PORT}/settled-markets`);
  console.log(`⚡ Cache disabled - always fetches fresh data`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
});