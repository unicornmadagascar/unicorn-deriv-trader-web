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
const volatilitySymbols = [
  'BOOM1000', 'BOOM900', 'BOOM600', 'BOOM500', 'BOOM300',
  'CRASH1000', 'CRASH900', 'CRASH600', 'CRASH500'
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

// === Chart (modern white version) ===
function createChart() {
  chartInner.innerHTML = '';
  chart = LightweightCharts.createChart(chartInner, {
    width: chartInner.clientWidth || 600,
    height: chartInner.clientHeight || 300,
    layout: {
      background: { color: '#ffffff' },
      textColor: '#1a1a1a'
    },
    grid: {
      vertLines: { color: '#e6e6e6' },
      horzLines: { color: '#e6e6e6' }
    },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
    timeScale: { timeVisible: true, secondsVisible: true }
  });

  series = chart.addLineSeries({
    color: '#0078ff',
    lineWidth: 2
  });

  window.addEventListener('resize', () => {
    chart.applyOptions({
      width: chartInner.clientWidth,
      height: chartInner.clientHeight
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

  createChart();  // recrée le graphique propre
  lastTick = {};  // réinitialise les ticks

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
  connection.onclose = () => {
    setStatus('Disconnected');
    logHistory('WebSocket closed');
  };
  connection.onerror = err => {
    console.error(err);
    setStatus('Connection error');
  };
}

// === Handle WebSocket messages ===
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

  if (data.msg_type === 'tick' && data.tick?.symbol)
    handleTick(data.tick.symbol, data.tick);
  if (data.msg_type === 'history')
    handleHistory(data);
}

// === Authorize user ===
function authorizeUser(token) {
  connection.send(JSON.stringify({ authorize: token }));
}

// === Get balance ===
function getBalance() {
  connection.send(JSON.stringify({ balance: 1, subscribe: 1 }));
}

// === Subscribe to all volatility symbols ===
function subscribeAllSymbols() {
  volatilitySymbols.forEach(s =>
    connection.send(JSON.stringify({ ticks: s, subscribe: 1 }))
  );
  logHistory('Subscribed to all Volatility symbols');
}

// === Handle Ticks (realtime) ===
function handleTick(symbol, tick) {
  const priceEl = document.getElementById('price-' + symbol);
  const dirEl = document.getElementById('dir-' + symbol);

  const quote = Number(tick.quote);
  const prev = lastTick[symbol] ?? quote;
  const direction = quote >= prev ? '↑' : '↓';
  const color = quote >= prev ? '#009e60' : '#d62828';

  if (priceEl) priceEl.textContent = quote.toFixed(2);
  if (dirEl) { dirEl.textContent = direction; dirEl.style.color = color; }

  lastTick[symbol] = quote;

  // update chart uniquement pour le symbole sélectionné
  if (selectedSymbol === symbol && series) {
    series.update({ time: tick.epoch, value: quote });
  }

  if (automationActive && selectedSymbol === symbol)
    runAutomation(symbol, quote);
}

// === Handle Historical Data ===
function handleHistory(data) {
  const symbol = data.echo_req?.ticks_history;
  if (!data.history || !symbol) return;
  if (symbol !== selectedSymbol) return; // ignore les autres symboles

  const points = data.history.times.map((t, i) => ({
    time: Math.floor(Number(t)),
    value: Number(data.history.prices[i])
  }));

  if (!chart || !series) createChart();
  series.setData(points);

  logHistory(`Loaded ${points.length} historical ticks for ${symbol}`);
}

// === Load Historical Data ===
function loadHistory(symbol) {
  if (!connection) return;
  connection.send(JSON.stringify({
    ticks_history: symbol,
    end: 'latest',
    count: 300,
    style: 'ticks'
  }));
}

// === Automation logic placeholder ===
function runAutomation(symbol, price) {
  logHistory(`Automation check for ${symbol} at price ${price}`);
  // Here you can integrate TP/SL/Martingale strategies
}

// === Create Control Buttons ===
function createControls() {
  controlsEl.innerHTML = `
    <button id="btnBuy">BUY</button>
    <button id="btnSell">SELL</button>
    <button id="btnClose">CLOSE</button>
    <button id="btnLaunch">START AUTO</button>
    <button id="btnStop">STOP AUTO</button>
  `;

  document.getElementById('btnBuy').onclick = () => logHistory('BUY clicked');
  document.getElementById('btnSell').onclick = () => logHistory('SELL clicked');
  document.getElementById('btnClose').onclick = () => logHistory('CLOSE clicked');
  document.getElementById('btnLaunch').onclick = () => {
    automationActive = true;
    logHistory('Automation started');
  };
  document.getElementById('btnStop').onclick = () => {
    automationActive = false;
    logHistory('Automation stopped');
  };
}

// === Simulation mode (no token) ===
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
