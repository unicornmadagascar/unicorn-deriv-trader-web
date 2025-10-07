// app.js - Deriv Volatility Web frontend avec Chart.js
const APP_ID = 105747;
const WS_URL = `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;

// === UI Elements ===
const tokenInput = document.getElementById('tokenInput');
const connectBtn = document.getElementById('connectBtn');
const statusEl = document.getElementById('status');
const balanceEl = document.getElementById('userBalance');
const symbolListEl = document.getElementById('symbolList');
const historyList = document.getElementById('historyList');
const modeSelect = document.getElementById('modeSelect');
const priceChartCanvas = document.getElementById('priceChart');

let connection = null;
let token = null;
let selectedSymbol = null;
let lastTick = {};
let automationActive = false;

// Chart.js instance
let priceChart = null;
let chartData = { labels: [], datasets: [{ label: 'Price', data: [], borderColor: '#00ff9c', backgroundColor: 'rgba(0,255,156,0.2)' }] };

// === Volatility symbols ===
const volatilitySymbols = ['R_100', 'R_75', 'R_50', 'R_25', 'R_10'];

// === Helpers ===
function logHistory(txt) {
  const div = document.createElement('div');
  div.textContent = `${new Date().toLocaleTimeString()} — ${txt}`;
  historyList.prepend(div);
}

function setStatus(s) { statusEl.textContent = s; }

// === Build Symbol List ===
function buildSymbolList() {
  symbolListEl.innerHTML = '';
  volatilitySymbols.forEach(sym => {
    const div = document.createElement('div');
    div.className = 'symbolItem';
    div.id = 'sym-' + sym;
    div.innerHTML = `<div class="symTitle">${sym}</div>`;
    div.addEventListener('click', () => selectSymbol(sym));
    symbolListEl.appendChild(div);
  });
}

// === Select Symbol ===
function selectSymbol(sym) {
  document.querySelectorAll('.symbolItem').forEach(el => el.classList.remove('active'));
  const el = document.getElementById('sym-' + sym);
  if (el) el.classList.add('active');
  selectedSymbol = sym;
  logHistory(`Selected symbol: ${sym}`);
  createChart();
  if (modeSelect.value === 'live') loadHistory(sym);
}

// === Chart.js setup ===
function createChart() {
  if (priceChart) priceChart.destroy();

  chartData = { labels: [], datasets: [{ label: 'Price', data: [], borderColor: '#00ff9c', backgroundColor: 'rgba(0,255,156,0.2)' }] };

  priceChart = new Chart(priceChartCanvas, {
    type: 'line',
    data: chartData,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { type: 'time', time: { unit: 'second', tooltipFormat: 'HH:mm:ss' }, ticks: { color: '#e6edf3' } },
        y: { ticks: { color: '#e6edf3' } }
      },
      plugins: { legend: { labels: { color: '#e6edf3' } } }
    }
  });
}

// === Connect button ===
connectBtn.addEventListener('click', () => {
  token = tokenInput.value.trim() || null;
  if (modeSelect.value === 'live') connectToDeriv();
  else startSimulation();
});

// === Connect to Deriv ===
function connectToDeriv() {
  setStatus('Connecting...');
  connection = new WebSocket(WS_URL);

  connection.onopen = () => {
    setStatus('Connected ✅');
    logHistory('Connected to Deriv WebSocket');
    if (token) authorizeUser(token);
    else subscribeAllSymbols();
  };

  connection.onmessage = msg => handleMessage(JSON.parse(msg.data));
  connection.onclose = () => { setStatus('Disconnected'); logHistory('WebSocket closed'); };
  connection.onerror = err => { console.error(err); setStatus('Connection error'); };
}

// === Handle messages ===
function handleMessage(data) {
  if (!data) return;

  if (data.msg_type === 'authorize') {
    if (data.error) {
      logHistory('❌ Invalid token, switching to simulation mode');
      startSimulation();
      return;
    }
    logHistory(`Authorized as ${data.authorize.loginid}`);
    setStatus(`Authorized: ${data.authorize.loginid}`);
    getBalance();
    subscribeAllSymbols();
  }

  if (data.msg_type === 'balance' && data.balance?.balance != null) {
    balanceEl.textContent = `Balance: ${parseFloat(data.balance.balance).toFixed(2)} USD`;
  }

  if (data.msg_type === 'tick' && data.tick?.symbol) handleTick(data.tick.symbol, data.tick);
  if (data.msg_type === 'history') handleHistory(data);
}

// === Authorize account ===
function authorizeUser(token) { connection.send(JSON.stringify({ authorize: token })); }
function getBalance() { connection.send(JSON.stringify({ balance: 1, subscribe: 1 })); }
function subscribeAllSymbols() { volatilitySymbols.forEach(s => connection.send(JSON.stringify({ ticks: s, subscribe: 1 }))); logHistory('Subscribed to all symbols'); }

// === Handle ticks ===
function handleTick(symbol, tick) {
  const quote = Number(tick.quote);
  const prev = lastTick[symbol] ?? quote;
  lastTick[symbol] = quote;

  if (selectedSymbol === symbol) {
    chartData.labels.push(new Date(tick.epoch * 1000));
    chartData.datasets[0].data.push(quote);
    if (chartData.labels.length > 300) {
      chartData.labels.shift();
      chartData.datasets[0].data.shift();
    }
    priceChart.update();
  }
}

// === Handle historical data ===
function handleHistory(data) {
  if (!data.history || !selectedSymbol) return;

  const points = data.history.times.map((t, i) => ({ t: new Date(Number(t) * 1000), y: Number(data.history.prices[i]) }));

  chartData.labels = points.map(p => p.t);
  chartData.datasets[0].data = points.map(p => p.y);
  priceChart.update();

  logHistory(`Loaded ${points.length} historical ticks for ${selectedSymbol}`);
}

// === Load historical ticks ===
function loadHistory(symbol) {
  if (!connection) return;
  connection.send(JSON.stringify({ ticks_history: symbol, end: 'latest', count: 300, style: 'ticks' }));
}

// === Simulation mode ===
function startSimulation() {
  setStatus('Simulation mode ✅');
  selectedSymbol = volatilitySymbols[0];
  createChart();
  let tickValue = 1000;
  setInterval(() => {
    if (!selectedSymbol) return;
    tickValue += (Math.random() - 0.5) * 2;
    const tick = { quote: tickValue, epoch: Math.floor(Date.now() / 1000) };
    handleTick(selectedSymbol, tick);
  }, 1000);
}

// === Init ===
buildSymbolList();
createChart();
logHistory('Interface ready. Select symbol and start simulation or live mode.');
