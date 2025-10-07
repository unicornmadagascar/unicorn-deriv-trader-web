// app.js - Deriv Volatility Web frontend
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
const chartInner = document.getElementById('chartInner');

// === Global state ===
let connection = null;
let selectedSymbol = null;
let lastTick = {};
let token = null;
let automationActive = false;
let chart = null;
let seriesMap = {}; // série pour chaque symbole
let simulationInterval = null;

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

// === Handle Symbol Selection ===
function selectSymbol(sym) {
  document.querySelectorAll('.symbolItem').forEach(el => el.classList.remove('active'));
  const el = document.getElementById('sym-' + sym);
  if (el) el.classList.add('active');
  selectedSymbol = sym;
  logHistory(`Selected symbol: ${sym}`);
}

// === Chart Setup ===
function createChart() {
  chartInner.innerHTML = '';
  chart = LightweightCharts.createChart(chartInner, {
    width: chartInner.clientWidth || 600,
    height: 300,
    layout: { textColor: '#e6edf3', background: { color: '#0d1117' } },
    grid: { vertLines: { color: '#222' }, horzLines: { color: '#222' } },
    timeScale: { timeVisible: true, secondsVisible: true }
  });

  // une série par symbole
  volatilitySymbols.forEach(sym => {
    seriesMap[sym] = chart.addLineSeries({ color: '#00ff9c', lineWidth: 2 });
  });

  window.addEventListener('resize', () => {
    chart.applyOptions({
      width: chartInner.clientWidth || 600,
      height: 300
    });
  });
}

// === Connect button ===
connectBtn.addEventListener('click', () => {
  token = tokenInput.value.trim() || null;
  connectToDeriv();
});

// === Connect to Deriv ===
function connectToDeriv() {
  setStatus('Connecting...');
  if (!token) {
    // Simulation mode
    setStatus('Simulation mode');
    logHistory('Running in simulation mode');
    subscribeAllSymbols();
    startSimulation();
    return;
  }

  connection = new WebSocket(WS_URL);

  connection.onopen = () => {
    setStatus('Connected ✅');
    logHistory('Connected to Deriv WebSocket');
    authorizeUser(token);
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
}

// === Authorize account ===
function authorizeUser(token) { connection.send(JSON.stringify({ authorize: token })); }

// === Subscribe to balance ===
function getBalance() { connection.send(JSON.stringify({ balance: 1, subscribe: 1 })); }

// === Subscribe to all symbols ===
function subscribeAllSymbols() {
  volatilitySymbols.forEach(s => {
    if (connection) connection.send(JSON.stringify({ ticks: s, subscribe: 1 }));
  });
  logHistory('Subscribed to all Volatility symbols');
}

// === Handle incoming ticks ===
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

  if (seriesMap[symbol]) {
    const time = tick.epoch ? tick.epoch : Math.floor(Date.now()/1000);
    seriesMap[symbol].update({ time, value: quote });
  }

  if (automationActive && selectedSymbol === symbol) runAutomation(symbol, quote);
}

// === Simulation of ticks (for mode simulation) ===
function startSimulation() {
  if (simulationInterval) clearInterval(simulationInterval);
  simulationInterval = setInterval(() => {
    volatilitySymbols.forEach(sym => {
      const prev = lastTick[sym] || 1000;
      const change = (Math.random() - 0.5) * 10; // variation aléatoire
      const quote = Math.max(0, prev + change);
      handleTick(sym, { quote, epoch: Math.floor(Date.now()/1000) });
    });
  }, 1000);
}

// === Automation logic ===
function runAutomation(symbol, price) {
  logHistory(`Automation: checking symbol ${symbol} at price ${price}`);
  // ici tu peux intégrer Money Management, TP/SL, Martingale, Buy/Sell Numbers séparés
}

// === BUY/SELL/CLOSE & Automation Controls + Money/Risk Management ===
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

  document.getElementById('btnBuy').onclick = () => logHistory('BUY clicked');
  document.getElementById('btnSell').onclick = () => logHistory('SELL clicked');
  document.getElementById('btnClose').onclick = () => logHistory('CLOSE clicked');
  document.getElementById('btnLaunch').onclick = () => { automationActive = true; logHistory('Automation started'); };
  document.getElementById('btnStop').onclick = () => { automationActive = false; logHistory('Automation stopped'); };
}

// === Init ===
buildSymbolList();
createControls();
createChart();
logHistory('Interface ready. Enter token or connect in simulation mode.');
