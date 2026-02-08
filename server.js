const express = require("express");
const path = require("path");

const app = express();
const PORT = 3000;

const MARKET_ID = 4;
const MODEL_COUNT = 4;

// ✅ CACHE to avoid waiting for API calls every time
let delphiChartCache = null;
let delphiChartCacheTime = 0;
const CACHE_DURATION_MS = 10000; // 10 seconds

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
    "0": "claude-haiku-4-5",
    "1": "gemini-3-flash-preview",
    "2": "gpt-5-mini",
    "3": "grok-4.1-fast-reasoning",
  };
}

// ✅ KNOWN WINNERS from Gensyn website
const SETTLED_MARKETS_WINNERS = {
  0: 'Qwen/Qwen3-30B-A3B-Instruct-2507',
  1: 'Qwen/Qwen3-30B-A3B-Instruct-2507',
  3: 'Qwen/Qwen3-8B'
};

// ✅ SETTLED MARKETS ROUTE
app.get("/settled-markets", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "settled-markets.html"));
});

// ✅ HISTORICAL ANALYSIS - FINAL WORKING VERSION
app.get("/api/historical-analysis", async (req, res) => {
  try {
    const settledMarkets = [
      { id: 0, name: 'Middleweight General Reasoning' },
      { id: 1, name: 'Middleweight General Reasoning (II)' },
      { id: 3, name: 'Lightweight General Reasoning' }
    ];

    const results = [];

    for (const market of settledMarkets) {
      try {
        const marketId = market.id;
        console.log(`\n🔄 Analyzing Market #${marketId}: ${market.name}`);
        
        // Fetch entry map
        const entryMapUrl = `https://delphi.gensyn.ai/api/markets/${marketId}/entry-map`;
        const entryMapResponse = await fetchJson(entryMapUrl);
        const entryMapData = entryMapResponse.json || {};
        const entryMap = entryMapData.map || entryMapData || {};
        
        const modelCount = Object.keys(entryMap).length || 4;
        console.log(`   Models: ${modelCount}`);

        // Fetch evals for all models
        const evalPromises = [];
        for (let idx = 0; idx < modelCount; idx++) {
          const evalUrl = `https://delphi.gensyn.ai/api/markets/${marketId}/evals?modelIdx=${idx}`;
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

        // Calculate average aggregate scores
        const modelScores = {};
        let evalCount = 0;

        allEvals.forEach(({ modelIdx, data, success }) => {
          const modelName = entryMap[String(modelIdx)] || `Model ${modelIdx}`;
          
          if (success && data && Array.isArray(data.evals)) {
            const evals = data.evals;
            evalCount = Math.max(evalCount, evals.length);
            
            // Calculate average of all aggregate scores
            const aggregates = evals.map(e => e.aggregate || 0);
            const avgAggregate = aggregates.reduce((sum, val) => sum + val, 0) / aggregates.length;
            
            modelScores[modelName] = avgAggregate;
            console.log(`   ${modelName}: ${avgAggregate.toFixed(2)} avg (${evals.length} evals)`);
          } else {
            console.log(`   ${modelName}: No data available`);
            modelScores[modelName] = 0;
          }
        });

        // Calculate normalized beliefs
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

        // Get known winner
        const actualWinner = SETTLED_MARKETS_WINNERS[marketId];
        
        console.log(`   📊 Prediction: ${topModel} (${topBelief.toFixed(1)}%)`);
        console.log(`   🎯 Actual: ${actualWinner}`);

        // Check if prediction matches
        const correct = topModel && actualWinner && (
          topModel === actualWinner ||
          topModel.toLowerCase().includes(actualWinner.toLowerCase()) ||
          actualWinner.toLowerCase().includes(topModel.toLowerCase())
        );

        console.log(`   ${correct ? '✅ CORRECT' : '❌ INCORRECT'}`);

        results.push({
          marketId: marketId,
          marketName: market.name,
          actualWinner: actualWinner,
          predictedWinner: topModel || 'No prediction',
          beliefScore: topBelief,
          correct: correct,
          evalCount: evalCount,
          allBeliefs: beliefs
        });

      } catch (error) {
        console.error(`❌ Error processing market ${market.id}:`, error);
        results.push({
          marketId: market.id,
          marketName: market.name,
          error: error.message || 'Failed to fetch data'
        });
      }
    }

    // Calculate overall stats
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

    res.setHeader("Cache-Control", "public, max-age=60");
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

    res.setHeader("Cache-Control", "public, max-age=10");
    res.json(response);
  } catch (e) {
    console.error("❌ Error fetching Delphi chart:", e);
    res.status(500).json({ error: String(e) });
  }
});

app.get("/api/human-belief", async (req, res) => {
  try {
    console.log("🔄 Fetching human belief data...");
    
    const [marketsResponse, ...evalResponses] = await Promise.all([
      fetchJson("https://delphi.gensyn.ai/api/markets?limit=1&status=ongoing"),
      ...Array.from({ length: MODEL_COUNT }, (_, i) =>
        fetchJson(`https://delphi.gensyn.ai/api/markets/${MARKET_ID}/evals?modelIdx=${i}`)
      )
    ]);

    const market = marketsResponse?.json?.items?.[0] || null;
    const raw = evalResponses.map((r) => r.json);

    const entryMap = getCorrectEntryMap();
    const modelNames = Array.from({ length: MODEL_COUNT }, (_, i) => {
      return entryMap[String(i)] || `Entry #${i}`;
    });

    console.log("✅ Human belief data fetched successfully");

    res.setHeader("Cache-Control", "public, max-age=5");
    res.json({
      market_id: MARKET_ID,
      market_name: market?.market_name || "AI Model Performance",
      status: market?.status || "Active",
      fetched_at: new Date().toISOString(),
      model_names: modelNames,
      model_names_source: "correct_mapping",
      raw,
    });
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
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
});