// app.js - Unicorn Deriv Trader (Web)
// Deriv WebSocket API + Lightweight Charts

const APP_ID = 105747; // Example App ID
const WS_URL = `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;
let ws = null;
let currentSymbol = null;
let chart = null;
let lineSeries = null;
let lastPrices = {}; // pour stocker la dernière valeur connue de chaque symbole

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

// ==============================
// Connexion à Deriv API
// ==============================
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

    switch (data.msg_type) {
      case "authorize":
        userBalance.textContent = `Balance: ${data.authorize.balance} USD`;
        loadSymbols();
        break;

      case "active_symbols":
        displaySymbols(data.active_symbols);
        break;

      case "history":
        drawHistoricalData(data.history);
        break;

      case "tick":
        handleTick(data.tick);
        break;
    }
  };
};

// ==============================
// Chargement et affichage des symboles
// ==============================
function loadSymbols() {
  ws.send(
    JSON.stringify({
      active_symbols: "brief",
      product_type: "basic",
    })
  );
}

function displaySymbols(symbols) {
  symbolList.innerHTML = "";
  const filtered = symbols.filter(
    (s) =>
      s.symbol.startsWith("R_") ||
      s.symbol.startsWith("BOOM") ||
      s.symbol.startsWith("CRASH")
  );

  filtered.forEach((s) => {
    const div = document.createElement("div");
    div.className = "symbolItem";
    div.id = `symbol-${s.symbol}`;
    div.textContent = `${s.display_name}  —  ...`;
    div.onclick = () => selectSymbol(s.symbol);
    symbolList.appendChild(div);

    // On souscrit à chaque symbole pour afficher les ticks en direct
    ws.send(JSON.stringify({ ticks_subscribe: s.symbol }));
  });
}

// ==============================
// Sélection d’un symbole et initialisation du graphique
// ==============================
function selectSymbol(symbol) {
  currentSymbol = symbol;
  document.querySelectorAll(".symbolItem").forEach((el) => el.classList.remove("active"));
  const selected = document.getElementById(`symbol-${symbol}`);
  if (selected) selected.classList.add("active");

  initChart();
  requestHistoricalData(symbol);
  subscribeTicks(symbol);
}

// ==============================
// Initialiser le graphique Lightweight
// ==============================
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
    rightPriceScale: { borderColor: "#ccc" },
    timeScale: { borderColor: "#ccc", timeVisible: true, secondsVisible: true },
  });
  lineSeries = chart.addLineSeries({
    color: "#007bff",
    lineWidth: 2,
  });
}

// ==============================
// Charger 300 ticks historiques
// ==============================
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

function drawHistoricalData(history) {
  if (!history || !history.prices || history.prices.length === 0) return;

  const data = history.prices.map((p, i) => ({
    time: parseInt(history.times[i]), // correction ici !
    value: p,
  }));

  if (lineSeries) lineSeries.setData(data);
}

// ==============================
// Souscription et mise à jour temps réel
// ==============================
function subscribeTicks(symbol) {
  ws.send(JSON.stringify({ forget_all: "ticks" })); // nettoyer les anciennes souscriptions
  ws.send(JSON.stringify({ ticks_subscribe: symbol }));
}

function handleTick(tick) {
  if (!tick || !tick.symbol) return;

  const prev = lastPrices[tick.symbol];
  lastPrices[tick.symbol] = tick.quote;

  // === MAJ du graphique si c’est le symbole sélectionné ===
  if (tick.symbol === currentSymbol && lineSeries) {
    lineSeries.update({
      time: tick.epoch,
      value: tick.quote,
    });
  }

  // === MAJ de la direction dans la liste ===
  const el = document.getElementById(`symbol-${tick.symbol}`);
  if (el) {
    let direction = "⬜";
    let color = "#999";
    if (prev !== undefined) {
      if (tick.quote > prev) {
        direction = "🔼";
        color = "green";
      } else if (tick.quote < prev) {
        direction = "🔽";
        color = "red";
      }
    }
    el.innerHTML = `<span>${tick.symbol}</span> — <span style="color:${color}">${direction} ${tick.quote.toFixed(2)}</span>`;
  }
}

// ==============================
// Boutons de trading (démo)
// ==============================
buyBtn.onclick = () => logTrade("BUY");
sellBtn.onclick = () => logTrade("SELL");
closeBtn.onclick = () => logTrade("CLOSE");

function logTrade(type) {
  const div = document.createElement("div");
  div.textContent = `${new Date().toLocaleTimeString()} - ${type} ${currentSymbol || ""}`;
  historyList.prepend(div);
}
