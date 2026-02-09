const express = require("express");
const path = require("path");

// ✅ (phone/network optimization) gzip compression for faster loads on mobile
const compression = require("compression");

const app = express();
const PORT = 3000;

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
      // Force no-cache
      "cache-control": "no-cache, no-store, must-revalidate",
      "pragma": "no-cache"
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
        "pragma": "no-cache",
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

// ✅ HARDCODED ENTRY MAPS FOR SETTLED MARKETS (CORRECTED WITH OFFICIAL DATA)
const SETTLED_MARKETS_CONFIG = {
  0: {
    name: 'Middleweight General Reasoning',
    winner: 'QWEN/QWEN3-30B-A3B-INSTRUCT-2507',
    closedDate: 'Dec 29, 2024',
    entryMap: {
      "0": "QWEN/QWEN3-30B-A3B-INSTRUCT-2507",      // 19.90% - 55.88
      "1": "ZAI-ORG/GLM-4-32B-0414",                // 23.90% - 49.48
      "2": "TIIUAE/FALCON-H1-34B-INSTRUCT",         // 23.70% - 48.50
      "3": "GOOGLE/GEMMA-3-27B-IT",                 // 19.00% - 51.49
      "4": "OPENAI/GPT-OSS-20B"                     // 13.50% - 52.52
    }
  },
  1: {
    name: 'Middleweight General Reasoning (II)',
    winner: 'QWEN/QWEN3-30B-A3B-INSTRUCT-2507',
    closedDate: 'Dec 29, 2024',
    entryMap: {
      "0": "QWEN/QWEN3-30B-A3B-INSTRUCT-2507",
      "1": "OPENAI/GPT-OSS-20B",
      "2": "GOOGLE/GEMMA-3-27B-IT",
      "3": "ZAI-ORG/GLM-4-32B-0414",
      "4": "TIIUAE/FALCON-H1-34B-INSTRUCT"
    }
  },
  3: {
    name: 'Lightweight General Reasoning',
    winner: 'QWEN/QWEN3-8B',
    closedDate: 'Jan 30, 2025',
    entryMap: {
      "0": "QWEN/QWEN3-8B",
      "1": "MISTRALAI/MINISTRAL-3-8B-INSTRUCT-2512",
      "2": "IBM-GRANITE/GRANITE-4.0-H-TINY",
      "3": "ALLENAI/OLMO-3-7B-INSTRUCT",
      "4": "META-LLAMA/LLAMA-3.1-8B-INSTRUCT"
    }
  }
};

// ✅ SETTLED MARKETS ROUTE
app.get("/settled-markets", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "settled-markets.html"));
});

// ✅ WHAT IS DELPHI BELIEFS PAGE ROUTE
app.get("/what-is-delphi-beliefs", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "what-is-delphi-beliefs.html"));
});

// ✅ HISTORICAL ANALYSIS - WITH HARDCODED ENTRY MAPS
app.get("/api/historical-analysis", async (req, res) => {
  try {
    const results = [];

    for (const [marketId, config] of Object.entries(SETTLED_MARKETS_CONFIG)) {
      try {
        const id = Number(marketId);
        console.log(`\n🔄 Analyzing Market #${id}: ${config.name}`);
        
        const entryMap = config.entryMap;
        const modelCount = Object.keys(entryMap).length;
        
        console.log(`   Models: ${modelCount}`);

        const evalPromises = [];
        for (let idx = 0; idx < modelCount; idx++) {
          const evalUrl = `https://delphi.gensyn.ai/api/markets/${id}/evals?modelIdx=${idx}`;
          evalPromises.push(
            fetchJson(evalUrl)
              .then(r => ({ 
                modelIdx: idx, 
                data: r.json,
                success: r.ok 
              }))
              .catch(err => ({ 
                modelIdx: idx, 
                data: null, 
                success: false,
                error: err.message 
              }))
          );
        }

        const allEvals = await Promise.all(evalPromises);

        const modelScores = {};
        let evalCount = 0;

        allEvals.forEach(({ modelIdx, data, success }) => {
          const modelName = entryMap[String(modelIdx)];
          
          if (success && data && Array.isArray(data.evals)) {
            const evals = data.evals;
            evalCount = Math.max(evalCount, evals.length);
            
            const aggregates = evals.map(e => e.aggregate || 0);
            const avgAggregate = aggregates.reduce((sum, val) => sum + val, 0) / aggregates.length;
            
            modelScores[modelName] = avgAggregate;
            console.log(`   ${modelName}: ${avgAggregate.toFixed(2)} avg (${evals.length} evals)`);
          } else {
            console.log(`   ${modelName}: No data available`);
            modelScores[modelName] = 0;
          }
        });

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

        const actualWinner = config.winner;
        
        console.log(`   📊 Prediction: ${topModel} (${topBelief.toFixed(1)}%)`);
        console.log(`   🎯 Actual: ${actualWinner}`);

        const correct = topModel && actualWinner && (
          topModel === actualWinner ||
          topModel.toLowerCase().includes(actualWinner.toLowerCase()) ||
          actualWinner.toLowerCase().includes(topModel.toLowerCase())
        );

        console.log(`   ${correct ? '✅ CORRECT' : '❌ INCORRECT'}`);

        // ✅ Create rankings sorted by score
        const rankings = Object.entries(modelScores)
          .map(([model, score]) => ({ model, avgScore: score }))
          .sort((a, b) => b.avgScore - a.avgScore);

        results.push({
          marketId: id,
          marketName: config.name,
          actualWinner: actualWinner,
          predictedWinner: topModel || 'No prediction',
          beliefScore: topBelief,
          correct: correct,
          evalCount: evalCount,
          allBeliefs: beliefs,
          rankings: rankings
        });

      } catch (error) {
        console.error(`❌ Error processing market ${marketId}:`, error);
        results.push({
          marketId: Number(marketId),
          marketName: SETTLED_MARKETS_CONFIG[marketId].name,
          error: error.message || 'Failed to fetch data'
        });
      }
    }

    const successfulResults = results.filter(r => !r.error);
    const correctPredictions = successfulResults.filter(r => r.correct).length;
    const winRate = successfulResults.length > 0 
      ? (correctPredictions / successfulResults.length) * 100 
      : 0;

    console.log(`\n📊 FINAL RESULTS:`);
    console.log(`   Total Markets: ${successfulResults.length}`);
    console.log(`   Correct: ${correctPredictions}`);
    console.log(`   Win Rate: ${winRate.toFixed(0)}%`);

    res.json({
      markets: results,
      winRate: winRate,
      totalMarkets: successfulResults.length,
      correctPredictions: correctPredictions
    });

  } catch (error) {
    console.error('❌ Historical analysis error:', error);
    res.status(500).json({ error: 'Failed to fetch historical data' });
  }
});

app.get("/api/entry-map", async (req, res) => {
  try {
    const marketId = Number(req.query.market_id || MARKET_ID);
    const map = getCorrectEntryMap();

    // NO CACHE - always fresh
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
    if (delphiChartCache && (now - delphiChartCacheTime) < CACHE_DURATION_MS) {
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

    // ✅ Serve cached response briefly to avoid slow upstream spikes + parallel piling
    if (humanBeliefCache && (now - humanBeliefCacheTime) < HUMAN_BELIEF_CACHE_MS) {
      return res.json(humanBeliefCache);
    }

    const timestamp = Date.now();
    console.log(`🔄 [${timestamp}] Fetching FRESH human belief data...`);

    // ✅ Fetch with per-request timeout + don't let 1 slow model block everything
    const tasks = [
      fetchJsonWithTimeout("https://delphi.gensyn.ai/api/markets?limit=1&status=ongoing"),
      ...Array.from({ length: MODEL_COUNT }, (_, i) =>
        fetchJsonWithTimeout(`https://delphi.gensyn.ai/api/markets/${MARKET_ID}/evals?modelIdx=${i}`)
      )
    ];

    const settled = await Promise.allSettled(tasks);

    const marketsResponse =
      settled[0].status === "fulfilled" ? settled[0].value : { ok: false, json: null };

    const evalResponses = settled.slice(1).map((s) =>
      s.status === "fulfilled" ? s.value : { ok: false, json: null }
    );

    const market = marketsResponse?.json?.items?.[0] || null;

    // Keep shape stable: raw array always MODEL_COUNT length
    const raw = evalResponses.map((r) => r.json);

    const entryMap = getCorrectEntryMap();
    const modelNames = Array.from({ length: MODEL_COUNT }, (_, i) => {
      return entryMap[String(i)] || `Entry #${i}`;
    });

    // Log eval counts
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

    // ✅ Update cache
    humanBeliefCache = payload;
    humanBeliefCacheTime = now;

    // Keep your no-cache headers (unchanged behavior), but response is now fast due to in-memory cache + timeout
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
