document.addEventListener("DOMContentLoaded", () => {
  const APP_ID = 105747;
  const TOKEN = "wgf8TFDsJ8Ecvze";
  const WS_URL = `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;

  // Generic WebSocket manager that supports subscribing to message types and automatic reconnect
  class WebSocketManager {
    constructor(url, name = 'ws') {
      this.url = url;
      this.name = name;
      this.ws = null;
      this.authorized = false;
      this.handlers = new Map(); // msg_type -> Set(callback)
      this.reconnectAttempts = 0;
      this.maxReconnectAttempts = 6;
      this.reconnectDelay = 2000;
    }

    connect() {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) return Promise.resolve(this.ws);
      if (this.ws && this.ws.readyState === WebSocket.CONNECTING) return new Promise((r) => setTimeout(() => r(this.ws), 500));

      return new Promise((resolve, reject) => {
        try {
          this.ws = new WebSocket(this.url);

          this.ws.onopen = () => {
            this.reconnectAttempts = 0;
            this._log('connected');
            // send authorize right away
            try { this.send({ authorize: TOKEN }); } catch (e) {}
            resolve(this.ws);
          };

          this.ws.onmessage = (evt) => {
            let data;
            try { data = JSON.parse(evt.data); } catch (e) { this._log('parse error', e); return; }
            this._handleMessage(data);
          };

          this.ws.onclose = () => {
            this._log('closed');
            this.authorized = false;
            this._scheduleReconnect();
          };

          this.ws.onerror = (err) => {
            this._log('error', err);
          };
        } catch (err) {
          reject(err);
        }
      });
    }

    _scheduleReconnect() {
      if (this.reconnectAttempts >= this.maxReconnectAttempts) return;
      this.reconnectAttempts++;
      const delay = this.reconnectDelay * this.reconnectAttempts;
      setTimeout(() => { try { this.connect(); } catch (e) {} }, delay);
    }

    on(msg_type, cb) {
      if (!this.handlers.has(msg_type)) this.handlers.set(msg_type, new Set());
      this.handlers.get(msg_type).add(cb);
    }

    off(msg_type, cb) {
      this.handlers.get(msg_type)?.delete(cb);
    }

    _handleMessage(data) {
      // handle authorize specially
      if (data.msg_type === 'authorize' || data.authorize) {
        this.authorized = Boolean(data.authorize);
        this._emit('authorize', data.authorize || data);
        // also call any msg_type='authorize' handlers
        this.handlers.get('authorize')?.forEach(cb => safeCall(cb, data.authorize || data));
        return;
      }

      // For common msg_type field
      const type = data.msg_type || Object.keys(data)[0];
      if (type && this.handlers.has(type)) {
        this.handlers.get(type).forEach(cb => safeCall(cb, data[type] ?? data));
      }
      // fallback: emit 'message' for any raw data
      if (this.handlers.has('message')) this.handlers.get('message').forEach(cb => safeCall(cb, data));
    }

    subscribeTick(symbol, subscribe = true) {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) { this.connect().then(() => this.subscribeTick(symbol, subscribe)); return; }
      if (subscribe) {
        try { this.send({ forget_all: 'ticks' }); } catch (e) {}
        this.send({ ticks: symbol, subscribe: 1 });
      } else {
        this.send({ forget_all: 'ticks' });
      }
    }

    subscribePortfolio() { if (this.ws && this.ws.readyState === WebSocket.OPEN) this.send({ portfolio: 1, subscribe: 1 }); else this.connect().then(()=>this.send({ portfolio: 1, subscribe: 1 })); }
    subscribeActivePositions() { if (this.ws && this.ws.readyState === WebSocket.OPEN) this.send({ active_positions: 1, subscribe: 1 }); else this.connect().then(()=>this.send({ active_positions: 1, subscribe: 1 })); }
    subscribeProposalOpenContract(contract_id) { if (this.ws && this.ws.readyState === WebSocket.OPEN) this.send({ proposal_open_contract: 1, contract_id, subscribe: 1 }); else this.connect().then(()=>this.send({ proposal_open_contract: 1, contract_id, subscribe: 1 })); }

    send(obj) {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        // try to connect and resend
        this.connect().then(() => { try { this.ws.send(JSON.stringify(obj)); } catch (e) { this._log('send failed after connect', e); } });
        return;
      }
      this.ws.send(JSON.stringify(obj));
    }

    _emit(name, payload) {
      this.handlers.get(name)?.forEach(cb => safeCall(cb, payload));
    }

    _log(...args) { console.debug(`[${this.name}]`, ...args); }
    close() { try { this.ws?.close(); } catch (e) {}; this.ws = null; this.authorized = false; }
  }

  function safeCall(cb, ...args){ try { cb(...args); } catch (e) { console.error('handler error', e); } }

  // UI
  const connectBtn = document.getElementById("connectBtn");
  const symbolList = document.getElementById("symbolList");
  const chartInner = document.getElementById("chartInner");
  const volGauge = document.getElementById("volGauge");
  const trendGauge = document.getElementById("trendGauge");
  const probGauge = document.getElementById("probGauge");
  const controlFormPanel = document.getElementById("controlFormPanel");
  const controlPanelToggle = document.getElementById("controlPanelToggle");
  const accountInfo = document.getElementById("accountInfo");
  const plGauge = document.getElementById("plGauge");
  const multiplierInput = document.getElementById("multiplierSelect");
  const buyBtn = document.getElementById("buyBtn");
  const sellBtn = document.getElementById("sellBtn");
  const stakeInput = document.getElementById("stakeInput");
  const takeProfitInput = document.getElementById("tpInput");
  const stopLossInput = document.getElementById("slInput");
  const closewinning = document.getElementById("closeWinning");
  const closeAll = document.getElementById("closeAll");
  const buyNum = document.getElementById("buyNumberInput");
  const sellNum = document.getElementById("sellNumberInput");
  const contractsPanelToggle = document.getElementById("contractsPanelToggle");
  const contractsPanel = document.getElementById("contractsPanel");
  const autoHistoryList = document.getElementById("autoHistoryList");

  // state
  let totalPL = 0;
  let automationRunning = false;
  let smoothVol = 0;
  let smoothTrend = 0;
  let isSubscribed = false;
  let currentSymbol = null;

  let chart = null;
  let areaSeries = null;
  let chartData = [];
  let lastPrices = {};
  let recentChanges = [];
  let tickHistory = [];
  let Dispersion;

  const SYMBOLS = [
    { symbol: "BOOM1000", name: "Boom 1000" },
    { symbol: "CRASH1000", name: "Crash 1000" },
    { symbol: "BOOM500", name: "Boom 500" },
    { symbol: "CRASH500", name: "Crash 500" },
    { symbol: "BOOM900", name: "Boom 900" },
    { symbol: "CRASH900", name: "Crash 900" },
    { symbol: "BOOM600", name: "Boom 600" },
    { symbol: "CRASH600", name: "Crash 600" },
    { symbol: "R_100", name: "VIX 100" },
    { symbol: "R_75", name: "VIX 75" },
    { symbol: "R_50", name: "VIX 50" },
    { symbol: "R_25", name: "VIX 25" },
    { symbol: "R_10", name: "VIX 10" }
  ];

  const fmt = n => Number(n).toFixed(2);
  const safeNum = v => (typeof v === "number" && !isNaN(v)) ? v : 0;

  // create two managers: main for ticks/trading, contracts for portfolio/active_positions
  const mainWS = new WebSocketManager(WS_URL, 'main');
  const contractsWS = new WebSocketManager(WS_URL, 'contracts');

  // UI helpers
  function displaySymbols() {
    if (!symbolList) return;
    symbolList.innerHTML = "";
    SYMBOLS.forEach(s => {
      const el = document.createElement("div");
      el.className = "symbol-item";
      el.textContent = s.name;
      el.dataset.symbol = s.symbol;
      el.addEventListener("click", () => {
        document.querySelectorAll('.symbol-item').forEach(item => { item.classList.remove('active'); item.style.background = '#eee'; item.style.color = '#000'; });
        el.classList.add('active'); el.style.background = '#007bff'; el.style.color = '#fff';
        subscribeSymbol(s.symbol);
      });
      symbolList.appendChild(el);
    });
  }

  function initChart() {
    try { if (chart) chart.remove(); } catch (e) {}
    chartInner.innerHTML = '';
    chart = LightweightCharts.createChart(chartInner, { layout: { textColor: "#333", background: { type: "solid", color: "#fff" } }, timeScale: { timeVisible: true, secondsVisible: true } });
    areaSeries = chart.addAreaSeries({ lineColor: "#2962FF", topColor: "rgba(41,98,255,0.28)", bottomColor: "rgba(41,98,255,0.05)", lineWidth: 2 });
    chartData = []; recentChanges = []; lastPrices = {};
    positionGauges();
  }

  function positionGauges() {
    // same as original: append gauge elements if not present
    let gaugesContainer = document.getElementById("gaugesContainer");
    if (!gaugesContainer) {
      gaugesContainer = document.createElement("div");
      gaugesContainer.id = "gaugesContainer";
      gaugesContainer.style.position = "absolute";
      gaugesContainer.style.top = "10px";
      gaugesContainer.style.left = "10px";
      gaugesContainer.style.display = "flex";
      gaugesContainer.style.gap = "20px";
      gaugesContainer.style.zIndex = "12";
      chartInner.style.position = "relative";
      chartInner.appendChild(gaugesContainer);
      appendGauge(gaugesContainer, volGauge, "Volatility");
      appendGauge(gaugesContainer, trendGauge, "Tendance");
      appendGauge(gaugesContainer, probGauge, "Probabilité");
      appendGauge(gaugesContainer, plGauge, "P/L Live");
    }
  }

  function appendGauge(container, gaugeDiv, labelText) {
    const wrapper = document.createElement("div"); wrapper.style.display = "flex"; wrapper.style.flexDirection = "column"; wrapper.style.alignItems = "center"; wrapper.style.width = "140px"; wrapper.style.pointerEvents = "none";
    const content = document.createElement("div"); content.style.width = "100%"; content.appendChild(gaugeDiv); wrapper.appendChild(content);
    const label = document.createElement("div"); label.textContent = labelText; label.style.fontSize = "13px"; label.style.fontWeight = "600"; label.style.textAlign = "center"; label.style.marginTop = "6px"; label.style.pointerEvents = "none"; wrapper.appendChild(label);
    container.appendChild(wrapper);
  }

  function drawCircularGauge(container, value, color) {
    if (!container) return;
    const size = 110; container.style.width = size + "px"; container.style.height = (size + 28) + "px";
    let canvas = container.querySelector("canvas"); let pct = container.querySelector(".gauge-percent");
    if (!canvas) { canvas = document.createElement("canvas"); canvas.width = canvas.height = size; canvas.style.display = "block"; canvas.style.margin = "0 auto"; canvas.style.pointerEvents = "none"; container.innerHTML = ""; container.appendChild(canvas);
      pct = document.createElement("div"); pct.className = "gauge-percent"; pct.style.textAlign = "center"; pct.style.marginTop = "-92px"; pct.style.fontSize = "16px"; pct.style.fontWeight = "700"; pct.style.color = "#222"; pct.style.pointerEvents = "none"; container.appendChild(pct); }
    const ctx = canvas.getContext("2d"); ctx.clearRect(0,0,size,size); const center = size/2; const radius = size/2 - 8; const start = -Math.PI/2; const end = start + (Math.min(value,100)/100)*2*Math.PI;
    ctx.beginPath(); ctx.arc(center, center, radius, 0, 2*Math.PI); ctx.strokeStyle = "#eee"; ctx.lineWidth = 8; ctx.stroke();
    ctx.beginPath(); ctx.arc(center, center, radius, start, end); ctx.strokeStyle = color; ctx.lineWidth = 8; ctx.lineCap = "round"; ctx.stroke();
    pct.textContent = `${Math.round(value)}%`;
  }

  function updateCircularGauges() {
    if (!recentChanges.length) return; const mean = recentChanges.reduce((a,b)=>a+b,0)/recentChanges.length; const variance = recentChanges.reduce((a,b)=>a+Math.pow(b-mean,2),0)/recentChanges.length; const stdDev = Math.sqrt(variance); const volProb = Math.min(100,(stdDev/0.07)*100);
    const sum = recentChanges.reduce((a,b)=>a+b,0); const trendRaw = Math.min(100, Math.abs(sum)*1000);
    const pos = recentChanges.filter(v=>v>0).length; const neg = recentChanges.filter(v=>v<0).length; const dominant = Math.max(pos,neg); const prob = recentChanges.length ? Math.round((dominant/recentChanges.length)*100) : 50;
    const alpha = 0.25; smoothVol = smoothVol === 0 ? volProb : smoothVol + alpha*(volProb - smoothVol); smoothTrend = smoothTrend === 0 ? trendRaw : smoothTrend + alpha*(trendRaw - smoothTrend);
    drawCircularGauge(volGauge, smoothVol, "#ff9800"); drawCircularGauge(trendGauge, smoothTrend, "#2962FF"); drawCircularGauge(probGauge, prob, "#4caf50");
  }

  function updatePLGauge(plValue) { totalPL = plValue; const color = totalPL >= 0 ? "#4caf50" : "#f44336"; const deg = Math.min(360, Math.abs(totalPL)*3.6); if (plGauge) { plGauge.style.background = `conic-gradient(${color} ${deg}deg, #ddd ${deg}deg)`; const span = plGauge.querySelector("span"); if (span) span.textContent = `${totalPL>=0?'+':''}${totalPL.toFixed(2)}$`; } }

  function sigmoid(x) { return (1 - 1 / (1 + Math.exp(-x))); }
  function ecartType(values) { if (!values || values.length === 0) return 0; const mean = values.reduce((a,b)=>a+b,0)/values.length; const variance = values.map(x => (x-mean)**2).reduce((a,b)=>a+b,0)/values.length; return Math.sqrt(variance); }

  // --- Subscriptions and handlers using the managers ---
  function subscribeSymbol(symbol) {
    currentSymbol = symbol;
    initChart();
    // use mainWS for ticks
    mainWS.connect().then(()=> mainWS.subscribeTick(symbol, true));
  }

  function handleTick(tick) {
    if (!tick || !tick.symbol) return; if (currentSymbol && tick.symbol !== currentSymbol) return;
    const quote = Number(tick.quote); const epoch = Number(tick.epoch) || Math.floor(Date.now()/1000);
    const prev = lastPrices[tick.symbol] ?? quote; lastPrices[tick.symbol] = quote; const change = quote - prev; recentChanges.push(change); if (recentChanges.length > 60) recentChanges.shift(); updateCircularGauges();
    if (!areaSeries || !chart) return; const point = { time: epoch, value: quote };
    if (!chartData.length) { chartData.push(point); try { areaSeries.setData(chartData); } catch (e) { try { areaSeries.update(point); } catch(e){} } } else { chartData.push(point); if (chartData.length>600) chartData.shift(); try { areaSeries.update(point); } catch(e){ try{ areaSeries.setData(chartData); } catch(e){} } }
    try { chart.timeScale().fitContent(); } catch (e) {}
    if (automationRunning) { tickHistory.push(quote); if (tickHistory.length > 3) tickHistory.shift(); if (tickHistory.length === 3) { const [p1,p2,p3] = tickHistory; const mean = (p1+p2+p3)/3; Dispersion = ecartType(tickHistory); if (Dispersion !== 0) { const delta = (p3-mean)/Dispersion; const signal = sigmoid(delta); console.log('Signal', signal); } } }
  }

  mainWS.on('tick', (tick) => handleTick(tick));

  // P/L / portfolio via contractsWS
  const activeContractsMap = {};
  contractsWS.on('portfolio', (portfolio) => { const list = (portfolio && portfolio.contracts) || []; list.forEach(c => { if (c && c.contract_id) activeContractsMap[c.contract_id] = c; }); renderActiveContracts(); });
  contractsWS.on('active_positions', (ap) => { const contracts = ap?.contracts || ap?.positions || []; contracts.forEach(c => { if (c && c.contract_id) { const existing = activeContractsMap[c.contract_id] || {}; activeContractsMap[c.contract_id] = { ...existing, ...c }; } }); renderActiveContracts(); });
  contractsWS.on('proposal_open_contract', (poc) => { if (!poc || !poc.contract_id) return; if (poc.is_expired || poc.is_sold) { try { delete activeContractsMap[poc.contract_id]; } catch(e){} } else { const existing = activeContractsMap[poc.contract_id] || {}; activeContractsMap[poc.contract_id] = { ...existing, ...poc }; } renderActiveContracts(); });

  function initTable() { const list = document.getElementById('autoHistoryList'); if (!list) return; list.innerHTML = `\n    <table class="trade-table" id="autoTradeTable">\n      <thead>\n        <tr>\n          <th><input type="checkbox" id="selectAll"></th>\n          <th>Time of Trade</th>\n          <th>Contract ID</th>\n          <th>Contract Type</th>\n          <th>Stake</th>\n          <th>Multiplier</th>\n          <th>Entry Spot</th>\n          <th>TP (%)</th>\n          <th>SL (%)</th>\n          <th>Profit</th>\n          <th>Action</th>\n        </tr>\n      </thead>\n      <tbody id="autoTradeBody"></tbody>\n    </table>\n  `; }

  function updateContractsTable(contracts) { const tbody = document.getElementById('autoTradeBody'); if (!tbody) { initTable(); } const tbodyEl = document.getElementById('autoTradeBody'); if (!tbodyEl) return; tbodyEl.innerHTML = ''; if (!contracts || contracts.length === 0) { tbodyEl.innerHTML = '<tr><td colspan="11" style="color:#94a3b8;">No active contracts</td></tr>'; return; } const safeNumber = (v,f=2) => { const n=Number(v); return (isFinite(n)?n:0).toFixed(f); }; const safeText = v => (v===null||v===undefined)?'-':String(v); contracts.forEach(pos=>{ try{ const tr=document.createElement('tr'); const purchaseEpoch = Number(pos.purchase_time||pos.purchase_epoch||pos.date_start||pos.date||0); const timeStr = purchaseEpoch? new Date(purchaseEpoch*1000).toLocaleTimeString() : '-'; const contractId = safeText(pos.contract_id||pos.contract_id_display||'-'); const contractTypeRaw = safeText(pos.contract_type||pos.contract_type_display||'N/A'); const isBuy = /CALL|BUY|UP|MULTUP/i.test(contractTypeRaw); const buyOrSellClass = isBuy ? 'buy' : 'sell'; const buyPriceRaw = pos.buy_price ?? pos.purchase_price ?? pos.buy_price_raw ?? pos.price ?? pos.buyPrice ?? 0; const buyPrice = safeNumber(buyPriceRaw||0); const multiplier = safeText(pos.multiplier ?? pos.contract_multiplier ?? pos.multiplier_value ?? '-'); const entryRaw = pos.entry_tick ?? pos.entry_spot ?? pos.entry_price ?? pos.entry_tick_price ?? pos.entry ?? pos.entry_spot_price ?? null; const entryTick = (entryRaw!==null && entryRaw!==undefined && entryRaw!=='') ? (typeof entryRaw==='number'?Number(entryRaw).toFixed(2):safeText(entryRaw)) : '-'; const tp = safeText(pos.take_profit ?? pos.tp ?? pos.takeProfit ?? '-'); const sl = safeText(pos.stop_loss ?? pos.sl ?? pos.stopLoss ?? '-'); let profitNum = parseFloat(pos.profit ?? pos.current_spot_profit ?? pos.current_profit ?? pos.profit_local ?? pos.profit_value); if (!isFinite(profitNum)) { const payout = parseFloat(pos.payout ?? pos.profit_payout ?? pos.sell_price ?? NaN); const buy = parseFloat(buyPriceRaw||NaN); if (isFinite(payout) && isFinite(buy)) profitNum = payout - buy; } if (!isFinite(profitNum)) profitNum = 0; const profit = profitNum.toFixed(2); const profitClass = profitNum >= 0 ? 'profit-positive' : 'profit-negative'; tr.innerHTML = `\n      <td><input type="checkbox" class="rowSelect"></td>\n      <td>${timeStr}</td>\n      <td>${contractId}</td>\n      <td class="${buyOrSellClass}">${contractTypeRaw}</td>\n      <td>${buyPrice}</td>\n      <td>${multiplier}</td>\n      <td>${entryTick}</td>\n      <td>${tp}</td>\n      <td>${sl}</td>\n      <td class="${profitClass}">${profit}</td>\n      <td><button class="closeRowBtn" data-contract-id="${contractId}" style="background:#ef4444; border:none; color:white; border-radius:4px; padding:4px 8px; cursor:pointer;">Close</button></td>\n    `; tbodyEl.appendChild(tr); } catch(err){ console.error('Failed to render contract row', err, pos); } }); }

  function renderActiveContracts() { const arr = Object.keys(activeContractsMap).map(k=>activeContractsMap[k]); if (contractsSortMode === 'newest') arr.sort((a,b)=>Number(b.purchase_time||b.date_start||b.date||0)-Number(a.purchase_time||a.date_start||a.date||0)); else if (contractsSortMode==='oldest') arr.sort((a,b)=>Number(a.purchase_time||a.date_start||a.date||0)-Number(b.purchase_time||b.date_start||b.date||0)); else if (contractsSortMode==='profit_desc') arr.sort((a,b)=>Number(b.profit||b.current_profit||b.current_spot_profit||0)-Number(a.profit||a.current_profit||a.current_spot_profit||0)); else if (contractsSortMode==='profit_asc') arr.sort((a,b)=>Number(a.profit||a.current_profit||a.current_spot_profit||0)-Number(b.profit||b.current_profit||b.current_spot_profit||0)); const totalItems = arr.length; const totalPages = Math.max(1, Math.ceil(totalItems / contractsPageSize)); if (contractsCurrentPage > totalPages) contractsCurrentPage = totalPages; const start = (contractsCurrentPage-1)*contractsPageSize; const slice = arr.slice(start, start+contractsPageSize); updateContractsTable(slice); renderContractsPagination(totalItems, totalPages); }

  function renderContractsPagination(totalItems, totalPages) { try { const pageInfo = document.getElementById('contractsPageInfo'); const prevBtn = document.getElementById('contractsPrevBtn'); const nextBtn = document.getElementById('contractsNextBtn'); if (pageInfo) pageInfo.textContent = `Page ${contractsCurrentPage} / ${totalPages} (${totalItems} items)`; if (prevBtn) prevBtn.disabled = contractsCurrentPage <= 1; if (nextBtn) nextBtn.disabled = contractsCurrentPage >= totalPages; } catch(e){} }

  let contractsPageSize = 10; let contractsCurrentPage = 1; let contractsSortMode = 'newest';

  (function setupContractsControls(){ const prevBtn = document.getElementById('contractsPrevBtn'); const nextBtn = document.getElementById('contractsNextBtn'); const pageSizeSel = document.getElementById('contractsPageSize'); const sortSelect = document.getElementById('contractsSortSelect'); const container = document.getElementById('autoHistoryList'); if (prevBtn) prevBtn.addEventListener('click', ()=>{ if (contractsCurrentPage>1){ contractsCurrentPage--; renderActiveContracts(); } }); if (nextBtn) nextBtn.addEventListener('click', ()=>{ contractsCurrentPage++; renderActiveContracts(); }); if (pageSizeSel) pageSizeSel.addEventListener('change',(e)=>{ contractsPageSize = parseInt(e.target.value)||10; contractsCurrentPage=1; renderActiveContracts(); }); if (sortSelect) sortSelect.addEventListener('change',(e)=>{ contractsSortMode = e.target.value || 'newest'; contractsCurrentPage=1; renderActiveContracts(); }); if (container) { container.addEventListener('click', (ev)=>{ const btn = ev.target.closest && ev.target.closest('.closeRowBtn'); if (!btn) return; const cid = btn.getAttribute('data-contract-id'); if (!cid) return; const ok = confirm(`Close contract ${cid} ?`); if (!ok) return; closeContract(cid); }); } function closeContract(contractId) { try { setContractsPanelMessage(`Closing ${contractId}...`, 'warn'); try { if (activeContractsMap[contractId]) delete activeContractsMap[contractId]; } catch(e){} renderActiveContracts(); const sellPayload = { sell: contractId, price: 0 }; if (contractsWS.ws && contractsWS.ws.readyState === WebSocket.OPEN) { try { contractsWS.send(sellPayload); } catch (e) {} return; } if (mainWS.ws && mainWS.ws.readyState === WebSocket.OPEN) { try { mainWS.send(sellPayload); } catch (e) {} return; } const tmp = new WebSocket(WS_URL); tmp.addEventListener('open', ()=>{ try { tmp.send(JSON.stringify({ authorize: TOKEN })); } catch(e){} }); tmp.addEventListener('message', (m)=>{ let data; try{ data = JSON.parse(m.data); } catch(e){ return; } if (data.msg_type === 'authorize' && data.authorize) { try { tmp.send(JSON.stringify(sellPayload)); } catch(e){} setTimeout(()=>{ try{ tmp.close(); } catch(e){} }, 800); } }); } catch(e) { console.error('closeContract error', e); } } })();

  function setContractsPanelMessage(msg, level = 'info') { const panel = document.getElementById('contractsPanel'); if (!panel) return; let el = document.getElementById('contractsPanelMessage'); if (!el) { el = document.createElement('div'); el.id = 'contractsPanelMessage'; el.style.width = '100%'; el.style.boxSizing = 'border-box'; el.style.padding = '8px 12px'; el.style.borderRadius = '6px'; el.style.marginBottom = '8px'; el.style.fontWeight = '600'; panel.insertBefore(el, panel.firstChild); } el.textContent = msg; if (level === 'error') { el.style.background = '#fee2e2'; el.style.color = '#991b1b'; el.style.border = '1px solid #fecaca'; } else if (level === 'warn') { el.style.background = '#fff7ed'; el.style.color = '#92400e'; el.style.border = '1px solid #fcd34d'; } else { el.style.background = '#ecfeff'; el.style.color = '#0f766e'; el.style.border = '1px solid #a7f3d0'; } }

  if (contractsPanelToggle) contractsPanelToggle.addEventListener('click', ()=>{ if (!contractsPanel) return; if (contractsPanel.style.display === 'none' || contractsPanel.style.display === '') { contractsPanel.style.display = 'flex'; contractsPanelToggle.textContent = '📄 Hide Contracts'; initTable(); isSubscribed = true; setContractsPanelMessage('Connecting to Deriv...', 'info'); contractsWS.connect().then(()=>{ contractsWS.subscribePortfolio(); contractsWS.subscribeActivePositions(); }); } else { contractsPanel.style.display = 'none'; contractsPanelToggle.textContent = '📄 Show Contracts'; isSubscribed = false; try { contractsWS.send({ forget_all: 'active_positions' }); } catch(e){} try { for (const k in activeContractsMap) delete activeContractsMap[k]; } catch(e){} renderActiveContracts(); setContractsPanelMessage('', 'info'); } });

  if (connectBtn) connectBtn.addEventListener('click', ()=>{ if (mainWS.ws && mainWS.ws.readyState === WebSocket.OPEN) { mainWS.close(); contractsWS.close(); connectBtn.textContent = 'Se connecter'; accountInfo.textContent = ''; } else { mainWS.connect(); } displaySymbols(); });

  if (buyBtn) buyBtn.onclick = ()=> executeTrade('BUY'); if (sellBtn) sellBtn.onclick = ()=> executeTrade('SELL');

  function executeTrade(type) { const stake = parseFloat(stakeInput?.value) || 1; const multiplier = parseInt(multiplierInput?.value) || 300; const num = type === 'BUY' ? (parseInt(buyNum?.value) || 1) : (parseInt(sellNum?.value) || 1); if (!mainWS.authorized || !currentSymbol) { console.warn('not authorized or no symbol'); return; } const payload = { buy: 1, price: stake.toFixed(2), parameters: { contract_type: type==='BUY' ? 'MULTUP' : 'MULTDOWN', symbol: currentSymbol, currency: 'USD', basis: 'stake', amount: stake.toFixed(2), multiplier } }; for (let i=0;i<num;i++) mainWS.send(payload); }

  function contractentry(onUpdate) { contractsWS.connect(); if (typeof onUpdate === 'function') { contractsWS.on('proposal_open_contract', (poc) => { let total = 0; try { total = Object.values(activeContractsMap).reduce((a,b)=>a+(Number(b.profit)||0),0); } catch(e){} onUpdate(total); }); contractsWS.on('portfolio', (pf) => { try { onUpdate(Object.values(activeContractsMap).reduce((a,b)=>a+(Number(b.profit)||0),0)); } catch(e){} }); } return contractsWS; }

  displaySymbols(); initChart(); initPLGauge();

  function initPLGauge() { const gauge__ = document.getElementById('plGauge'); if (!gauge__) return; updatePLGauge(0); }

  const toggleAutomationBtn = document.getElementById('toggleAutomation'); if (toggleAutomationBtn) toggleAutomationBtn.addEventListener('click', ()=>{ if (!automationRunning) { toggleAutomationBtn.textContent = 'Stop Automation'; toggleAutomationBtn.style.background = 'linear-gradient(90deg,#f44336,#e57373)'; automationRunning = true; mainWS.connect().then(()=> mainWS.subscribeTick(currentSymbol, true)); } else { toggleAutomationBtn.textContent = 'Launch Automation'; toggleAutomationBtn.style.background = 'linear-gradient(90deg,#4caf50,#81c784)'; automationRunning = false; try{ mainWS.subscribeTick(null,false) }catch(e){} } });

  mainWS.on('authorize', (auth) => { if (!auth) return; connectBtn.textContent = 'Disconnect'; accountInfo.textContent = `Account: ${auth.loginid} | Balance: ${Number(auth.balance).toFixed(2)} ${auth.currency||''}`; mainWS.authorized = true; });
  contractsWS.on('authorize', (auth) => { if (!auth) return; contractsWS.authorized = true; setContractsPanelMessage(`Authorized: ${auth.loginid}`, 'info'); });

  mainWS.on('tick', (t)=> handleTick(t));

  window.addEventListener('resize', ()=>{ try{ positionGauges(); if (chart) chart.resize(chartInner.clientWidth, chartInner.clientHeight); } catch(e){} });

  function setContractsPanelMessage(msg, level = 'info') { const panel = document.getElementById('contractsPanel'); if (!panel) return; let el = document.getElementById('contractsPanelMessage'); if (!el) { el = document.createElement('div'); el.id = 'contractsPanelMessage'; el.style.width = '100%'; el.style.boxSizing = 'border-box'; el.style.padding = '8px 12px'; el.style.borderRadius = '6px'; el.style.marginBottom = '8px'; el.style.fontWeight = '600'; panel.insertBefore(el, panel.firstChild); } el.textContent = msg; if (level === 'error') { el.style.background = '#fee2e2'; el.style.color = '#991b1b'; el.style.border = '1px solid #fecaca'; } else if (level === 'warn') { el.style.background = '#fff7ed'; el.style.color = '#92400e'; el.style.border = '1px solid #fcd34d'; } else { el.style.background = '#ecfeff'; el.style.color = '#0f766e'; el.style.border = '1px solid #a7f3d0'; } }
document.addEventListener("DOMContentLoaded", () => {
  const APP_ID = 105747;
  const TOKEN = "wgf8TFDsJ8Ecvze";
  const WS_URL = `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;

// WebSocket Event Emitter
class EventEmitter {
  constructor() {
    this.listeners = new Map();
  }
  
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);
    return this;
  }
  
  off(event, callback) {
    this.listeners.get(event)?.delete(callback);
    return this;
  }
  
  emit(event, ...args) {
    this.listeners.get(event)?.forEach(cb => {
      try { 
        cb(...args);
      } catch (e) {
        console.error(`Event listener error for ${event}:`, e);
      }
    });
    return this;
  }
}

// WebSocket Manager
class WSManager extends EventEmitter {
  constructor() {
    super();
    this.mainWS = null;
    this.authorized = false;
    this.connecting = false;
    this.pendingSubscribes = new Set();
  }

  async connect() {
    if (this.mainWS?.readyState === WebSocket.OPEN) return this.mainWS;
    if (this.connecting) return new Promise((r) => this.once('connected', r));
    
    this.connecting = true;
    
    try {
      if (this.mainWS) await this.disconnect();
      
      this.mainWS = new WebSocket(WS_URL);
      
      await new Promise((resolve, reject) => {
        this.mainWS.onopen = () => {
          console.log("WebSocket opened - sending authorize");
          this.mainWS.send(JSON.stringify({ authorize: TOKEN }));
        };
        
        this.mainWS.onmessage = (msg) => {
          const data = JSON.parse(msg.data);
          console.log("WebSocket message:", data);
          
          if (data.authorize) {
            this.authorized = true;
            this.emit('authorized', data.authorize);
            resolve(this.mainWS);
            this.pendingSubscribes.forEach(s => this.subscribe(s));
            this.pendingSubscribes.clear();
          } else if (data.tick) {
            this.emit('tick', data.tick);
          }
        };
        
        this.mainWS.onclose = () => {
          console.log("WebSocket closed");
          this.authorized = false;
          this.emit('disconnected');
          reject(new Error('Connection closed'));
        };
        
        this.mainWS.onerror = (err) => {
          console.error("WebSocket error:", err);
          this.authorized = false;
          this.emit('error', err);
          reject(err);
        };
      });
      
      this.emit('connected', this.mainWS);
      return this.mainWS;
      
    } catch (err) {
      this.emit('error', err);
      throw err;
    } finally {
      this.connecting = false;
    }
  }
  
  async disconnect() {
    if (!this.mainWS) return;
    
    return new Promise(resolve => {
      this.mainWS.onclose = () => {
        this.mainWS = null;
        this.authorized = false;
        this.emit('disconnected');
        resolve();
      };
      this.mainWS.close();
    });
  }

  subscribe(symbol) {
    if (!this.mainWS || !this.authorized) {
      this.pendingSubscribes.add(symbol);
      this.connect();
      return;
    }
    
    try {
      // Unsubscribe from previous ticks first
      this.mainWS.send(JSON.stringify({ forget_all: "ticks" }));
      
      // Subscribe to new symbol
      this.mainWS.send(JSON.stringify({ 
        ticks: symbol,
        subscribe: 1
      }));
      
      this.emit('subscribed', symbol);
      
    } catch (e) {
      console.error('Subscribe failed:', e);
      this.pendingSubscribes.add(symbol);
      this.emit('error', e);
    }
  }
  
  send(data) {
    if (!this.mainWS || this.mainWS.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }
    this.mainWS.send(JSON.stringify(data));
  }
}

// Create singleton instance
const deriv = new WSManager();

// Trading symbols
const SYMBOLS = [
  { symbol: "BOOM1000", name: "Boom 1000" },
  { symbol: "CRASH1000", name: "Crash 1000" },
  { symbol: "BOOM500", name: "Boom 500" },
  { symbol: "CRASH500", name: "Crash 500" },
  { symbol: "BOOM900", name: "Boom 900" },
  { symbol: "CRASH900", name: "Crash 900" },
  { symbol: "BOOM600", name: "Boom 600" },
  { symbol: "CRASH600", name: "Crash 600" },
  { symbol: "R_100", name: "VIX 100" },
  { symbol: "R_75", name: "VIX 75" },
  { symbol: "R_50", name: "VIX 50" },
  { symbol: "R_25", name: "VIX 25" },
  { symbol: "R_10", name: "VIX 10" }
];

// Initialize UI Elements
function initUI() {
  const ui = {
    connectBtn: document.getElementById("connectBtn"),
    symbolList: document.getElementById("symbolList"),
    chartInner: document.getElementById("chartInner"),
    controlPanel: document.getElementById("controlFormPanel"),
    controlPanelToggle: document.getElementById("controlPanelToggle"),
    buyBtn: document.getElementById("buyBtn"),
    sellBtn: document.getElementById("sellBtn"),
    stakeInput: document.getElementById("stakeInput"),
    multiplierInput: document.getElementById("multiplierSelect"),
    buyNum: document.getElementById("buyNumberInput"),
    sellNum: document.getElementById("sellNumberInput")
  };

  // Verify required elements
  const required = ['connectBtn', 'symbolList', 'chartInner'];
  const missing = required.filter(id => !ui[id]);
  if (missing.length > 0) {
    throw new Error(`Missing required elements: ${missing.join(', ')}`);
  }

  return ui;
}

// Display Trading Symbols
function displaySymbols() {
  const symbolList = document.getElementById("symbolList");
  if (!symbolList) return;
  
  symbolList.innerHTML = "";
  SYMBOLS.forEach(s => {
    const el = document.createElement("div");
    el.className = "symbol-item";
    el.textContent = s.name;
    el.dataset.symbol = s.symbol;
    el.addEventListener("click", () => selectSymbol(s.symbol, el));
    symbolList.appendChild(el);
  });
}

  });
  
  // Add active class to selected symbol
  if (element) {
    element.classList.add('active');
    element.style.background = '#007bff';
    element.style.color = '#fff';
  }
  
  // Subscribe to symbol
  deriv.subscribe(symbol);
}

// Initialize Chart
function initChart(container) {
  const chart = LightweightCharts.createChart(container, {
    layout: { 
      textColor: "#333",
      background: { type: "solid", color: "#fff" }
    },
    timeScale: { 
      timeVisible: true,
      secondsVisible: true
    }
  });

  const areaSeries = chart.addAreaSeries({
    lineColor: "#2962FF",
    topColor: "rgba(41,98,255,0.28)",
    bottomColor: "rgba(41,98,255,0.05)",
    lineWidth: 2
  });

  return { chart, areaSeries };
}

// Initialize Application
document.addEventListener("DOMContentLoaded", async () => {
  console.log("Starting Unicorn Deriv Trader...");
  
  try {
    // Initialize UI
    const ui = initUI();
    console.log("UI elements initialized");

    // Display symbols
    displaySymbols();
    console.log("Trading symbols displayed");

    // Initialize chart
    const { chart, areaSeries } = initChart(ui.chartInner);
    console.log("Chart initialized");

    // Initialize control panel state
    if (ui.controlPanel) {
      ui.controlPanel.style.display = "none";
    }

    // Setup control panel toggle
    if (ui.controlPanelToggle && ui.controlPanel) {
      ui.controlPanelToggle.addEventListener("click", () => {
        const isVisible = ui.controlPanel.style.display === "flex";
        
        if (isVisible) {
          ui.controlPanel.classList.remove("active");
          setTimeout(() => {
            ui.controlPanel.style.display = "none";
          }, 320);
          ui.controlPanelToggle.textContent = "⚙️ Show Controls";
        } else {
          ui.controlPanel.style.display = "flex";
          setTimeout(() => {
            ui.controlPanel.classList.add("active");
          }, 10);
          ui.controlPanelToggle.textContent = "⚙️ Hide Controls";
        }
      });
    }

    // Setup WebSocket connection button
    ui.connectBtn.addEventListener("click", async () => {
      try {
        ui.connectBtn.disabled = true;
        ui.connectBtn.textContent = "Connecting...";
        
        await deriv.connect();
        
      } catch (err) {
        console.error("Connection failed:", err);
        ui.connectBtn.textContent = "Connection Failed";
        ui.connectBtn.style.background = "#f44336";
      } finally {
        ui.connectBtn.disabled = false;
      }
    });

    // Handle WebSocket events
    deriv.on('authorized', () => {
      ui.connectBtn.textContent = "Connected";
      ui.connectBtn.style.background = "#4caf50";
    });

    deriv.on('disconnected', () => {
      ui.connectBtn.textContent = "Disconnected";
      ui.connectBtn.style.background = "#f44336";
    });

    deriv.on('error', (err) => {
      console.error("Connection error:", err);
      ui.connectBtn.textContent = "Connection Failed";
      ui.connectBtn.style.background = "#f44336";
    });

    // Handle incoming ticks
    deriv.on('tick', (tick) => {
      if (!tick || !tick.symbol) return;
      
      const quote = Number(tick.quote);
      const epoch = Number(tick.epoch);
      
      // Update chart
      if (areaSeries) {
        areaSeries.update({ 
          time: epoch,
          value: quote 
        });
      }
    });

    // Setup trading buttons
    if (ui.buyBtn) {
      ui.buyBtn.onclick = () => {
        const stake = parseFloat(ui.stakeInput?.value) || 1;
        const multiplier = parseInt(ui.multiplierInput?.value) || 300;
        const numTrades = parseInt(ui.buyNum?.value) || 1;

        for (let i = 0; i < numTrades; i++) {
          deriv.send({
            buy: 1,
            price: stake,
            parameters: {
              contract_type: "MULTUP",
              currency: "USD",
              multiplier: multiplier,
              basis: "stake",
              amount: stake
            }
          });
        }
      };
    }

    if (ui.sellBtn) {
      ui.sellBtn.onclick = () => {
        const stake = parseFloat(ui.stakeInput?.value) || 1;
        const multiplier = parseInt(ui.multiplierInput?.value) || 300;
        const numTrades = parseInt(ui.sellNum?.value) || 1;

        for (let i = 0; i < numTrades; i++) {
          deriv.send({
            buy: 1,
            price: stake,
            parameters: {
              contract_type: "MULTDOWN",
              currency: "USD",
              multiplier: multiplier,
              basis: "stake",
              amount: stake
            }
          });
        }
      };
    }

    console.log("Application initialized successfully");
  } catch (err) {
    console.error("Fatal error:", err);
    alert("Failed to start the application. Please refresh and try again.");
  }
});

})();