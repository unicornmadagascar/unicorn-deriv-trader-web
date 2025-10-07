// app.js - Web frontend for Deriv WebSocket
// IMPORTANT: Test in "Simulation" first. Live mode will execute real trades on your account.

const APP_ID = 105747; // public example app_id
const WS_URL = `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;

// UI elements
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

let ws = null;
let isConnected = false;
let isAuthorized = false;
let authorizeInfo = null;
let keepAliveTimer = null;

let selectedSymbol = null;
const symbols = [
  "Boom 1000","Boom 900","Boom 600","Boom 500","Boom 300",
  "Crash 1000","Crash 900","Crash 600","Crash 500","Crash 300"
];

// chart
let chart = null;
let series = null;
let markers = [];

// state
let lastTick = {}; // last tick price per symbol
let simulatedPositions = {}; // per symbol array
let openLiveContracts = {}; // store contract ids for live buys (by id)
let lastProposalForBuy = null; // store last proposal (when we request one)
let reqIdCounter = 1;

// helpers
function logHistory(txt) {
  const div = document.createElement('div');
  div.textContent = `${new Date().toLocaleTimeString()} — ${txt}`;
  historyList.prepend(div);
}

function setStatus(s) {
  statusEl.textContent = s;
}

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
    try { chart.applyOptions({ width: chartInner.clientWidth, height: chartInner.clientHeight }); } catch(e){}
  });
}

function addMarker(symbol, timeSec, price, type, label) {
  markers.push({
    time: Math.floor(timeSec),
    position: type === 'BUY' ? 'belowBar' : 'aboveBar',
    color: type === 'BUY' ? '#00a000' : '#c30000',
    shape: type === 'BUY' ? 'arrowUp' : 'arrowDown',
    text: label || type
  });
  if (series) series.setMarkers(markers);
}

// WebSocket send with debug
function wsSend(obj) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.warn('WS not open:', obj);
    return;
  }
  try {
    ws.send(JSON.stringify(obj));
    // console.debug('> ', obj);
  } catch (e) {
    console.error('ws send fail', e);
  }
}

// Connect / authorize
connectBtn.addEventListener('click', () => {
  const token = tokenInput.value.trim();
  connectToDeriv(token || null);
});

function connectToDeriv(token) {
  if (ws) {
    try { ws.close(); } catch(e){}
    ws = null;
  }

  ws = new WebSocket(WS_URL);
  setStatus('Connecting...');
  ws.onopen = () => {
    isConnected = true;
    setStatus('Connected (unauthorized)');
    logHistory('WebSocket opened');

    // authorize only if token provided
    if (token) {
      const msg = { authorize: token };
      wsSendWhenOpen(msg);
    } else {
      // no token - simulation only
      setStatus('Connected (simulation)');
    }

    // keep alive ping
    keepAliveTimer = setInterval(()=> {
      wsSendWhenOpen({ ping: 1 });
    }, 20000);
  };

  ws.onclose = () => {
    isConnected = false;
    isAuthorized = false;
    authorizeInfo = null;
    setStatus('Disconnected');
    logHistory('WebSocket closed');
    if (keepAliveTimer) { clearInterval(keepAliveTimer); keepAliveTimer = null; }
  };

  ws.onerror = (err) => {
    console.error('WS error', err);
    setStatus('WebSocket error (see console)');
  };

  ws.onmessage = (evt) => {
    try {
      const msg = JSON.parse(evt.data);
      // console.debug('<', msg);
      handleMessage(msg);
    } catch (e) {
      console.error('Invalid JSON', e, evt.data);
    }
  };
}

// send only when ws open; if not open, wait a short time
function wsSendWhenOpen(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  } else {
    // wait until open
    const timer = setInterval(()=> {
      if (ws && ws.readyState === WebSocket.OPEN) {
        clearInterval(timer);
        ws.send(JSON.stringify(obj));
      }
    }, 100);
  }
}

// handle incoming messages
function handleMessage(msg) {
  if (msg.error) {
    console.warn('API error', msg);
    logHistory('API error: ' + JSON.stringify(msg.error));
  }

  // Authorization response
  if (msg.authorize) {
    isAuthorized = true;
    authorizeInfo = msg.authorize;
    setStatus(`Authorized: ${authorizeInfo.loginid || 'unknown'}`);
    logHistory(`Authorized as ${authorizeInfo.loginid || 'unknown'}`);
    // request balance (one-time)
    wsSendWhenOpen({ balance: 1, subscribe: 1 });
    return;
  }

  // balance update
  if (msg.balance) {
    try {
      const b = typeof msg.balance === 'object' && msg.balance.balance ? msg.balance.balance : msg.balance;
      balanceEl.textContent = 'Balance: ' + (parseFloat(b).toFixed ? parseFloat(b).toFixed(2) : b);
    } catch(e){}
    return;
  }

  // ticks (single tick update)
  if (msg.tick) {
    const t = msg.tick;
    // tick contains: epoch, quote, symbol? some responses include 'symbol' in echo_req
    const symbol = msg.echo_req && msg.echo_req.ticks ? msg.echo_req.ticks : t.symbol || selectedSymbol;
    const quote = Number(t.quote);
    const epoch = Number(t.epoch);
    lastTick[symbol] = quote;

    // update the list UI (bid/ask approximated)
    const bidEl = document.getElementById('bid-' + symbol);
    const askEl = document.getElementById('ask-' + symbol);
    const chgEl = document.getElementById('chg-' + symbol);
    if (bidEl) bidEl.textContent = (quote - 0.0001).toFixed(5);
    if (askEl) askEl.textContent = (quote + 0.0001).toFixed(5);

    // change %:
    const prev = parseFloat(bidEl?.dataset?.prev || '0') || 0;
    if (prev !== 0) {
      const change = ((quote - prev) / prev) * 100;
      if (chgEl) chgEl.textContent = change.toFixed(3) + '%';
    }
    if (bidEl) bidEl.dataset.prev = quote;

    // Update chart if this is selected symbol
    if (symbol === selectedSymbol && series) {
      try {
        series.update({ time: Math.floor(epoch), value: quote });
      } catch(e){}
    }
    return;
  }

  // ticks_history response => build initial series
  if (msg.history || msg.candles || msg['ticks_history']) {
    // support several possible response shapes
    let prices = null, times = null;
    if (msg.history && msg.history.prices && msg.history.times) {
      prices = msg.history.prices;
      times = msg.history.times;
    } else if (msg.candles && Array.isArray(msg.candles)) {
      // candles array with {close, epoch}
      const data = msg.candles.map(c => ({ time: c.epoch, value: Number(c.close) }));
      if (series) series.setData(data);
      return;
    } else if (msg['history']) {
      // older shapes
      if (Array.isArray(msg['history'])) {
        const data = msg['history'].map(h => ({ time: Math.floor(Number(h.epoch)), value: Number(h.quote) }));
        if (series) series.setData(data);
        return;
      }
    } else if (msg['ticks_history'] && msg['ticks_history'].history) {
      const h = msg['ticks_history'].history;
      if (h.prices && h.times) {
        prices = h.prices; times = h.times;
      }
    }

    if (prices && times) {
      const data = times.map((t,i)=>({ time: Math.floor(Number(t)/1000)||Math.floor(Number(t)), value: Number(prices[i]) }));
      if (series) series.setData(data);
    }
    return;
  }

  // proposal response (for buy flow)
  if (msg.proposal) {
    // proposal structure varies; we try to extract id & ask_price
    const proposal = msg.proposal;
    // passthrough: if we used passthrough to mark this proposal as coming from a "buy" UI action
    const passthrough = msg.passthrough || (msg.echo_req && msg.echo_req.passthrough) || null;

    // Save the proposal so buy can use it
    lastProposalForBuy = { proposal, passthrough, raw: msg };

    // If this proposal was requested to immediately buy (we set passthrough.action === 'BUY_NOW')
    if (passthrough && passthrough.action === 'BUY_NOW') {
      // Extract ID: proposal.id is common
      const id = proposal.id || (proposal.proposal && proposal.proposal.id) || null;
      // If id missing, try other keys
      if (id) {
        const price = proposal.ask_price || proposal.display_value || proposal.proposal?.ask_price || null;
        const buyReq = { buy: id };
        if (price) buyReq.price = Number(price);
        wsSendWhenOpen(buyReq);
        logHistory('Sent BUY request for proposal id ' + id);
      } else {
        logHistory('Proposal received but could not find id (see console).');
        console.warn('proposal message', msg);
      }
    } else {
      // otherwise just show proposal info in history (useful for debugging)
      logHistory('Proposal received (not auto-buy).');
      console.debug('proposal', msg);
    }
    return;
  }

  // buy response
  if (msg.buy) {
    // buy response contains one-time purchase confirmation
    const buy = msg.buy;
    // common fields: contract_id, purchase_time, buy.price? check structure
    logHistory('Buy response: ' + JSON.stringify(buy));
    // add to history and marker if contains purchase_time/purchase_price
    const purchase_time = buy.purchase_time || buy.transaction_time || Math.floor(Date.now()/1000);
    const purchase_price = buy.purchase_price || buy.buy_price || buy.price || null;
    addTradeRecord({ type: 'LIVE BUY', symbol: selectedSymbol, info: buy, time: purchase_time, price: purchase_price });
    return;
  }

  // generic responses (debug)
  //console.debug('Unhandled message', msg);
}

// UI: build symbol list
function buildSymbolList() {
  symbolListEl.innerHTML = '';
  symbols.forEach(s => {
    const div = document.createElement('div');
    div.className = 'symbolItem';
    div.id = 'sym-' + s;
    div.innerHTML = `<div style="font-weight:700">${s.toUpperCase()}</div>
      <div>Bid: <span id="bid-${s}">--</span> Ask: <span id="ask-${s}">--</span></div>
      <div>Δ: <span id="chg-${s}">--</span></div>`;
    div.addEventListener('click', ()=>selectSymbol(s));
    symbolListEl.appendChild(div);
  });
}

// when user selects a symbol
function selectSymbol(sym) {
  document.querySelectorAll('.symbolItem').forEach(el=>el.classList.remove('active'));
  const el = document.getElementById('sym-'+sym);
  if (el) el.classList.add('active');

  selectedSymbol = sym;
  createChart();
  markers = [];
  // request ticks_history for initial data (200 ticks)
  if (ws && ws.readyState === WebSocket.OPEN) {
    wsSendWhenOpen({ ticks_history: sym, end: 'latest', count: 200, style: 'ticks' });
    // subscribe to live ticks
    wsSendWhenOpen({ ticks: sym, subscribe: 1 });
  } else {
    // fallback: show empty chart
    if (series) series.setData([]);
  }
  setStatus(isAuthorized ? `Authorized - ${authorizeInfo?.loginid || ''}` : 'Connected (simulation)');
}

// add trade record to UI and marker
function addTradeRecord(tr) {
  // tr: { type, symbol, info, time, price, pnl (optional) }
  const ttxt = `${tr.type} ${tr.symbol || selectedSymbol} ${tr.price?('price:'+Number(tr.price).toFixed(5)) : ''} ${tr.pnl?('PnL:'+Number(tr.pnl).toFixed(4)) : ''}`;
  logHistory(ttxt);
  if (tr.time && tr.price) addMarker(tr.symbol || selectedSymbol, tr.time, tr.price, tr.type.includes('BUY') ? 'BUY' : 'SELL', tr.type);
}

// Place buy/sell (handles simulation & live)
async function placeOrder(type) {
  if (!selectedSymbol) return alert('Select a symbol first.');
  const mode = modeSelect.value;
  const stake = parseFloat(stakeInput.value) || 1;
  const lot = parseFloat(lotInput.value) || 1;

  if (mode === 'simulation') {
    // open simulated position
    const price = lastTick[selectedSymbol] || (Math.random()*1000);
    const t = Math.floor(Date.now()/1000);
    const pos = { symbol: selectedSymbol, type, stake, price, time: t, status: 'open' };
    simulatedPositions[selectedSymbol] = simulatedPositions[selectedSymbol] || [];
    simulatedPositions[selectedSymbol].push(pos);
    addTradeRecord({ type: 'SIM '+type, symbol: selectedSymbol, time: t, price });
    // draw TP/SL if set
    const tpPct = parseFloat(tpInput.value) || null;
    const slPct = parseFloat(slInput.value) || null;
    if (tpPct) {
      const tpPrice = type === 'BUY' ? price * (1 + tpPct/100) : price * (1 - tpPct/100);
      addMarker(selectedSymbol, t, tpPrice, type, 'TP');
    }
    if (slPct) {
      const slPrice = type === 'BUY' ? price * (1 - slPct/100) : price * (1 + slPct/100);
      addMarker(selectedSymbol, t, slPrice, type, 'SL');
    }
    updatePnLSummary();
    return;
  }

  // Live mode: we need to be authorized
  if (!isAuthorized) return alert('You must authorize with your API token to trade in Live mode.');

  // Create a price proposal then buy when proposal returned.
  // We'll use passthrough.action to detect which proposal is for immediate buy.
  const duration = 1; // default duration
  const duration_unit = 's'; // seconds; you could allow changing via UI
  const contract_type = type === 'BUY' ? 'CALL' : 'PUT';

  const passthrough = { action: 'BUY_NOW', ui_type: type, stake };

  const proposalReq = {
    proposal: 1,
    amount: String(stake),
    basis: 'stake',
    contract_type,
    symbol: selectedSymbol,
    duration,
    duration_unit,
    currency: authorizeInfo?.currency || undefined,
    passthrough
  };

  wsSendWhenOpen(proposalReq);
  logHistory(`Requested proposal for ${type} ${selectedSymbol} stake ${stake} (waiting for proposal -> buy)`);
}

// update PnL summary for simulations
function updatePnLSummary(){
  let total = 0;
  Object.keys(simulatedPositions).forEach(sym=>{
    simulatedPositions[sym].forEach(p=>{
      if (p.status === 'closed' && p.pnl) total += p.pnl;
    });
  });
  pnlEl.textContent = 'PnL: ' + total.toFixed(4);
}

// Close (simulation) - closes open simulated positions for current symbol
function closePositions() {
  if (!selectedSymbol) return alert('Select a symbol');
  const arr = simulatedPositions[selectedSymbol] || [];
  arr.forEach(p=>{
    if (p.status === 'open') {
      // close at current price (lastTick)
      const exitPrice = lastTick[selectedSymbol] || p.price;
      p.exitPrice = exitPrice;
      p.exitTime = Math.floor(Date.now()/1000);
      p.status = 'closed';
      const direction = p.type === 'BUY' ? 1 : -1;
      p.pnl = p.stake * direction * ((p.exitPrice - p.entryPrice || p.price) / (p.entryPrice || p.price || 1));
      addTradeRecord({ type: 'SIM CLOSE', symbol: selectedSymbol, time: p.exitTime, price: exitPrice, pnl: p.pnl });
    }
  });
  updatePnLSummary();
}

// bind buttons
buyBtn.addEventListener('click', ()=> placeOrder('BUY'));
sellBtn.addEventListener('click', ()=> placeOrder('SELL'));
closeBtn.addEventListener('click', ()=> {
  // if live mode, attempt to close all live positions: NOTE - closing live contracts programmatically requires different API and permissions.
  if (modeSelect.value === 'live') {
    alert('Closing live contracts programmatically is not implemented in this demo. Use Deriv UI or implement sell/contract close via buy/sell API with contract_id.');
    return;
  }
  closePositions();
});

// initial setup
createChart();
buildSymbolList();
logHistory('Interface ready. Select a symbol.');

// Helper: attempt to gracefully extract proposal id
function extractProposalId(proposalObj) {
  if (!proposalObj) return null;
  return proposalObj.id || proposalObj.proposal?.id || null;
}

// Additional: parse messages for passthrough from proposal and buy flow
// (we already handled in handleMessage)

// Note: If you want to show the live proposal details UI, extend handleMessage to display ask_price / payout etc.

