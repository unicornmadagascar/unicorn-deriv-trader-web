// ==========================
// Unicorn Madagascar Web App
// ==========================

const APP_ID = 104747; // Example public app_id, you can replace if needed
const WS_URL = `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;
let ws, token, balance = 0, currentSymbol = "boom_1000";
let chart, areaSeries, priceLine;
let ticksData = [];
let openTrade = null;

// Gauges
const gaugeDashboard = document.getElementById("gaugeDashboard");

// Helper to create a gauge
function createGauge(label, color) {
  const container = document.createElement("canvas");
  gaugeDashboard.appendChild(container);
  const ctx = container.getContext("2d");
  return { ctx, value: 0, label, color };
}

const volatilityGauge = createGauge("Volatility", "#f87171");
const rsiGauge = createGauge("RSI Speed", "#60a5fa");
const emaGauge = createGauge("Trend Prob.", "#34d399");

// =============================
// INIT CHART
// =============================
const chartContainer = document.getElementById("chartInner");
chart = LightweightCharts.createChart(chartContainer, {
  layout: {
    background: { color: "transparent" },
    textColor: "#1e293b",
  },
  grid: {
    vertLines: { color: "#e2e8f0" },
    horzLines: { color: "#e2e8f0" },
  },
  crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
  rightPriceScale: { borderVisible: false },
  timeScale: { borderVisible: false },
});

areaSeries = chart.addAreaSeries({
  topColor: "rgba(37,99,235,0.4)",
  bottomColor: "rgba(37,99,235,0.0)",
  lineColor: "#2563eb",
  lineWidth: 2,
});

priceLine = chart.addLineSeries({
  color: "#ef4444",
  lineWidth: 1,
  lineStyle: LightweightCharts.LineStyle.Dotted,
  priceLineVisible: false,
});

// Tooltip
const tooltip = document.createElement("div");
tooltip.style = `
  position: absolute;
  background: rgba(255,255,255,0.9);
  border: 1px solid #ccc;
  border-radius: 6px;
  padding: 5px 8px;
  font-size: 12px;
  pointer-events: none;
  z-index: 20;
  display:none;
`;
chartContainer.appendChild(tooltip);

chart.subscribeCrosshairMove(param => {
  if (!param.time || !param.point) {
    tooltip.style.display = "none";
    return;
  }
  const price = param.seriesPrices.get(areaSeries);
  tooltip.style.display = "block";
  tooltip.style.left = param.point.x + 20 + "px";
  tooltip.style.top = param.point.y + "px";
  tooltip.innerHTML = `💰 ${price?.toFixed(2)}`;
});

// =============================
// CONNECT TO DERIV API
// =============================
document.getElementById("connectBtn").onclick = () => {
  token = document.getElementById("tokenInput").value.trim();
  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    document.getElementById("status").textContent = "Connected ✅";
    if (token) ws.send(JSON.stringify({ authorize: token }));
    ws.send(JSON.stringify({ ticks_history: currentSymbol, count: 200, end: "latest", style: "ticks" }));
  };

  ws.onmessage = e => {
    const data = JSON.parse(e.data);
    if (data.msg_type === "authorize") {
      document.getElementById("userBalance").textContent = `Balance: ${data.authorize.balance.toFixed(2)} USD`;
      balance = data.authorize.balance;
    }
    if (data.msg_type === "history") {
      ticksData = data.history.prices.map((p, i) => ({
        time: data.history.times[i],
        value: parseFloat(p),
      }));
      areaSeries.setData(ticksData);
    }
    if (data.msg_type === "tick") {
      const tick = { time: data.tick.epoch, value: parseFloat(data.tick.quote) };
      ticksData.push(tick);
      if (ticksData.length > 300) ticksData.shift();
      areaSeries.update(tick);
      updateGauges(ticksData);
      updatePriceLabel(tick.value);
    }
  };
};

// =============================
// LIVE TICK STREAM
// =============================
function subscribeTicks(symbol) {
  if (!ws) return;
  ws.send(JSON.stringify({ forget_all: ["ticks"] }));
  ws.send(JSON.stringify({ ticks: symbol }));
}

subscribeTicks(currentSymbol);

// =============================
// GAUGE UPDATE (Volatility/RSI/EMA)
// =============================
function updateGauges(data) {
  if (data.length < 30) return;

  const closes = data.map(d => d.value);
  const mean = closes.reduce((a, b) => a + b, 0) / closes.length;
  const variance = closes.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / closes.length;
  const volatility = Math.sqrt(variance) / mean * 100;

  const gains = closes.slice(1).map((v, i) => v - closes[i]);
  const avgGain = gains.filter(g => g > 0).reduce((a, b) => a + b, 0) / 14;
  const avgLoss = -gains.filter(g => g < 0).reduce((a, b) => a + b, 0) / 14;
  const rs = avgGain / (avgLoss || 1);
  const rsi = 100 - 100 / (1 + rs);

  const ema = closes.reduce((acc, val, i) => {
    const k = 2 / (10 + 1);
    return acc + (val - acc) * k;
  });

  volatilityGauge.value = Math.min(100, volatility * 2);
  rsiGauge.value = rsi;
  emaGauge.value = Math.abs((ema - closes[closes.length - 1]) / closes[closes.length - 1]) * 100;

  drawGauge(volatilityGauge);
  drawGauge(rsiGauge);
  drawGauge(emaGauge);
}

function drawGauge(g) {
  const { ctx } = g;
  ctx.clearRect(0, 0, 120, 120);
  const value = g.value;
  ctx.beginPath();
  ctx.arc(60, 60, 50, Math.PI, Math.PI + (value / 100) * Math.PI, false);
  ctx.lineWidth = 10;
  ctx.strokeStyle = g.color;
  ctx.stroke();
  ctx.font = "12px Inter";
  ctx.fillStyle = "#1e293b";
  ctx.textAlign = "center";
  ctx.fillText(`${g.label}`, 60, 70);
  ctx.fillText(`${value.toFixed(1)}%`, 60, 90);
}

// =============================
// UPDATE PRICE LABEL
// =============================
function updatePriceLabel(price) {
  priceLine.setData([{ time: ticksData[ticksData.length - 1].time, value: price }]);
}

// =============================
// TRADING SYSTEM
// =============================
const buyBtn = document.getElementById("buyBtn");
const sellBtn = document.getElementById("sellBtn");

buyBtn.onclick = () => placeTrade("BUY");
sellBtn.onclick = () => placeTrade("SELL");

function placeTrade(direction) {
  const mode = document.getElementById("modeSelect").value;
  const stake = parseFloat(document.getElementById("stake").value);
  const multiplier = parseInt(document.getElementById("timeframe").value);
  const lastPrice = ticksData[ticksData.length - 1].value;

  const arrow = {
    time: ticksData[ticksData.length - 1].time,
    position: direction === "BUY" ? "belowBar" : "aboveBar",
    color: direction === "BUY" ? "#22c55e" : "#ef4444",
    shape: "arrowUp",
    text: direction + " @ " + lastPrice.toFixed(2),
  };
  areaSeries.setMarkers([arrow]);

  priceLine.setData([{ time: arrow.time, value: lastPrice }]);
  priceLine.applyOptions({ color: "#ef4444", lineStyle: 1 });

  if (mode === "simulation") {
    openTrade = { direction, entry: lastPrice, stake, multiplier };
    document.getElementById("historyList").innerHTML += `<div>${direction} @ ${lastPrice}</div>`;
  } else {
    if (!ws || !token) return alert("Please connect with your Deriv API token.");
    const payload = {
      buy: 1,
      price: 0,
      parameters: {
        amount: stake,
        basis: "stake",
        contract_type: direction === "BUY" ? "MULTUP" : "MULTDOWN",
        currency: "USD",
        multiplier: multiplier,
        symbol: currentSymbol.toUpperCase(),
      },
    };
    ws.send(JSON.stringify(payload));
  }
}
