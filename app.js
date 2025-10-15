// app.js - Unicorn Deriv Trader (Web) simulation with chart, arrows, and trade history
const tokenInput = document.getElementById("tokenInput");
const connectBtn = document.getElementById("connectBtn");
const statusSpan = document.getElementById("status");
const userBalance = document.getElementById("userBalance");
const symbolList = document.getElementById("symbolList");
const historyList = document.getElementById("historyList");
const buyBtn = document.getElementById("buyBtn");
const sellBtn = document.getElementById("sellBtn");
const closeBtn = document.getElementById("closeBtn");
const chartInner = document.getElementById("chartInner");

// === Global State ===
let currentSymbol = null;
let lastPrices = {};
let chart = null;
let lineSeries = null;

// === Volatility symbols ===
const volatilitySymbols = [
  "BOOM1000", "BOOM900", "BOOM600", "BOOM500", "BOOM300",
  "CRASH1000", "CRASH900", "CRASH600", "CRASH500"
];

// === Helpers ===
function logHistory(txt) {
  const div = document.createElement("div");
  div.textContent = `${new Date().toLocaleTimeString()} — ${txt}`;
  historyList.prepend(div);
}

function setStatus(txt) {
  statusSpan.textContent = txt;
}

// === Initialize symbol list with arrows only ===
function initSymbols() {
  symbolList.innerHTML = "";
  volatilitySymbols.forEach((sym) => {
    const div = document.createElement("div");
    div.className = "symbolItem";
    div.id = `symbol-${sym}`;
    div.innerHTML = `<span class="symbolName">${sym}</span> — <span class="symbolValue">➡</span>`;
    div.onclick = () => selectSymbol(sym);
    symbolList.appendChild(div);
  });
}

// === Select symbol ===
function selectSymbol(symbol) {
  currentSymbol = symbol;
  document.querySelectorAll(".symbolItem").forEach((el) => el.classList.remove("active"));
  const selected = document.getElementById(`symbol-${symbol}`);
  if (selected) selected.classList.add("active");
  logHistory(`Selected symbol: ${symbol}`);
  initChart();
  startTickSimulation();
}

// === Initialize chart ===
function initChart() {
  chartInner.innerHTML = "";
  chart = LightweightCharts.createChart(chartInner, {
    layout: { background: { color: "#ffffff" }, textColor: "#333" },
    grid: { vertLines: { color: "#e0e0e0" }, horzLines: { color: "#e0e0e0" } },
    rightPriceScale: { borderColor: "#ccc" },
    timeScale: { borderColor: "#ccc", timeVisible: true, secondsVisible: true }
  });
  lineSeries = chart.addLineSeries({ color: "#007bff", lineWidth: 2 });
}

// === Simulate live ticks for selected symbol ===
let tickInterval = null;
function startTickSimulation() {
  if (!currentSymbol || !lineSeries) return;
  if (tickInterval) clearInterval(tickInterval);

  let value = 1000 + Math.random() * 50; // starting value
  const points = [];
  const now = Math.floor(Date.now() / 1000);

  // initialize 50 past points
  for (let i = 50; i > 0; i--) {
    const t = now - i;
    value += (Math.random() - 0.5) * 10;
    points.push({ time: t, value });
  }
  lineSeries.setData(points);

  tickInterval = setInterval(() => {
    const t = Math.floor(Date.now() / 1000);
    value += (Math.random() - 0.5) * 10;
    lineSeries.update({ time: t, value });

    // update arrow in symbol list
    const el = document.getElementById(`symbol-${currentSymbol}`);
    if (el) {
      const span = el.querySelector(".symbolValue");
      let direction = "➡";
      let color = "#666";
      if (lastPrices[currentSymbol] !== undefined) {
        if (value > lastPrices[currentSymbol]) { direction = "🔼"; color = "green"; }
        else if (value < lastPrices[currentSymbol]) { direction = "🔽"; color = "red"; }
      }
      span.textContent = direction;
      span.style.color = color;
      lastPrices[currentSymbol] = value;
    }
  }, 1000);
}

// === Trade history buttons ===
buyBtn.onclick = () => logTrade("BUY");
sellBtn.onclick = () => logTrade("SELL");
closeBtn.onclick = () => logTrade("CLOSE");

function logTrade(type) {
  if (!currentSymbol) {
    alert("Please select a symbol first");
    return;
  }
  logHistory(`${type} ${currentSymbol}`);
}

// === Connect button ===
connectBtn.onclick = () => {
  setStatus("Simulation mode ✅");
  initSymbols();
  // arrows update for all symbols
  setInterval(() => {
    volatilitySymbols.forEach((sym) => {
      const el = document.getElementById(`symbol-${sym}`);
      if (!el) return;
      const span = el.querySelector(".symbolValue");
      const rand = Math.random();
      let direction = "➡";
      let color = "#666";
      if (rand > 0.6) { direction = "🔼"; color = "green"; }
      else if (rand < 0.4) { direction = "🔽"; color = "red"; }
      span.textContent = direction;
      span.style.color = color;
    });
  }, 1000);
};

// === Init ===
setStatus("Ready. Connect in simulation mode and select a symbol.");
