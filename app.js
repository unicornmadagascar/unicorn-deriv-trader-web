// app.js - Deriv Volatility Web frontend with Canvas & Price Line
const APP_ID = 105747;
const WS_URL = `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;

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

// === Global state ===
let ws = null;
let currentSymbol = null;
let lastPrices = {};
let chartData = [];
let canvas, ctx;
let authorized = false;
let lastPrice = 0;

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

// === Initialize symbol list with arrows ===
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
  subscribeTicks(symbol);
  loadHistoricalTicks(symbol);
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

// === Draw chart with price line and label ===
function drawChart() {
  if (!ctx || chartData.length === 0) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const maxVal = Math.max(...chartData);
  const minVal = Math.min(...chartData);
  const range = maxVal - minVal || 1;

  const padding = 40;

  // Axes
  ctx.strokeStyle = "#ccc";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padding, 0);
  ctx.lineTo(padding, canvas.height - padding);
  ctx.lineTo(canvas.width, canvas.height - padding);
  ctx.stroke();

  // Price line
  ctx.beginPath();
  chartData.forEach((val, i) => {
    const x = padding + (i / (chartData.length - 1)) * (canvas.width - padding * 2);
    const y = canvas.height - padding - ((val - minVal) / range) * (canvas.height - padding * 1.5);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = "#007bff";
  ctx.lineWidth = 2;
  ctx.stroke();

  // Last price
  lastPrice = chartData[chartData.length - 1];
  const yPrice = canvas.height - padding - ((lastPrice - minVal) / range) * (canvas.height - padding * 1.5);
  const xLast = padding + ((chartData.length - 1) / (chartData.length - 1)) * (canvas.width - padding * 2);

  // Horizontal line
  ctx.strokeStyle = "red";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(padding, yPrice);
  ctx.lineTo(canvas.width - padding, yPrice);
  ctx.stroke();

  // Circle on last point
  ctx.fillStyle = "red";
  ctx.beginPath();
  ctx.arc(xLast, yPrice, 5, 0, 2 * Math.PI);
  ctx.fill();

  // Price label, always visible
  ctx.fillStyle = "red";
  ctx.font = "14px Arial";
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  const priceOffsetX = -50;
  let textX = canvas.width - padding + priceOffsetX;
  const textWidth = ctx.measureText(lastPrice.toFixed(2)).width;
  if (textX - textWidth < padding) textX = padding + 5;
  ctx.fillText(lastPrice.toFixed(2), textX, yPrice - 5);
}

// === WebSocket connection ===
connectBtn.onclick = () => {
  const token = tokenInput.value.trim() || null;
  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    setStatus("Connected to Deriv WebSocket");
    logHistory("WebSocket connected");
    if (token) authorize(token);
    else {
      setStatus("Connected without token");
      initSymbols();
    }
  };

  ws.onmessage = (msg) => {
    const data = JSON.parse(msg.data);
    handleMessage(data);
  };

  ws.onclose = () => setStatus("WebSocket disconnected");
  ws.onerror = (err) => setStatus("WebSocket error");
};

// === Handle messages ===
function handleMessage(data) {
  if (data.msg_type === "authorize") {
    if (data.error) {
      logHistory("❌ Invalid token");
      setStatus("Simulation mode");
      return;
    }
    authorized = true;
    setStatus(`Authorized: ${data.authorize.loginid}`);
    getBalance();
  }

  if (data.msg_type === "balance" && data.balance?.balance != null) {
    userBalance.textContent = `Balance: ${parseFloat(data.balance.balance).toFixed(2)} USD`;
  }

  if (data.msg_type === "tick" && data.tick?.symbol) {
    const tick = data.tick;
    const symbol = tick.symbol;
    const price = Number(tick.quote);

    // update chart data
    if (symbol === currentSymbol) {
      chartData.push(price);
      if (chartData.length > 300) chartData.shift();
      drawChart();
    }

    // update arrow
    const el = document.getElementById(`symbol-${symbol}`);
    if (el) {
      const span = el.querySelector(".symbolValue");
      let direction = "➡";
      let color = "#666";
      if (lastPrices[symbol] !== undefined) {
        if (price > lastPrices[symbol]) { direction = "🔼"; color = "green"; }
        else if (price < lastPrices[symbol]) { direction = "🔽"; color = "red"; }
      }
      span.textContent = direction;
      span.style.color = color;
      lastPrices[symbol] = price;
    }
  }
}

// === Authorize ===
function authorize(token) {
  ws.send(JSON.stringify({ authorize: token }));
}

// === Get balance ===
function getBalance() {
  ws.send(JSON.stringify({ balance: 1, subscribe: 1 }));
}

// === Subscribe ticks for symbol ===
function subscribeTicks(symbol) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ ticks: symbol, subscribe: 1 }));
}

// === Load historical ticks ===
function loadHistoricalTicks(symbol) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({
    ticks_history: symbol,
    end: "latest",
    count: 300,
    style: "ticks",
    subscribe: 1,
  }));
}

// === Trade history buttons ===
buyBtn.onclick = () => logTrade("BUY");
sellBtn.onclick = () => logTrade("SELL");
closeBtn.onclick = () => logTrade("CLOSE");

function logTrade(type) {
  if (!currentSymbol) return;
  logHistory(`${type} ${currentSymbol}`);
}

// === Init UI ===
setStatus("Ready. Connect and select a symbol.");
initSymbols();
