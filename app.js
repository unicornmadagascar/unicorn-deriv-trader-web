// app.js - Unicorn Deriv Trader (Web)
// Deriv WebSocket API + Lightweight Charts

const APP_ID = 105747;
const WS_URL = `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;

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

// Global state
let ws = null;
let currentSymbol = null;
let chart = null;
let lineSeries = null;
let lastPrices = {}; // stocke la dernière valeur connue de chaque symbole

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
        if (data.authorize?.balance) {
          userBalance.textContent = `Balance: ${parseFloat(data.authorize.balance).toFixed(2)} USD`;
        }
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

  ws.onerror = (err) => {
    console.error(err);
    statusSpan.textContent = "❌ Connection error";
  };

  ws.onclose = () => {
    statusSpan.textContent = "❌ Disconnected";
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
    div.innerHTML = `
      <span class="symbolName">${s.display_name}</span> — 
      <span class="symbolValue">--</span>
    `;
    div.onclick = () => selectSymbol(s.symbol);
    symbolList.appendChild(div);

    // Souscription aux ticks pour chaque symbole
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

  window.addEventListener("resize", () => {
    chart.applyOptions({
      width: chartContainer.clientWidth,
      height: chartContainer.clientHeight,
    });
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
    time: parseInt(history.times[i]),
    value: p,
  }));

  if (lineSeries) lineSeries.setData(data);
}

// ==============================
// Gestion des ticks en direct
// ==============================
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

  // === MAJ de la direction et prix dans la liste des symboles ===
  const el = document.getElementById(`symbol-${tick.symbol}`);
  if (el) {
    const nameSpan = el.querySelector(".symbolName");
    const valueSpan = el.querySelector(".symbolValue");
    if (nameSpan && valueSpan) {
      let direction = "➡";
      let color = "#666";

      if (prev !== undefined) {
        if (tick.quote > prev) {
          direction = "🔼";
          color = "green";
        } else if (tick.quote < prev) {
          direction = "🔽";
          color = "red";
        }
      }

      valueSpan.textContent = `${direction} ${tick.quote.toFixed(2)}`;
      valueSpan.style.color = color;
    }
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
