// app.js - Unicorn Deriv Trader (Web)
// Deriv WebSocket API + Lightweight Charts

const APP_ID = 105747; // Example App ID
const WS_URL = `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;
let ws = null;
let currentSymbol = null;
let chart = null;
let lineSeries = null;

// UI Elements
const tokenInput = document.getElementById("tokenInput");
const connectBtn = document.getElementById("connectBtn");
const statusSpan = document.getElementById("status");
const userBalance = document.getElementById("userBalance");
const symbolList = document.getElementById("symbolList");
const historyList = document.getElementById("historyList");
const pnlDisplay = document.getElementById("pnl");
const buyBtn = document.getElementById("buyBtn");
const sellBtn = document.getElementById("sellBtn");
const closeBtn = document.getElementById("closeBtn");

// Connection
connectBtn.onclick = () => {
  ws = new WebSocket(WS_URL);
  ws.onopen = () => {
    statusSpan.textContent = "✅ Connected";
    const token = tokenInput.value.trim();
    if (token) {
      ws.send(JSON.stringify({ authorize: token }));
    } else {
      loadSymbols();
    }
  };

  ws.onmessage = (msg) => {
    const data = JSON.parse(msg.data);
    if (data.msg_type === "authorize") {
      userBalance.textContent = `Balance: ${data.authorize.balance} USD`;
      loadSymbols();
    }

    if (data.msg_type === "active_symbols") {
      displaySymbols(data.active_symbols);
    }

    if (data.msg_type === "history") {
      drawHistoricalData(data.history);
    }

    if (data.msg_type === "tick") {
      updateChartWithTick(data.tick);
    }
  };
};

// Load symbols
function loadSymbols() {
  ws.send(
    JSON.stringify({
      active_symbols: "brief",
      product_type: "basic",
    })
  );
}

// Display symbol list
function displaySymbols(symbols) {
  symbolList.innerHTML = "";
  symbols
    .filter((s) => s.symbol.startsWith("R_") || s.symbol.startsWith("BOOM") || s.symbol.startsWith("CRASH"))
    .forEach((s) => {
      const div = document.createElement("div");
      div.className = "symbolItem";
      div.textContent = `${s.display_name}`;
      div.onclick = () => selectSymbol(s.symbol);
      symbolList.appendChild(div);
    });
}

// Select a symbol
function selectSymbol(symbol) {
  currentSymbol = symbol;
  document.querySelectorAll(".symbolItem").forEach((el) => el.classList.remove("active"));
  const selected = [...document.querySelectorAll(".symbolItem")].find(
    (el) => el.textContent.includes(symbol)
  );
  if (selected) selected.classList.add("active");

  initChart();
  requestHistoricalData(symbol);
  subscribeTicks(symbol);
}

// Initialize chart
function initChart() {
  const chartContainer = document.getElementById("chartInner");
  chartContainer.innerHTML = ""; // reset
  chart = LightweightCharts.createChart(chartContainer, {
    layout: {
      background: { color: "#ffffff" },
      textColor: "#333",
    },
    grid: {
      vertLines: { color: "#e0e0e0" },
      horzLines: { color: "#e0e0e0" },
    },
    timeScale: { borderColor: "#ccc" },
    rightPriceScale: { borderColor: "#ccc" },
  });
  lineSeries = chart.addLineSeries({
    color: "#007bff",
    lineWidth: 2,
  });
}

// Request 300 last historical ticks
function requestHistoricalData(symbol) {
  ws.send(
    JSON.stringify({
      ticks_history: symbol,
      adjust_start_time: 1,
      count: 300,
      end: "latest",
      start: 1,
      style: "ticks",
    })
  );
}

// Draw historical ticks
function drawHistoricalData(history) {
  if (!history || !history.prices || history.prices.length === 0) return;

  const data = history.prices.map((p, i) => ({
    time: history.times[i],
    value: p,
  }));

  if (lineSeries) lineSeries.setData(data);
}

// Subscribe to live ticks
function subscribeTicks(symbol) {
  ws.send(
    JSON.stringify({
      ticks_subscribe: symbol,
    })
  );
}

// Update chart with live tick
function updateChartWithTick(tick) {
  if (!tick || !tick.quote || !lineSeries) return;
  lineSeries.update({ time: tick.epoch, value: tick.quote });
}

// Simple demo trade buttons
buyBtn.onclick = () => logTrade("BUY");
sellBtn.onclick = () => logTrade("SELL");
closeBtn.onclick = () => logTrade("CLOSE");

// Log trades
function logTrade(type) {
  const div = document.createElement("div");
  div.textContent = `${new Date().toLocaleTimeString()} - ${type} ${currentSymbol || ""}`;
  historyList.prepend(div);
}
