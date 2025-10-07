// app.js - Deriv Boom/Crash Web frontend using @deriv/deriv-api
// Supports: Simulation (no token) & Real (token authorize)

import { DerivAPI } from '@deriv/deriv-api';
import WebSocket from 'ws';

// === Deriv connection ===
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
let api = null;
let connection = null;
let selectedSymbol = null;
let chart = null;
let series = null;
let lastTick = {};

// === Boom & Crash symbols ===
const boomCrashSymbols = [
  'BOOM1000', 'BOOM500', 'BOOM300',
  'CRASH1000', 'CRASH500', 'CRASH300'
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
  boomCrashSymbols.forEach(sym => {
    const div = document.createElement('div');
    div.className = 'symbolItem';
    div.id = 'sym-' + sym;
    div.innerHTML = `
      <div class="symTitle">${sym}</div>
      <div>Price: <span id="price-${sym}">--</span></div>
      <div>Tendance: <span id="dir-${sym}">--</span></div>
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

// === Connect to Deriv ===
connectBtn.addEventListener('click', async () => {
  const token = tokenInput.value.trim();
  await connectToDeriv(token || null);
});

async function connectToDeriv(token) {
  setStatus('Connecting...');
  connection = new WebSocket(WS_URL);
  api = new DerivAPI({ connection });

  connection.onopen = async () => {
    setStatus('Connected');
    logHistory('✅ WebSocket connected');

    if (token) {
      try {
        const auth = await api.authorize(token);
        logHistory(`Authorized as ${auth.authorize.loginid}`);
        setStatus(`Authorized: ${auth.authorize.loginid}`);
        getBalance();
      } catch (err) {
        console.error('Authorization failed:', err);
        logHistory('❌ Invalid token, switching to simulation mode');
        setStatus('Simulation mode (no token)');
      }
    } else {
      setStatus('Simulation mode (no token)');
    }

    subscribeAllSymbols();
  };

  connection.onclose = () => {
    setStatus('Disconnected');
    logHistory('WebSocket closed');
  };

  connection.onerror = (err) => {
    console.error('WebSocket error:', err);
    setStatus('Connection error');
  };
}

// === Subscribe to all Boom & Crash symbols ===
async function subscribeAllSymbols() {
  for (const symbol of boomCrashSymbols) {
    try {
      const tickStream = await api.subscribe({ ticks: symbol });
      tickStream.onUpdate((data) => handleTick(symbol, data.tick));
      tickStream.onError((error) => logHistory(`Error for ${symbol}: ${error.message}`));
    } catch (e) {
      logHistory(`Error subscribing to ${symbol}: ${e.message}`);
    }
  }
  logHistory('Subscribed to all Boom/Crash symbols');
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

// === Fetch balance (real mode only) ===
async function getBalance() {
  try {
    const balance = await api.balance({ subscribe: 1 });
    balance.onUpdate((data) => {
      const bal = data.balance.balance;
      balanceEl.textContent = `Balance: ${parseFloat(bal).toFixed(2)} USD`;
    });
  } catch (err) {
    console.error('Balance error:', err);
  }
}

// === Load historical ticks for chart ===
async function loadHistory(symbol) {
  try {
    const history = await api.ticks_history({
      ticks_history: symbol,
      end: 'latest',
      count: 300,
      style: 'ticks'
    });

    const data = history.history.times.map((t, i) => ({
      time: Number(t),
      value: Number(history.history.prices[i])
    }));

    if (series) series.setData(data);
  } catch (e) {
    logHistory(`Failed to load history for ${symbol}: ${e.message}`);
  }
}

// === Init ===
createChart();
buildSymbolList();
logHistory('Interface ready. Choose a symbol or connect.');
