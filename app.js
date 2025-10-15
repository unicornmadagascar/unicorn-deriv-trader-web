// app.js - Unicorn Deriv Trader (Web)
const APP_ID = 105747;
const WS_URL = `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;

// === UI Elements ===
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

// === Global State ===
let ws = null;
let currentSymbol = null;
let chart = null;
let lineSeries = null;
let lastPrices = {}; // stocke la dernière valeur connue de chaque symbole

// === Liste des symbols à surveiller ===
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

// === Connexion WebSocket ===
connectBtn.onclick = () => {
  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    setStatus("✅ Connected");
    const token = tokenInput.value.trim();
    if (token) {
      ws.send(JSON.stringify({ authorize: token }));
    } else {
      initSymbols();
    }
  };

  ws.onmessage = (msg) => {
    const data = JSON.parse(msg.data);

    if (!data) return;

    if (data.msg_type === "authorize") {
      if (data.authorize?.loginid) {
        logHistory(`Authorized as ${data.authorize.loginid}`);
        if (data.authorize.balance)
          userBalance.textContent = `Balance: ${parseFloat(data.authorize.balance).toFixed(2)} USD`;
      }
      initSymbols();
    }

    if (data.msg_type === "tick") handleTick(data.tick);
    if (data.msg_type === "history") handleHistory(data.history, data.echo_req?.ticks_history);
  };

  ws.onerror = (err) => {
    console.error(err);
    setStatus("❌ Connection error");
  };

  ws.onclose = () => setStatus("❌ Disconnected");
};

// === Initialisation des symboles ===
function initSymbols() {
  symbolList.innerHTML = "";
  volatilitySymbols.forEach((sym) => {
    const div = document.createElement("div");
    div.className = "symbolItem";
    div.id = `symbol-${sym}`;
    div.innerHTML = `<span class="symbolName">${sym}</span> — <span class="symbolValue">--</span>`;
    div.onclick = () => selectSymbol(sym);
    symbolList.appendChild(div);

    // souscription ticks
    ws.send(JSON.stringify({ ticks: sym, subscribe: 1 }));
  });
}

// === Sélection d’un symbole ===
function selectSymbol(symbol) {
  currentSymbol = symbol;
  document.querySelectorAll(".symbolItem").forEach((el) => el.classList.remove("active"));
  const selected = document.getElementById(`symbol-${symbol}`);
  if (selected) selected.classList.add("active");

  initChart();
  requestHistoricalData(symbol);
}

// === Initialiser graphique ===
function initChart() {
  const chartContainer = document.getElementById("chartInner");
  chartContainer.innerHTML = "";

  chart = LightweightCharts.createChart(chartContainer, {
    layout: { background: { color: "#ffffff" }, textColor: "#333" },
    grid: { vertLines: { color: "#e0e0e0" }, horzLines: { color: "#e0e0e0" } },
    rightPriceScale: { borderColor: "#ccc" },
    timeScale: { borderColor: "#ccc", timeVisible: true, secondsVisible: true },
  });

  lineSeries = chart.addLineSeries({ color: "#007bff", lineWidth: 2 });

  window.addEventListener("resize", () => {
    chart.applyOptions({
      width: chartContainer.clientWidth,
      height: chartContainer.clientHeight,
    });
  });
}

// === Charger ticks historiques ===
function requestHistoricalData(symbol) {
  ws.send(
    JSON.stringify({
      ticks_history: symbol,
      end: "latest",
      count: 300,
      style: "ticks",
      subscribe: 0,
    })
  );
}

function handleHistory(history, symbol) {
  if (!history || !history.prices || history.prices.length === 0) return;

  const data = history.prices.map((p, i) => ({
    time: parseInt(history.times[i]),
    value: p,
  }));

  if (symbol === currentSymbol && lineSeries) lineSeries.setData(data);
}

// === Gestion des ticks en direct ===
function handleTick(tick) {
  if (!tick || !tick.symbol) return;

  const prev = lastPrices[tick.symbol];
  lastPrices[tick.symbol] = tick.quote;

  // === Graphique
  if (tick.symbol === currentSymbol && lineSeries) {
    lineSeries.update({ time: tick.epoch, value: tick.quote });
  }

  // === Liste des symboles avec flèches
  const el = document.getElementById(`symbol-${tick.symbol}`);
  if (el) {
    const valueSpan = el.querySelector(".symbolValue");
    let direction = "➡";
    let color = "#666";

    if (prev !== undefined) {
      if (tick.quote > prev) { direction = "🔼"; color = "green"; }
      else if (tick.quote < prev) { direction = "🔽"; color = "red"; }
    }

    valueSpan.textContent = `${direction} ${tick.quote.toFixed(2)}`;
    valueSpan.style.color = color;
  }
}

// === Boutons BUY / SELL / CLOSE ===
buyBtn.onclick = () => logTrade("BUY");
sellBtn.onclick = () => logTrade("SELL");
closeBtn.onclick = () => logTrade("CLOSE");

function logTrade(type) {
  if (!currentSymbol) return;
  const div = document.createElement("div");
  div.textContent = `${new Date().toLocaleTimeString()} — ${type} ${currentSymbol}`;
  historyList.prepend(div);
}
