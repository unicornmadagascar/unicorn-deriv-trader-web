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
const controlsEl = document.getElementById('controls');
const chartCanvas = document.getElementById('priceChart');

// === Global state ===
let connection = null;
let selectedSymbol = null;
let lastTick = {};
let token = null;
let automationActive = false;
let priceChart = null;
let chartData = [];

// === Volatility symbols ===
const volatilitySymbols = ['R_100', 'R_75', 'R_50', 'R_25', 'R_10'];

// === Helpers ===
function logHistory(txt) {
  const div = document.createElement('div');
  div.textContent = `${new Date().toLocaleTimeString()} — ${txt}`;
  historyList.prepend(div);
}
function setStatus(s) { statusEl.textContent = s; }

// === Build Symbol List (Price + Direction) ===
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

// === Create Chart.js chart ===
function createChartJS() {
  chartData = [];
  if (priceChart) priceChart.destroy();

  const ctx = chartCanvas.getContext('2d');
  priceChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        label: selectedSymbol || 'Symbol',
        data: [],
        borderColor: '#00ff9c',
        backgroundColor: 'rgba(0,255,156,0.2)',
        fill: true,
        tension: 0.2
      }]
    },
    options: {
      responsive: true,
      animation: false,
      scales: {
        x: { type: 'time', time: { unit: 'second' }, ticks: { color: '#e6edf3' } },
        y: { ticks: { color: '#e6edf3' } }
      }
    }
  });
}

// === Select symbol ===
function selectSymbol(sym) {
  document.querySelectorAll('.symbolItem').forEach(el => el.classList.remove('active'));
  const el = document.getElementById('sym-' + sym);
  if (el) el.classList.add('active');
  selectedSymbol = sym;
  logHistory(`Selected symbol: ${sym}`);
  createChartJS();
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

    if (token) authorizeUser(token);
    else {
      setStatus('Simulation mode');
      subscribeAllSymbols();
      startSimulation();
    }
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
      setStatus('Simulation mode');
      subscribeAllSymbols();
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

// === Authorize ===
function authorizeUser(token) { connection.send(JSON.stringify({ authorize: token })); }

// === Subscribe to balance ===
function getBalance() { connection.send(JSON.stringify({ balance: 1, subscribe: 1 })); }

// === Subscribe to all symbols ===
function subscribeAllSymbols() { 
  volatilitySymbols.forEach(s => connection.send(JSON.stringify({ ticks: s, subscribe: 1 }))); 
  logHistory('Subscribed to all Volatility symbols'); 
}

// === Handle tick ===
function handleTick(symbol, tick) {
  const priceEl = document.getElementById('price-' + symbol);
  const dirEl = document.getElementById('dir-' + symbol);

  const quote = Number(tick.quote);
  const prev = lastTick[symbol] ?? quote;
  const direction = quote >= prev ? '↑' : '↓';
  const color = quote >= prev ? '#00ff9c' : '#ff4040';

  if (priceEl) priceEl.textContent = quote.toFixed(2);
  if (dirEl) { dirEl.textContent = direction; dirEl.style.color = color; }

  lastTick[symbol] = quote;

  // update Chart.js
  if (selectedSymbol === symbol && priceChart) {
    const time = new Date((tick.epoch ?? Date.now()/1000) * 1000);
    chartData.push({ x: time, y: quote });
    if (chartData.length > 300) chartData.shift();
    priceChart.data.labels = chartData.map(d => d.x);
    priceChart.data.datasets[0].data = chartData.map(d => d.y);
    priceChart.update('none');
  }

  if (automationActive && selectedSymbol === symbol) runAutomation(symbol, quote);
}

// === Handle historical data ===
function handleHistory(data) {
  const symbol = data.echo_req?.ticks_history;
  if (!data.history || !symbol) return;

  chartData = data.history.times.map((t, i) => ({
    x: new Date(Number(t) * 1000),
    y: Number(data.history.prices[i])
  }));

  if (selectedSymbol === symbol && priceChart) {
    priceChart.data.labels = chartData.map(d => d.x);
    priceChart.data.datasets[0].data = chartData.map(d => d.y);
    priceChart.update('none');
    logHistory(`Loaded ${chartData.length} historical ticks for ${symbol}`);
  }
}

// === Load historical ticks ===
function loadHistory(symbol) {
  if (!connection) return;
  connection.send(JSON.stringify({
    ticks_history: symbol,
    end: 'latest',
    count: 300,
    style: 'ticks'
  }));
}

// === Automation logic ===
function runAutomation(symbol, price) {
  logHistory(`Automation: checking ${symbol} at price ${price}`);
  // Intègre ici Money Management, TP/SL, Martingale, Buy/Sell Numbers
}

// === Controls UI ===
function createControls() {
  controlsEl.innerHTML = `
    <button id="btnBuy">BUY</button>
    <button id="btnSell">SELL</button>
    <button id="btnClose">CLOSE</button>
    <button id="btnLaunch">AUTOMATION LAUNCHER</button>
    <button id="btnStop">STOP AUTOMATION</button>

    <div id="moneyManagement">
      <label>TF: <input type="text" id="tfInput" value="1m"></label>
      <label>Lot: <input type="number" id="lotInput" value="1" min="0.01" step="0.01"></label>
      <label>Buy Number: <input type="number" id="buyNumInput" value="1" min="1"></label>
      <label>Sell Number: <input type="number" id="sellNumInput" value="1" min="1"></label>
    </div>

    <div id="riskManagement">
      <label>TP: <input type="number" id="tpInput" value="10"></label>
      <label>SL: <input type="number" id="slInput" value="10"></label>
      <label>Martingale: <input type="number" id="martInput" value="0"></label>
    </div>

    <div id="controlChecks">
      <label><input type="checkbox" id="enableTP"> Enable TP</label>
      <label><input type="checkbox" id="enableSL"> Enable SL</label>
      <label><input type="checkbox" id="enableMart"> Enable Martingale</label>
      <label><input type="checkbox" id="enableBuyNum"> Enable Buy Number</label>
      <label><input type="checkbox" id="enableSellNum"> Enable Sell Number</label>
    </div>
  `;

  document.getElementById('btnBuy').onclick = () => { logHistory('BUY clicked'); };
  document.getElementById('btnSell').onclick = () => { logHistory('SELL clicked'); };
  document.getElementById('btnClose').onclick = () => { logHistory('CLOSE clicked'); };
  document.getElementById('btnLaunch').onclick = () => { automationActive = true; logHistory('Automation started'); };
  document.getElementById('btnStop').onclick = () => { automationActive = false; logHistory('Automation stopped'); };
}

// === Simulation mode ===
function startSimulation() {
  setStatus('Simulation mode ✅');
  selectedSymbol = volatilitySymbols[0];
  createChartJS();

  let tickValue = 1000;
  setInterval(() => {
    if (!selectedSymbol) return;
    tickValue += (Math.random() - 0.5) * 2;
    const tick = { quote: tickValue, epoch: Math.floor(Date.now()/1000) };
    handleTick(selectedSymbol, tick);
  }, 1000);
}

// === Init ===
buildSymbolList();
createControls();
logHistory('Interface ready. Enter token or connect in simulation mode.');
