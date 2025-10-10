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
let series = null;

// === Volatility symbols ===
const volatilitySymbols = ['BOOM1000', 'BOOM900', 'BOOM600', 'BOOM500', 'BOOM300',
                           'CRASH1000', 'CRASH900', 'CRASH600', 'CRASH500'];

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

// === Chart ===
function createChart() {
  chartInner.innerHTML = '';
  chart = LightweightCharts.createChart(chartInner, {
    width: chartInner.clientWidth || 600,
    height: chartInner.clientHeight || 300,
    layout: { textColor: '#e6edf3', background: { color: '#0d1117' } },
    grid: { vertLines: { color: '#222' }, horzLines: { color: '#222' } },
    timeScale: { timeVisible: true, secondsVisible: true }
  });

  series = chart.addLineSeries({ color: '#00ff9c', lineWidth: 2 });

  window.addEventListener('resize', () => {
    chart.applyOptions({
      width: chartInner.clientWidth || 600,
      height: chartInner.clientHeight || 300
    });
  });
}

// === Select Symbol ===
function selectSymbol(sym) {
  document.querySelectorAll('.symbolItem').forEach(el => el.classList.remove('active'));
  const el = document.getElementById('sym-' + sym);
  if (el) el.classList.add('active');
  selectedSymbol = sym;
  logHistory(`Selected symbol: ${sym}`);
  if (!chart) createChart();
  loadHistory(sym); // charge les 300 derniers ticks
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

// === Authorize account ===
function authorizeUser(token) { connection.send(JSON.stringify({ authorize: token })); }

// === Subscribe to balance ===
function getBalance() { connection.send(JSON.stringify({ balance: 1, subscribe: 1 })); }

// === Subscribe to all symbols ===
function subscribeAllSymbols() { 
  volatilitySymbols.forEach(s => connection.send(JSON.stringify({ ticks: s, subscribe: 1 }))); 
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

  // update chart
  if (selectedSymbol === symbol && series) {
    series.update({ time: tick.epoch, value: quote });
  }

  if (automationActive && selectedSymbol === symbol) runAutomation(symbol, quote);
}

// === Handle historical data ===
function handleHistory(data) {
  const symbol = data.echo_req?.ticks_history;
  if (!data.history || !symbol) return;

  const points = data.history.times.map((t, i) => ({
    time: Math.floor(Number(t)),
    value: Number(data.history.prices[i])
  }));

  if (!series) createChart();
  series.setData(points);
  logHistory(`Loaded ${points.length} ticks for ${symbol}`);
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

  document.getElementById('btnBuy').onclick = () => { logHistory('BUY clicked'); };
  document.getElementById('btnSell').onclick = () => { logHistory('SELL clicked'); };
  document.getElementById('btnClose').onclick = () => { logHistory('CLOSE clicked'); };
  document.getElementById('btnLaunch').onclick = () => { automationActive = true; logHistory('Automation started'); };
  document.getElementById('btnStop').onclick = () => { automationActive = false; logHistory('Automation stopped'); };
}

// === Simulation mode for testing without token ===
function startSimulation() {
  setStatus('Simulation mode ✅');
  if (!selectedSymbol) selectedSymbol = volatilitySymbols[0];
  if (!chart) createChart();

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
createControls();
logHistory('Interface ready. Enter token or connect in simulation mode.');
