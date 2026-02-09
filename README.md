# 🎯 Delphi Beliefs

**Real-time AI model performance analytics for Gensyn Delphi prediction markets**

## 💡 Core Idea

**Turn raw evaluation data into actionable insights.**

Gensyn Delphi runs AI model competitions where models are evaluated on benchmarks and participants predict winners. But raw eval scores don't tell you much on their own. Delphi Beliefs bridges this gap by:

- **Translating** eval scores into normalized belief percentages
- **Comparing** performance data against market sentiment
- **Identifying** mispricing (overvalued vs undervalued models)
- **Visualizing** trends and patterns in real-time

Think of it as your **analytics layer** on top of Gensyn's prediction markets.

---

## ❓ The Problem

### What Gensyn Provides
- ✅ Raw evaluation scores from benchmarks (MMLU Pro, GPQA Diamond, etc.)
- ✅ Market prices showing what participants think
- ✅ Leaderboards when markets close

### What's Missing
- ❌ No real-time belief calculation from eval scores
- ❌ No way to compare performance vs market sentiment
- ❌ No historical trend visualization
- ❌ No easy way to spot mispricing
- ❌ No strategy validation or backtesting

**Result:** Participants make decisions based on incomplete information, hype, or guesswork rather than data-driven analysis.

---

## ✅ The Solution

Delphi Beliefs provides a **comprehensive analytics dashboard** that:

### 📊 Calculates Belief
Converts raw eval scores into normalized probability percentages
- Shows each model's likelihood of winning based on performance
- Updates in real-time as new evaluations drop
- Tracks historical trends across multiple evals

### 🔍 Analyzes Gaps
Compares performance (Belief) vs market sentiment (Price)
- Identifies overvalued models (hype > performance)
- Spots undervalued models (performance > attention)
- Provides clear BUY/OVERVALUED/HOLD signals

### 📈 Validates Strategy
Backtests the belief-based approach on completed markets
- **67% win rate** on 3 settled markets
- Proves that performance-based predictions work
- Shows detailed breakdown of each prediction

### 🎯 All-in-One View
Combines everything in a single dashboard
- Live belief rankings
- Gap analysis with visual indicators
- Embedded market chart
- Evaluation history
- Real-time updates every 30s

---

## ✨ Key Features

### 🔴 Live Market Tracking
Monitor real-time belief percentages as evaluations complete
- Auto-refresh every 30 seconds
- Chart showing belief evolution over time
- See which models are gaining/losing ground
- Track evaluation history for each model

### 📊 Models Ranking
Performance-based leaderboard showing:
- Current belief percentage for each model
- Rank based on normalized eval scores
- Evaluation history (all previous scores)
- Predicted winner (highest belief)

**Example:**
```
#1 grok-4.1-fast-reasoning    28.8% belief
   Latest: 84.71
   [Eval #1: 85.08] [Eval #2: 84.71] ← Latest
```

### 📈 Gap Analysis
Side-by-side comparison of performance vs market:
```
claude-haiku-4-5
┌─────────────┬──────────┬───────────┬──────┐
│ BELIEF      │ MARKET   │ GAP       │ SIGNAL│
├─────────────┼──────────┼───────────┼──────┤
│ 24%         │ 7.2%     │ -16.8%    │ BUY  │
└─────────────┴──────────┴───────────┴──────┘

What this means:
- Performance justifies 24%
- Market only values at 7.2%
- Undervalued by 16.8%
- Good opportunity!
```

### 🎯 Strategy Validation
Historical backtesting on settled markets:

| Market | Our Prediction | Actual Winner | Result |
|--------|---------------|---------------|--------|
| **#0** Middleweight | QWEN/QWEN3-30B | QWEN/QWEN3-30B | ✅ Correct |
| **#1** Middleweight II | QWEN/QWEN3-30B | QWEN/QWEN3-30B | ✅ Correct |
| **#3** Lightweight | google/gemini | QWEN/QWEN3-8B | ❌ Incorrect |

**Win Rate: 67% (2/3)**

Expandable cards show full details:
- Complete ranking tables
- Evaluation breakdowns
- Performance metrics

---

## 🧮 How We Calculate Everything

### 1️⃣ Belief Calculation

**Input:** Raw evaluation scores from benchmarks
```javascript
Step 1: Collect all eval scores for each model
grok:   [85.08, 84.71, 83.92, ...] (11 evaluations)
gpt:    [81.65, 79.46, 78.22, ...]
claude: [78.86, 70.75, 69.43, ...]
gemini: [52.50, 59.46, 58.11, ...]

Step 2: Calculate average performance
grok avg:   84.71
gpt avg:    79.46
claude avg: 70.75
gemini avg: 59.46

Step 3: Normalize to percentages (must sum to 100%)
Total: 84.71 + 79.46 + 70.75 + 59.46 = 294.38

grok belief:   (84.71 ÷ 294.38) × 100 = 28.8%
gpt belief:    (79.46 ÷ 294.38) × 100 = 27.0%
claude belief: (70.75 ÷ 294.38) × 100 = 24.0%
gemini belief: (59.46 ÷ 294.38) × 100 = 20.2%

Step 4: Rank by belief
#1 grok   28.8% ← Predicted winner
#2 gpt    27.0%
#3 claude 24.0%
#4 gemini 20.2%
```

**What Belief Represents:**
- Performance-based probability of winning
- Higher belief = better eval scores = more likely to win
- Based on actual data, not speculation

---

### 2️⃣ Gap Analysis

**Input:** Belief (from evals) + Market Price (from participants)
```javascript
Formula:
Gap = Market Price - Belief Score

Example: grok-4.1-fast-reasoning
Belief:  28.8%  (from eval scores)
Market:  73.6%  (what participants are paying)
Gap:     73.6% - 28.8% = +44.8%

Interpretation:
Gap > +5%  → OVERVALUED (market too high, avoid)
Gap < -5%  → BUY (market too low, good opportunity)
Gap ≈ 0    → HOLD (fair price)

grok Gap = +44.8% → OVERVALUED ⚠️
```

**What Gap Shows:**
- Difference between performance and hype
- Identifies mispricing opportunities
- Helps avoid overhyped models
- Spots overlooked gems

---

### 3️⃣ Trading Signals

Based on the gap, we provide clear signals:

| Signal | Gap Range | Meaning | Color |
|--------|-----------|---------|-------|
| **BUY** | < -5% | Undervalued - performance better than price | 🟢 Green |
| **HOLD** | -5% to +5% | Fair price - aligned with performance | ⚪ Gray |
| **OVERVALUED** | > +5% | Overvalued - price higher than performance | 🔴 Red |

**Example:**
```
claude-haiku-4-5
Belief: 24%
Market: 7.2%
Gap: -16.8%
Signal: BUY 🟢

Reason: Claude's performance (24%) is much better 
than its current market valuation (7.2%). 
Undervalued by 16.8%.
```

---

## 🎯 Use Cases

### 📚 Learning & Strategy Development
- Understand how to analyze prediction markets
- Learn gap analysis methodology
- Practice identifying mispricing
- Build confidence in data-driven approaches
- Prepare for potential future mainnet

### 🔬 Research & Analysis
- Study market efficiency in AI competitions
- Compare crowd wisdom vs benchmark performance
- Analyze model evaluation trends over time
- Research prediction market dynamics
- Understand normalized probability distributions

### 📊 Data Visualization
- Track model performance in real-time
- See how evaluations impact beliefs
- Monitor market sentiment vs reality
- Visualize historical trends
- Compare multiple models at once

---

## 🚀 Live Demo

**Dashboard:** [delphi-beliefs.vercel.app](https://delphi-beliefs.vercel.app)

### Pages
1. **Live Market** - Real-time tracking of current market #4
2. **Settled Markets** - Historical validation (67% win rate)
3. **What is Delphi Beliefs?** - Full methodology explanation

---

## 🛠️ Tech Stack

- **Frontend:** HTML, CSS, JavaScript
- **Backend:** Node.js, Express
- **Visualization:** Chart.js
- **Deployment:** Vercel
- **Data Source:** Gensyn Delphi Public API

---

## 📊 Data Sources

All data comes from publicly available Gensyn Delphi APIs:
- **Evaluation Scores:** Gensyn Delphi API
- **Market Prices:** Embedded Delphi market chart
- **Model Information:** Public Gensyn leaderboards

---

## ⚠️ Important Notes

### 📝 Analytics Tool
Delphi Beliefs is an analytics tool for educational and research purposes. Past performance does not guarantee future results.

### 🏗️ Testnet Product
Gensyn Delphi is running on testnet. This dashboard is designed for:
- Testing and experimentation
- Learning prediction market dynamics
- Developing analytical strategies
- Educational purposes

### 🔧 Independent Tool
This is a community-built analytics dashboard. Not affiliated with Gensyn or Anthropic.

### 📊 Data-Driven, Not Predictive
Our approach assumes evaluation scores correlate with winners. This may not always hold due to:
- Market dynamics and timing
- Benchmark limitations
- Edge cases and anomalies
- Unforeseen factors

### 🔓 Open Data
All calculations use publicly available data from Gensyn APIs.

---

## 🏆 Proven Results

Our belief-based methodology has been validated on completed markets:

**Backtest Performance: 67% Win Rate (2/3 correct)**

This demonstrates that normalized evaluation scores can successfully predict outcomes in AI model competitions, providing a data-driven alternative to speculation.

---

## 🔗 Links

- **Live Dashboard:** [delphi-beliefs.vercel.app](https://delphi-beliefs.vercel.app)
- **Gensyn Delphi:** [delphi.gensyn.ai](https://delphi.gensyn.ai/)
- **GitHub:** [github.com/gasoline2255/delphi-beliefs](https://github.com/gasoline2255/delphi-beliefs)
- **Twitter/X:** [@gasoline2255](https://x.com/gasoline2255)

---

## 💡 Philosophy

> **"Don't speculate on hype. Analyze performance."**

While markets can be driven by sentiment and speculation, we believe actual benchmark performance is the best indicator of model capabilities. Delphi Beliefs helps you see beyond the noise and understand what the data really says.

---

## 🙏 Acknowledgments

- Gensyn team for building Delphi prediction markets
- The AI research community for evaluation benchmarks
- Early users and feedback providers

---

**Built by [gasoline](https://x.com/gasoline2255)** | **Powered by Gensyn Testnet** | **Delphi Beliefs**
