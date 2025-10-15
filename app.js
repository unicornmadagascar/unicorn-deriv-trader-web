// app.js - Unicorn Deriv Trader (Web) with Canvas chart
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
let canvas, ctx;
let chartData = [];
let tickInterval = null;

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
  initCanvas();
  startTickSimulation();
}

// === Initialize canvas chart ===
function initCanvas() {
  chartInner.innerHTML = "";
  canvas = document.createElement("canvas");
  canvas.width = chartInner.clientWidth;
  canvas.height = chartInner.clientHeight;
  chartInner.appendChild(canvas);
  ctx = canvas.getContext("2d");
  chartData = [];
}

// === Draw the canvas chart ===
function drawChart() {
  if (!ctx || chartData.length === 0) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const maxVal = Math.max(...chartData);
  const minVal = Math.min(...chartData);
  const range = maxVal - minVal || 1;

  ctx.beginPath();
  chartData.forEach((val, i) => {
    const x = (i / (chartData.length - 1)) * canvas.width;
    const y = canvas.height - ((val - minVal) / range) * canvas.height;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = "#007bff";
  ctx.lineWidth = 2;
  ctx.stroke();
}

// === Simulate live ticks for selected symbol ===
function startTickSimulation() {
  if (!currentSymbol || !ctx) return;
  if (tickInterval) clearInterval(tickInterval);

  let value = 1000 + Math.random() * 50; // starting value
  chartData = Array.from({ length: 50 }, () => value + (Math.random() - 0.5) * 10);

  tickInterval = setInterval(() => {
    value += (Math.random() - 0.5) * 10;
    chartData.push(value);
    if (chartData.length > 50) chartData.shift(); // keep last 50 points
    drawChart();

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
