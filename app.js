// app.js - Web frontend for Deriv WebSocket
// IMPORTANT: Test in "Simulation" first. Live mode will execute real trades on your account.

const APP_ID = 105747;
const WS_URL = `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;

// === UI elements ===
const tokenInput = document.getElementById('tokenInput');
const connectBtn = document.getElementById('connectBtn');
const statusEl = document.getElementById('status');
const balanceEl = document.getElementById('userBalance');
const symbolListEl = document.getElementById('symbolList');
const chartInner = document.getElementById('chartInner');

const modeSelect = document.getElementById('modeSelect');
const timeframe = document.getElementById('timeframe');
const lotInput = document.getElementById('lot');
const stakeInput = document.getElementById('stake');
const tpInput = document.getElementById('tp');
const slInput = document.getElementById('sl');
const martingaleCheck = document.getElementById('martingale');
const multiplierInput = document.getElementById('multiplier');

const buyBtn = document.getElementById('buyBtn');
const sellBtn = document.getElementById('sellBtn');
const closeBtn = document.getElementById('closeBtn');
const pnlEl = document.getElementById('pnl');
const historyList = document.getElementById('historyList');

// === Global states ===
let ws = null;
let isConnected = false;
let isAuthorized = false;
let authorizeInfo = null;
let keepAliveTimer = null;
let selectedSymbol = null;

// === Symbols list ===
const symbols = [
  "BOOM1000", "BOOM900", "BOOM600", "BOOM500", "BOOM300",
  "CRASH1000", "CRASH900", "CRASH600", "CRASH500", "CRASH300"
];

// === Chart ===
let chart = null;
let series = null;
let markers = [];
let lastTick = {};

// === Helpers ===
function logHistory(txt) {
  const div = document.createElement('div');
  div.textContent = `${new Date().toLocaleTimeString()} — ${txt}`;
  historyList.prepend(div);
}

function setStatus(s) {
  statusEl.textContent = s;
}

// === Chart creation ===
function createChart() {
  chartInner.innerHTML = '';
  chart = LightweightCharts.createChart(chartInner, {
    width: chartInner.clientWidth,
    height: chartInner.clientHeight,
    layout: { textColor: '#e6edf3', background: { color: '#0d1117' } },
    grid: { vertLines: { color: '#222' }, horzLines: { color: '#222' } },
    timeScale: { timeVisible: true, secondsVisible: true }
  });
  series = chart.addLineSeries({ color: '#00ff9c', lineWidth: 2 });
  window.addEventListener('resize', () => {
    try {
      chart.applyOptions({ width: chartInner.clientWidth, height: chartInner.clientHeight });
    } catch (e) {}
  });
}

// === WebSocket connection ===
connectBtn.addEventListener('click', () => {
  const token = tokenInput.value.trim();
  connectToDeriv(token || null);
});

function connectToDeriv(token) {
  if (ws) try { ws.close(); } catch(e){}
  ws = new WebSocket(WS_URL);
  setStatus('Connecting...');

  ws.onopen = () => {
    isConnected = true;
    setStatus('Connected');
    logHistory('WebSocket opened');

    if (token) wsSendWhenOpen({ authorize: token });
    else setStatus('Connected (simulation)');

    keepAliveTimer = setInterval(() => wsSendWhenOpen({ ping: 1 }), 20000);
    subscribeAllSymbols();
  };

  ws.onclose = () => {
    isConnected = false;
    isAuthorized = false;
    setStatus('Disconnected');
    clearInterval(keepAliveTimer);
  };

  ws.onerror = (err) => {
    console.error('WS error', err);
    setStatus('WebSocket error (check console)');
  };

  ws.onmessage = (evt) => {
    const msg = JSON.parse(evt.data);
    handleMessage(msg);
  };
}

// === Send safely ===
function wsSendWhenOpen(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

// === Subscribe all symbols ===
function subscribeAllSymbols() {
  symbols.forEach(sym => wsSendWhenOpen({ ticks: sym, subscribe: 1 }));
  logHistory('Subscribed to all symbols');
}

// === Build symbol list ===
function buildSymbolList() {
  symbolListEl.innerHTML = '';
  symbols.forEach(sym => {
    const div = document.createElement('div');
    div.className = 'symbolItem';
    div.id = 'sym-' + sym;
    div.innerHTML = `
      <div class="symTitle">${sym}</div>
      <div>Bid: <span id="bid-${sym}">--</span></div>
      <div>Ask: <span id="ask-${sym}">--</span></div>
      <div>Δ: <span id="chg-${sym}">--</span></div>
      <div>Spread: <span id="spr-${sym}">--</span></div>
      <div>Tendance: <span id="dir-${sym}">--</span></div>
    `;
    div.addEventListener('click', () => selectSymbol(sym));
    symbolListEl.appendChild(div);
  });
}

// === Select symbol ===
function selectSymbol(sym) {
  document.querySelectorAll('.symbolItem').forEach(el => el.classList.remove('active'));
  const el = document.getElementById('sym-' + sym);
  if (el) el.classList.add('active');
  selectedSymbol = sym;
  createChart();
  markers = [];
  wsSendWhenOpen({ ticks_history: sym, end: 'latest', count: 300 });
  wsSendWhenOpen({ ticks: sym, subscribe: 1 });
}

// === Handle messages ===
function handleMessage(msg) {
  if (msg.error) return logHistory('Error: ' + msg.error.message);

  if (msg.authorize) {
    isAuthorized = true;
    authorizeInfo = msg.authorize;
    setStatus('Authorized: ' + (authorizeInfo.loginid || 'unknown'));
    wsSendWhenOpen({ balance: 1, subscribe: 1 });
    return;
  }

  if (msg.balance) {
    const bal = msg.balance.balance || msg.balance;
    balanceEl.textContent = 'Balance: ' + parseFloat(bal).toFixed(2);
    return;
  }

  if (msg.tick) {
    const t = msg.tick;
    const symbol = t.symbol;
    const quote = Number(t.quote);
    const epoch = Number(t.epoch);
    lastTick[symbol] = quote;

    const bid = (quote - 0.0005).toFixed(5);
    const ask = (quote + 0.0005).toFixed(5);
    const spread = (ask - bid).toFixed(5);

    const bidEl = document.getElementById('bid-' + symbol);
    const askEl = document.getElementById('ask-' + symbol);
    const chgEl = document.getElementById('chg-' + symbol);
    const sprEl = document.getElementById('spr-' + symbol);
    const dirEl = document.getElementById('dir-' + symbol);

    if (bidEl && askEl && chgEl && sprEl && dirEl) {
      const prev = parseFloat(bidEl.dataset.prev || quote);
      const change = ((quote - prev) / prev) * 100;

      bidEl.textContent = bid;
      askEl.textContent = ask;
      chgEl.textContent = change.toFixed(3) + '%';
      sprEl.textContent = spread;
      chgEl.style.color = change >= 0 ? '#00ff9c' : '#ff4040';

      dirEl.textContent = change >= 0 ? '↑' : '↓';
      dirEl.style.color = change >= 0 ? '#00ff9c' : '#ff4040';
      bidEl.dataset.prev = quote;
    }

    if (symbol === selectedSymbol && series) {
      series.update({ time: epoch, value: quote });
    }
    return;
  }

  if (msg.history && msg.history.prices && msg.history.times) {
    const data = msg.history.times.map((t, i) => ({
      time: Math.floor(Number(t)),
      value: Number(msg.history.prices[i])
    }));
    if (series) series.setData(data);
  }
}

// === Init ===
createChart();
buildSymbolList();
logHistory('Interface ready. Select a symbol.');
