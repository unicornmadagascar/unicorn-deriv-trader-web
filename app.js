// app.js - Web frontend for Deriv WebSocket
// IMPORTANT: Test in "Simulation" first. Live mode will execute real trades on your account.

const APP_ID = 105747; // public example app_id
const WS_URL = `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;
const symbols = [
  "BOOM1000", "BOOM900", "BOOM500", "BOOM300",
  "CRASH1000", "CRASH900", "CRASH500", "CRASH300"
];

let ws = null;
let isConnected = false;
let isAuthorized = false;
let authorizeInfo = null;
let keepAliveTimer = null;
let selectedSymbol = null;
let series = null;
let chart = null;
let lastTick = {};
let balanceEl = document.getElementById("balance");

// --- UI: status + logs
function setStatus(txt) {
  document.getElementById("status").textContent = txt;
}
function logHistory(txt) {
  const el = document.getElementById("log");
  const li = document.createElement("div");
  li.textContent = new Date().toLocaleTimeString() + " - " + txt;
  el.prepend(li);
}

// --- build symbol list (UI)
function buildSymbolList() {
  const list = document.getElementById("symbols");
  list.innerHTML = "";
  symbols.forEach(sym => {
    const div = document.createElement("div");
    div.className = "symbolItem";
    div.id = "sym-" + sym;
    div.innerHTML = `
      <strong>${sym}</strong><br>
      <span>Bid:</span> <span id="bid-${sym}">-</span><br>
      <span>Ask:</span> <span id="ask-${sym}">-</span><br>
      <span>Δ:</span> <span id="chg-${sym}">-</span><br>
      <span>Spread:</span> <span id="spr-${sym}">-</span><br>
      <span>Tendance:</span> <span id="dir-${sym}">-</span>
    `;
    div.onclick = () => {
      highlightSymbol(sym);
      selectedSymbol = sym;
      wsSendWhenOpen({ ticks_history: sym, count: 500, end: "latest" });
      logHistory("Selected symbol: " + sym);
    };
    list.appendChild(div);
  });
}

// --- WebSocket helper
function wsSendWhenOpen(msg) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(msg));
}

// --- Chart setup
function createChart() {
  chart = LightweightCharts.createChart(document.getElementById("chart"), {
    layout: { backgroundColor: "#0e1117", textColor: "#d1d4dc" },
    grid: { vertLines: { color: "#2a2e39" }, horzLines: { color: "#2a2e39" } },
    rightPriceScale: { borderVisible: false },
    timeScale: { borderVisible: false },
  });
  series = chart.addLineSeries({ color: "#4caf50", lineWidth: 2 });
}

// --- Connect & authorize
function connectToDeriv(token) {
  if (ws) try { ws.close(); } catch(e){}
  ws = new WebSocket(WS_URL);
  setStatus("Connecting...");
  ws.onopen = () => {
    isConnected = true;
    setStatus("Connected");
    logHistory("WebSocket opened");
    if (token) wsSendWhenOpen({ authorize: token });
    else setStatus("Connected (simulation)");
    setTimeout(subscribeAllSymbols, 1000);
    keepAliveTimer = setInterval(()=>wsSendWhenOpen({ ping: 1 }), 20000);
  };
  ws.onclose = () => {
    isConnected = false; setStatus("Disconnected");
    clearInterval(keepAliveTimer);
  };
  ws.onmessage = evt => {
    const msg = JSON.parse(evt.data);
    handleMessage(msg);
  };
}

// --- Subscribe to all
function subscribeAllSymbols() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  symbols.forEach(sym => wsSendWhenOpen({ ticks: sym, subscribe: 1 }));
  logHistory("Subscribed to all symbols.");
}

// --- highlight
function highlightSymbol(sym) {
  document.querySelectorAll(".symbolItem").forEach(el => el.classList.remove("active"));
  const el = document.getElementById("sym-" + sym);
  if (el) el.classList.add("active");
}

// --- handleMessage
function handleMessage(msg) {
  if (msg.error) return logHistory("Error: " + msg.error.message);

  if (msg.tick) {
    const t = msg.tick;
    const symbol = t.symbol;
    const quote = Number(t.quote);
    const epoch = Number(t.epoch);
    if (!symbol) return;

    const bidEl = document.getElementById("bid-" + symbol);
    const askEl = document.getElementById("ask-" + symbol);
    const chgEl = document.getElementById("chg-" + symbol);
    const sprEl = document.getElementById("spr-" + symbol);
    const dirEl = document.getElementById("dir-" + symbol);

    if (bidEl && askEl && chgEl && sprEl && dirEl) {
      const prev = parseFloat(bidEl.dataset.prev || quote);
      const bid = (quote - 0.0005).toFixed(5);
      const ask = (quote + 0.0005).toFixed(5);
      const change = ((quote - prev) / prev) * 100;
      const spread = (ask - bid).toFixed(5);

      bidEl.textContent = bid;
      askEl.textContent = ask;
      chgEl.textContent = change.toFixed(3) + "%";
      sprEl.textContent = spread;
      chgEl.style.color = change >= 0 ? "#00ff9c" : "#ff4040";

      dirEl.textContent = change >= 0 ? "↑" : "↓";
      dirEl.style.color = change >= 0 ? "#00ff9c" : "#ff4040";

      bidEl.dataset.prev = quote;
    }

    if (symbol === selectedSymbol && series) {
      series.update({ time: epoch, value: quote });
    }
  }

  if (msg.history || msg.candles || msg["ticks_history"]) {
    const h = msg.history || msg["ticks_history"]?.history;
    if (h && h.prices && h.times) {
      const data = h.times.map((t, i) => ({ time: Number(t), value: Number(h.prices[i]) }));
      if (series) series.setData(data);
    }
  }
}

// --- init
createChart();
buildSymbolList();
logHistory("Interface ready. Select a symbol.");
