// app.js - Deriv Volatility Web frontend avec TradingView Chart Widget
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
const chartContainer = document.getElementById('chartInner');

// === Global state ===
let connection = null;
let selectedSymbol = null;
let lastTick = {};
let token = null;
let automationActive = false;
let widget = null;
let simulationInterval = null;

// === Volatility symbols ===
const volatilitySymbols = ['R_100', 'R_75', 'R_50', 'R_25','R_10'];

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

  // Update TradingView widget
  if (widget) {
    widget.setSymbol(sym, "1");
  } else {
    createTradingViewWidget(sym);
  }
}

// === Create TradingView Widget ===
function createTradingViewWidget(symbol) {
  chartContainer.innerHTML = '';
  widget = new TradingView.widget({
    container_id: chartContainer.id,
    width: "100%",
    height: 400,
    symbol: symbol,
    interval: "1",
    timezone: "Etc/UTC",
    theme: "dark",
    style: "1",
    toolbar_bg: "#0d1117",
    hide_side_toolbar: false,
    allow_symbol_change: true,
    watchlist: volatilitySymbols
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
  if (token) {
    connection = new WebSocket(WS_URL);
    connection.onopen = () => {
      setStatus('Connected ✅');
      logHistory('Connected to Deriv WebSocket');
      authorizeUser(token);
    };
    connection.onmessage = msg => handleMessage(JSON.parse(msg.data));
    connection.onclose = () => { setStatus('Disconnected'); logHistory('WebSocket closed'); };
    connection.onerror = err => { console.error(err); setStatus('Connection error'); };
  } else {
    // Simulation mode
    setStatus('Simulation mode');
    startSimulation();
  }
}

// === Handle messages ===
function handleMessage(data) {
  if (!data) return;

  if (data.msg_type === 'authorize') {
    if (data.error) {
      logHistory('❌ Invalid token, switching to simulation mode');
      setStatus('Simulation mode');
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

  if (automationActive && selectedSymbol === symbol) runAutomation(symbol, quote);
}

// === Simulation mode ticks ===
function startSimulation() {
  if (simulationInterval) clearInterval(simulationInterval);

  simulationInterval = setInterval(() => {
    volatilitySymbols.forEach(sym => {
      const price = (Math.random()*1000+100).toFixed(2);
      handleTick(sym, { quote: Number(price), epoch: Math.floor(Date.now()/1000) });
    });
  }, 1000);
}

// === Automation logic ===
function runAutomation(symbol, price) {
  logHistory(`Automation: checking symbol ${symbol} at price ${price}`);
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

// === Init ===
buildSymbolList();
createControls();
logHistory('Interface ready. Enter token or connect in simulation mode.');
