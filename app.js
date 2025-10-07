const chartContainer = document.getElementById("chartInner");
const symbolList = document.getElementById("symbolList");
const pnlEl = document.getElementById("pnl");
const balanceEl = document.getElementById("userBalance");
const tradeHistoryEl = document.getElementById("tradeHistory");

const tokenInput = document.getElementById("tokenInput");
const connectBtn = document.getElementById("connectBtn");
const modeSelect = document.getElementById("modeSelect");
const lotInput = document.getElementById("lot");
const tpInput = document.getElementById("tp");
const slInput = document.getElementById("sl");
const martingaleBox = document.getElementById("martingale");
const multiplierInput = document.getElementById("multiplier");
const buyBtn = document.getElementById("buyBtn");
const sellBtn = document.getElementById("sellBtn");
const closeBtn = document.getElementById("closeBtn");

let chart, lineSeries;
let currentSymbol = null;
let balance = 10000;
let openTrade = null;
let trades = [];
let pnl = 0;

// --- WebSocket connection to Deriv API ---
let ws;
function connectDeriv(token) {
  ws = new WebSocket("wss://ws.derivws.com/websockets/v3?app_id=105747");
  ws.onopen = () => {
    console.log("Connected to Deriv API");
    balanceEl.innerText = balance.toFixed(2) + " USD";
  };
  ws.onmessage = (msg) => {
    const data = JSON.parse(msg.data);
    // handle incoming ticks here if needed
    // can subscribe to ticks via ws.send({...})
  };
}

// --- Symbols list ---
const symbols = [
  "boom_1000","boom_900","boom_600","boom_500","boom_300",
  "crash_1000","crash_900","crash_600","crash_500","crash_300"
];
symbols.forEach(sym => {
  const el = document.createElement("div");
  el.className = "symbolItem";
  el.textContent = sym;
  el.onclick = () => selectSymbol(sym);
  symbolList.appendChild(el);
});

// --- Initialize Chart ---
function selectSymbol(sym) {
  currentSymbol = sym;
  chartContainer.innerHTML = "";
  chart = LightweightCharts.createChart(chartContainer, { width: 850, height: 500 });
  lineSeries = chart.addLineSeries({ color: '#0f0' });
}

// --- Place Trade ---
function placeTrade(type) {
  if (!currentSymbol) return alert("Choisissez un symbole.");
  if (openTrade) return alert("Fermez la position avant d’en ouvrir une nouvelle.");

  const lot = parseFloat(lotInput.value);
  const tp = parseFloat(tpInput.value);
  const sl = parseFloat(slInput.value);
  const price = Math.floor(Math.random()*1000) + 100; // simulate price

  openTrade = { symbol: currentSymbol, type, lot, price, tp, sl };

  lineSeries.setMarkers([{ time: Date.now()/1000, position: 'aboveBar', color: type==='buy'?'lime':'red', shape:'arrowUp', text:type.toUpperCase() }]);
  updatePnL(price);
}

// --- Update PnL ---
function updatePnL(price) {
  if (!openTrade) return;
  const direction = openTrade.type === "buy" ? 1 : -1;
  const diff = (price - openTrade.price) * direction * 100;
  pnl = diff * parseFloat(openTrade.lot);
  pnlEl.innerText = pnl.toFixed(2) + " USD";
}

// --- Close Trade ---
function closeTrade() {
  if (!openTrade) return;
  const profit = pnl;
  balance += profit;
  balanceEl.innerText = balance.toFixed(2) + " USD";

  trades.push({ ...openTrade, profit });
  tradeHistoryEl.innerHTML = trades.map(t=>`${t.symbol} ${t.type} PnL: ${t.profit.toFixed(2)} USD`).join('<br>');
  openTrade = null;
  pnl = 0;
  pnlEl.innerText = "0.00 USD";

  if (profit < 0 && martingaleBox.checked) {
    lotInput.value = (parseFloat(lotInput.value) * parseFloat(multiplierInput.value)).toFixed(2);
  } else lotInput.value = "1.00";
}

// --- Event listeners ---
connectBtn.onclick = () => connectDeriv(tokenInput.value.trim());
buyBtn.onclick = () => placeTrade("buy");
sellBtn.onclick = () => placeTrade("sell");
closeBtn.onclick = closeTrade;
