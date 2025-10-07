// app.js - Deriv Volatility Web frontend using pure WebSocket API
// Supports: Simulation (no token) & Real (token authorize)

const APP_ID = 105747;
const WS_URL = `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;

// === UI elements ===
const tokenInput = document.getElementById('tokenInput');
const connectBtn = document.getElementById('connectBtn');
const statusEl = document.getElementById('status');
const balanceEl = document.getElementById('userBalance');
const symbolListEl = document.getElementById('symbolList');
const chartInner = document.getElementById('chartInner');
const historyList = document.getElementById('historyList');

// === Global state ===
let connection = null;
let selectedSymbol = null;
let chart = null;
let series = null;
let lastTick = {};
let token = null;

// === Volatility symbols ===
const volatilitySymbols = [
  'R_100', 'R_75', 'R_50', 'R_25'
];

// === Helpers ===
function logHistory(txt) {
  const div = document.createElement('div');
  div.textContent = `${new Date().toLocaleTimeString()} — ${txt}`;
  historyList.prepend(div);
}

function setStatus(s) {
  statusEl.textContent = s;
}

// === Chart ===
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
    chart.applyOptions({
      width: chartInner.clientWidth,
      height: chartInner.clientHeight
    });
  });
}

// === Build Symbol List ===
function buildSymbolList() {
  symbolListEl.innerHTML = '';
  volatilitySymbols.forEach(sym => {
    const div = document.createElement('div');
    div.className = 'symbolItem';
    div.id = 'sym-' + sym;
    div.innerHTML = `
      <div class="symTitle">${sym}</div>
      <div>Price: <span id="price-${sym}">--</span></div>
      <div>Direction: <span id="dir-${sym}">--</span></div>
    `;
    div.addEventListener('click', () => selectSymbol(sym));
    symbolListEl.appendChild(div);
  });
}

// === Handle Symbol Selection ===
function selectSymbol(sym) {
  document.querySelectorAll('.symbolItem').forEach(el => el.classList.remove('active'));
  const el = document.getElementById('sym-' + sym);
  if (el) el.classList.add('active');
  selectedSymbol = sym;
  createChart();
  loadHistory(sym);
}

// === Connect button ===
connectBtn.addEventListener('click', () => {
  token = tokenInput.value.trim() || null;
  connectToDeriv();
});

// === Connect to Deriv ===
function connectToDeriv() {
  setStatus('Connecting...');
  connection = new WebSocket(WS_URL);

  connection.onopen = () => {
    setStatus('Connected ✅');
    logHistory('Connected to Deriv WebSocket');

    if (token) {
      authorizeUser(token);
    } else {
      setStatus('Simulation mode (no token)');
      logHistory('Simulation mode (no token)');
      subscribeAllSymbols();
    }
  };

  connection.onmessage = (msg) => handleMessage(JSON.parse(msg.data));

  connection.onclose = () => {
    setStatus('Disconnected');
    logHistory('WebSocket closed');
  };

  connection.onerror = (err) => {
    console.error('WebSocket error:', err);
    setStatus('Connection error');
  };
}

// === Handle incoming WebSocket messages ===
function handleMessage(data) {
  if (!data) return;

  // Handle authorization
  if (data.msg_type === 'authorize') {
    if (data.error) {
      logHistory('❌ Invalid token, switching to simulation mode');
      setStatus('Simulation mode (no token)');
      subscribeAllSymbols();
      return;
    }
    logHistory(`Authorized as ${data.authorize.loginid}`);
    setStatus(`Authorized: ${data.authorize.loginid}`);
    getBalance();
    subscribeAllSymbols();
    return;
  }

  // Handle balance updates
  if (data.msg_type === 'balance' && data.balance) {
    const bal = data.balance.balance;
    balanceEl.textContent = `Balance: ${parseFloat(bal).toFixed(2)} USD`;
  }

  // Handle ticks
  if (data.msg_type === 'tick' && data.tick) {
    const symbol = data.tick.symbol;
    if (symbol) handleTick(symbol, data.tick);
  }

  // Handle history
  if (data.msg_type === 'history' && data.history) {
    renderHistory(data);
  }
}

// === Authorize account ===
function authorizeUser(token) {
  connection.send(JSON.stringify({ authorize: token }));
}

// === Subscribe to balance ===
function getBalance() {
  connection.send(JSON.stringify({ balance: 1, subscribe: 1 }));
}

// === Subscribe to all Volatility symbols ===
function subscribeAllSymbols() {
  volatilitySymbols.forEach(symbol => {
    connection.send(JSON.stringify({ ticks: symbol, subscribe: 1 }));
  });
  logHistory('Subscribed to all Volatility symbols');
}

// === Handle incoming ticks ===
function handleTick(symbol, tick) {
  const priceEl = document.getElementById('price-' + symbol);
  const dirEl = document.getElementById('dir-' + symbol);

  const quote = Number(tick.quote);
  const prev = lastTick[symbol] || quote;
  const direction = quote >= prev ? '↑' : '↓';
  const color = quote >= prev ? '#00ff9c' : '#ff4040';

  if (priceEl && dirEl) {
    priceEl.textContent = quote.toFixed(2);
    dirEl.textContent = direction;
    dirEl.style.color = color;
  }

  lastTick[symbol] = quote;

  if (selectedSymbol === symbol && series) {
    series.update({ time: tick.epoch, value: quote });
  }
}

// === Load historical ticks for chart ===
function loadHistory(symbol) {
  connection.send(JSON.stringify({
    ticks_history: symbol,
    end: 'latest',
    count: 300,
    style: 'ticks'
  }));
}

// === Render history ===
function renderHistory(data) {
  const { history } = data;
  const symbol = data.echo_req?.ticks_history;
  if (!symbol || !history) return;

  const points = history.times.map((t, i) => ({
    time: Number(t),
    value: Number(history.prices[i])
  }));

  if (series && selectedSymbol === symbol) {
    series.setData(points);
  }
  logHistory(`History loaded for ${symbol}`);
}

// === Init ===
createChart();
buildSymbolList();
logHistory('Interface ready. Enter token or connect in simulation mode.');
