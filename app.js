(function(){
  'use strict';

  // Cleaned single-file app.js
  // - One DOMContentLoaded
  // - One WebSocketManager (robust)
  // - Subscriptions: ticks (mainWS), portfolio/active_positions/proposal_open_contract (contractsWS)
  // - UI wiring: symbol list, chart placeholder, buy/sell, contracts panel

  const APP_ID = 105747;
  const TOKEN = 'wgf8TFDsJ8Ecvze';
  const WS_URL = `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;

  function safeCall(cb, ...args){ try{ cb(...args); } catch(e){ console.error('handler error', e); } }

  class WebSocketManager {
    constructor(url, name='ws'){
      this.url = url; this.name = name; this.ws = null; this.handlers = new Map();
      this.reconnectAttempts = 0; this.maxReconnectAttempts = 10; this.reconnectBaseDelay = 1000;
      this.authorized = false; this._outgoingQueue = []; this._connecting = false;
    }
    connect(){
      if(this.ws && this.ws.readyState===WebSocket.OPEN) return Promise.resolve(this.ws);
      if(this._connecting) return Promise.resolve(this.ws);
      this._connecting = true;
      return new Promise((resolve,reject)=>{
        try{
          this.ws = new WebSocket(this.url);
          this.ws.onopen = ()=>{ this._log('open'); this.reconnectAttempts=0; this._connecting=false; this.send({ authorize: TOKEN }, true); while(this._outgoingQueue.length) this._rawSend(this._outgoingQueue.shift()); resolve(this.ws); };
          this.ws.onmessage = (evt)=>{ let d; try{ d = JSON.parse(evt.data); }catch(e){ this._log('parse',e); return; } this._handleMessage(d); };
          this.ws.onclose = ()=>{ this._log('closed'); this.authorized=false; this._scheduleReconnect(); };
          this.ws.onerror = (err)=>{ this._log('error',err); };
        }catch(err){ this._connecting=false; reject(err); }
      });
    }
    close(){ try{ this.ws?.close(); }catch(e){} this.ws=null; this.authorized=false; }
    _scheduleReconnect(){ if(this.reconnectAttempts>=this.maxReconnectAttempts) return; this.reconnectAttempts++; const delay=this.reconnectBaseDelay*this.reconnectAttempts; this._log('reconnect in',delay); setTimeout(()=>{ try{ this.connect(); }catch(e){} }, delay); }
    on(type,cb){ if(!this.handlers.has(type)) this.handlers.set(type,new Set()); this.handlers.get(type).add(cb); }
    off(type,cb){ this.handlers.get(type)?.delete(cb); }
    _emit(type,payload){ const s=this.handlers.get(type); if(s) s.forEach(cb=>safeCall(cb,payload)); const any=this.handlers.get('message'); if(any) any.forEach(cb=>safeCall(cb,payload)); }
    _handleMessage(data){ if(data.msg_type==='authorize' || data.authorize){ this.authorized = Boolean(data.authorize); this._emit('authorize', data); return; } const type = data.msg_type || Object.keys(data)[0]; if(type && this.handlers.has(type)) this.handlers.get(type).forEach(cb=>safeCall(cb,data)); else this._emit('message', data); }
    _rawSend(o){ try{ this.ws.send(JSON.stringify(o)); }catch(e){ this._log('rawSend',e);} }
    send(o, immediate=false){ if(!this.ws || this.ws.readyState!==WebSocket.OPEN){ if(immediate) this.connect().then(()=>this._rawSend(o)).catch(e=>this._log('sendfail',e)); else { this._outgoingQueue.push(o); this.connect().catch(e=>this._log('connectfailed',e)); } return; } this._rawSend(o); }
    _log(...a){ console.debug(`[${this.name}]`,...a); }
  }

  // Global state
  window.pendingSubscribe = null;

  // Managers
  const mainWS = new WebSocketManager(WS_URL,'main');
  const contractsWS = new WebSocketManager(WS_URL,'contracts');

  // UI refs
  let ui = {
    connectBtn: null, symbolList: null, chartInner: null,
    buyBtn: null, sellBtn: null,toggleAutomation: null, stakeInput: null, multiplierSelect: null,
    accountInfo: null, autoHistoryList: null, contractsPanel: null, contractsPanelToggle: null,
    volGauge: null, trendGauge: null, probGauge: null, plGauge: null,
    buyNum: null, sellNum: null, controlPanel: null, controlPanelToggle: null
  };

  const SYMBOLS = [ 'BOOM1000','CRASH1000','BOOM500','CRASH500','BOOM900','CRASH900','BOOM600','CRASH600','R_100','R_75','R_50','R_25','R_10' ];

  let currentSymbol = null; let recentChanges = []; let activeContractsMap = {}; let chart = null, areaSeries = null, chartData = [], lastPrices = {};
  let latestPLAmount = 0;

  function bindUI(){ 
    ui.connectBtn = document.getElementById('connectBtn'); 
    ui.symbolList = document.getElementById('symbolList'); 
    ui.chartInner = document.getElementById('chartInner'); 
    ui.buyBtn = document.getElementById('buyBtn'); 
    ui.sellBtn = document.getElementById('sellBtn'); 
    ui.stakeInput = document.getElementById('stakeInput'); 
    ui.multiplierSelect = document.getElementById('multiplierSelect'); 
    ui.accountInfo = document.getElementById('accountInfo'); 
    ui.autoHistoryList = document.getElementById('autoHistoryList'); 
    ui.contractsPanel = document.getElementById('contractsPanel'); 
    ui.contractsPanelToggle = document.getElementById('contractsPanelToggle'); 
    ui.volGauge = document.getElementById('volGauge'); 
    ui.trendGauge = document.getElementById('trendGauge'); 
    ui.probGauge = document.getElementById('probGauge'); 
    ui.plGauge = document.getElementById('plGauge');
    ui.buyNum = document.getElementById('buyNumberInput');
    ui.sellNum = document.getElementById('sellNumberInput');
    ui.controlPanel = document.getElementById('controlFormPanel');
    ui.controlPanelToggle = document.getElementById('controlPanelToggle');
    ui.toggleAutomation = document.getElementById('toggleAutomation');
    // support both older IDs (closeAll / closeWinning) and newer ones (closeAllBtn / closeWinningBtn)
    ui.closeAllBtn = document.getElementById('closeAllBtn') || document.getElementById('closeAll');
    ui.closeWinningBtn = document.getElementById('closeWinningBtn') || document.getElementById('closeWinning');
  }

  function displaySymbols(){ if(!ui.symbolList) return; ui.symbolList.innerHTML=''; SYMBOLS.forEach(s=>{ const el=document.createElement('div'); el.className='symbol-item'; el.textContent=s; el.dataset.symbol=s; el.addEventListener('click', ()=>{ document.querySelectorAll('.symbol-item').forEach(i=>i.classList.remove('active')); el.classList.add('active'); subscribeSymbol(s); }); ui.symbolList.appendChild(el); }); }

  function initChart(){ 
    if(!ui.chartInner) return; 
    try{ if(chart){ chart.remove(); } }catch(e){}
    ui.chartInner.innerHTML='';
    if(window.LightweightCharts){
      chart = LightweightCharts.createChart(ui.chartInner,{ 
        layout: { 
          textColor: '#333',
          backgroundColor: '#ffffff'
        }, 
        timeScale: { 
          timeVisible: true, 
          secondsVisible: true,
          fixLeftEdge: true,
          fixRightEdge: true,
          barSpacing: 5
        },
        width: ui.chartInner.clientWidth,
        height: ui.chartInner.clientHeight
      });
      
      areaSeries = chart.addAreaSeries({ 
        lineColor: '#2962FF',
        topColor: 'rgba(41,98,255,0.28)',
        bottomColor: 'rgba(41,98,255,0.05)',
        lineWidth: 2,
        priceLineVisible: true,
        lastValueVisible: true
      });

      try {
        chart.applyOptions({ 
          priceScale: { 
            scaleMargins: { top: 0.4, bottom: 0.4 },
            alignLabels: true,
            borderVisible: false,
            autoScale: true,
            mode: 2, // Logarithmic
            invertScale: false
          },
          layout: {
            backgroundColor: '#ffffff',
            textColor: '#333333'
          },
          grid: {
            vertLines: { visible: true },
            horzLines: { visible: true }
          },
          crosshair: {
            vertLine: { visible: false },
            horzLine: { visible: false }
          }
        });

        // Initialiser avec une fenêtre fixe de 2 ticks
        chartData = [];
        const now = Math.floor(Date.now() / 1000);
        chart.timeScale().setVisibleRange({
          from: now - 10,
          to: now + 10
        });

      }catch(e){ console.log('applyOptions priceScale failed', e); }
    } else {
      ui.chartInner.innerHTML = '<div style="padding:8px;color:#94a3b8">LightweightCharts not loaded</div>';
    }
  }

  function subscribeSymbol(symbol){ 
    initChart();
    
    if(mainWS.authorized && mainWS.ws?.readyState === WebSocket.OPEN) {
      currentSymbol = symbol;
      mainWS.send({ forget_all: 'ticks' }); 
      mainWS.send({ ticks: symbol, subscribe: 1 });
      
      // Afficher les gauges si on est connecté
      if(document.getElementById('gauges')) {
        document.getElementById('gauges').style.display = 'flex';
      }
    } else {
      // Save the symbol for subscribing after authorization
      window.pendingSubscribe = symbol;
      if(!mainWS.ws || mainWS.ws.readyState !== WebSocket.OPEN) {
        mainWS.connect();
      }
    }
  }

  function handleTick(msg){ 
    const tick = msg.tick || msg; 
    if(!tick || !tick.symbol) return; 
    if(currentSymbol && tick.symbol!==currentSymbol) return; 

    const quote = Number(tick.quote); 
    const epoch = Number(tick.epoch) || Math.floor(Date.now()/1000); 

    if(areaSeries){ 
      try{ 
        // Ajouter le nouveau tick
        chartData.push({ time: epoch, value: quote });
        
        // Garder seulement les 100 derniers ticks
        if(chartData.length > 100) {
          chartData.shift();
        }

        // Mettre à jour la série complète
        areaSeries.setData(chartData);

        // Centrer sur les 2 derniers ticks si nous avons au moins 2 points
        if(chartData.length >= 2) {
          const lastTwo = chartData.slice(-2);
          const middleTime = Math.floor((lastTwo[0].time + lastTwo[1].time) / 2);
          chart.timeScale().setVisibleRange({
            from: middleTime - 5,
            to: middleTime + 5
          });
        }
      }catch(e){ console.warn('Chart update failed:', e); } 
    } 

    const prev = (lastPrices[tick.symbol] ?? quote); 
    lastPrices[tick.symbol] = quote; 
    const change = quote - prev; 
    recentChanges.push(change); 
    if(recentChanges.length>60) recentChanges.shift(); 

    // Force une mise à jour des infos de balance
    if(mainWS.authorized) {
      mainWS.send({ balance: 1 }, true);
      mainWS.send({ portfolio: 1 }, true);
    }

    updateGauges(); 
  }

  function updateGauges(){ 
    if(!ui) return; 
    
    // Calculate volatility with exponential weighting
    const mean = recentChanges.reduce((a,b,i)=>a + b * Math.exp(i/recentChanges.length), 0) / 
                recentChanges.reduce((a,i)=>a + Math.exp(i/recentChanges.length), 0);
    const variance = recentChanges.reduce((a,b,i)=>a + Math.pow(b-mean,2) * Math.exp(i/recentChanges.length), 0) / 
                    recentChanges.reduce((a,i)=>a + Math.exp(i/recentChanges.length), 0);
    const stdDev = Math.sqrt(variance);
    const vol = Math.min(100, (stdDev/0.05)*100);
    
    // Calculate trend with momentum
    const weightedSum = recentChanges.reduce((a,b,i)=>a + b * (i+1), 0);
    const momentum = weightedSum / ((recentChanges.length * (recentChanges.length + 1)) / 2);
    const trend = Math.min(100, Math.abs(momentum) * 2000);
    
    // Calculate probability with recent bias
    const recentWindow = recentChanges.slice(-15);
    const weightedUp = recentWindow.reduce((sum,change,i) => {
      const weight = Math.exp(i/recentWindow.length);
      return sum + (change > 0 ? weight : 0);
    }, 0);
    const totalWeight = recentWindow.reduce((sum,_,i) => sum + Math.exp(i/recentWindow.length), 0);
    const prob = Math.min(100, (weightedUp / totalWeight) * 100);
    
    // Calculate P/L with active contracts only
    const contracts = Object.values(activeContractsMap).filter(c => !c.is_sold && !c.is_expired);
    let totalProfit = 0;
    
    if(contracts.length > 0) {
      totalProfit = contracts.reduce((sum, c) => {
        // Try multiple profit fields
        let profit = 0;
        if('profit' in c && !isNaN(Number(c.profit))) {
          profit = Number(c.profit);
        } else if('current_spot_profit' in c && !isNaN(Number(c.current_spot_profit))) {
          profit = Number(c.current_spot_profit);
        } else if(c.buy_price && c.current_spot && c.entry_spot) {
          // Calculate manual P/L if needed
          const direction = c.contract_type.includes('UP') ? 1 : -1;
          const movement = direction * (c.current_spot - c.entry_spot);
          profit = movement * Number(c.buy_price);
        }
        return sum + profit;
      }, 0);
    }
    
    latestPLAmount = totalProfit;
    let plValue;
    
    if(totalProfit === 0) {
      plValue = 50; // Neutral position
    } else {
      // Non-linear scaling for better visualization
      plValue = 50 + (Math.sign(totalProfit) * Math.min(50, Math.sqrt(Math.abs(totalProfit)) * 10));
    }
    
    // Update gauges with smooth transitions
    drawGauge(ui.volGauge, vol, 'vol');
    drawGauge(ui.trendGauge, trend, 'trend');
    drawGauge(ui.probGauge, prob, 'prob');
    drawGauge(ui.plGauge, plValue, 'pl');
    
    // Debug logging
    console.debug('Gauge Updates:', {
      volatility: vol.toFixed(2),
      trend: trend.toFixed(2),
      probability: prob.toFixed(2),
      totalProfit: totalProfit.toFixed(2),
      plValue: plValue.toFixed(2)
    });
  }
    function drawGauge(el, v, type='vol'){ 
    if(!el) return; 
      // Ensure placeholder has explicit square dimensions to avoid oval shapes
      el.style.width = '130px';
      el.style.height = '130px';
      el.style.display = 'inline-block';
      el.style.boxSizing = 'border-box';
      el.innerHTML = '';
    
    // Ensure gauge container exists
    if (!document.getElementById('gaugesContainer')) {
      const container = styleGaugesContainer();
      document.body.appendChild(container);
      // Move gauges to container
      ['volGauge', 'trendGauge', 'probGauge', 'plGauge'].forEach(id => {
        const gauge = document.getElementById(id);
        if (gauge) container.appendChild(gauge);
      });
    }
    
    // Container
    const container = document.createElement('div');
    container.style.width = '130px';
    container.style.height = '130px';
    container.style.position = 'relative';
    container.style.display = 'flex';
    container.style.alignItems = 'center';
    container.style.justifyContent = 'center';
    container.style.left = '0';
    
    // Background ring (static)
    const bgRing = document.createElement('div');
    bgRing.style.width = '100%';
    bgRing.style.height = '100%';
    bgRing.style.borderRadius = '50%';
    bgRing.style.position = 'absolute';
    bgRing.style.background = '#f5f5f5';
    bgRing.style.boxShadow = 'inset 0 0 10px rgba(0,0,0,0.1)';
    
    // Progress ring (animated)
    const progressRing = document.createElement('div');
    progressRing.style.width = '100%';
    progressRing.style.height = '100%';
    progressRing.style.borderRadius = '50%';
    progressRing.style.position = 'absolute';
    progressRing.style.background = `conic-gradient(
      ${getGaugeColor(v)} ${v}%, 
      transparent ${v}% 100%
    )`;
    progressRing.style.transition = 'all 0.5s ease-out';
    progressRing.style.transform = 'rotate(-90deg)';
    
    // Outer ring border
    const borderRing = document.createElement('div');
    borderRing.style.width = '92%';
    borderRing.style.height = '92%';
    borderRing.style.borderRadius = '50%';
    borderRing.style.position = 'absolute';
  borderRing.style.border = '4px solid #e0e0e0';
  borderRing.style.boxShadow = '0 6px 18px rgba(32,33,36,0.08)';
    
    // Inner circle
    const inner = document.createElement('div');
    inner.style.width = '75%';
    inner.style.height = '75%';
    inner.style.borderRadius = '50%';
    inner.style.background = '#ffffff';
    inner.style.position = 'absolute';
    inner.style.display = 'flex';
    inner.style.alignItems = 'center';
    inner.style.justifyContent = 'center';
    inner.style.flexDirection = 'column';
    inner.style.boxShadow = 'inset 0 0 15px rgba(0,0,0,0.1)';
    
    // Value display
    const value = document.createElement('div');
    value.style.color = getGaugeColor(v);
    value.style.fontSize = '20px';
    value.style.fontWeight = '700';
    value.style.marginBottom = '2px';
    value.style.textShadow = '0 2px 4px rgba(0,0,0,0.03)';
    
    // For P/L gauge show currency amount, otherwise percent
    if(type === 'pl'){
      const amt = typeof latestPLAmount === 'number' ? latestPLAmount : 0;
      const sign = amt >= 0 ? '+' : '-'; // Ajout du + pour les profits
      value.textContent = `${sign}$${Math.abs(amt).toFixed(2)}`;
      value.style.color = amt >= 0 ? '#16a34a' : '#dc2626'; // Vert pour profit, rouge pour perte
    } else {
      value.textContent = Math.round(v) + '%';
    }
    
    // Label
    const label = document.createElement('div');
    label.style.color = '#888';
    label.style.fontSize = '12px';
    label.style.fontWeight = '500';
    label.style.textTransform = 'uppercase';
    label.style.letterSpacing = '1px';
    label.textContent = getGaugeLabel(type);
    
    // Progress dots
    const dotsContainer = document.createElement('div');
    dotsContainer.style.position = 'absolute';
    dotsContainer.style.width = '100%';
    dotsContainer.style.height = '100%';
    
    // Add progress dots
    const numDots = 24;
    for(let i = 0; i < numDots; i++) {
      const dot = document.createElement('div');
      const angle = (i * 360 / numDots) - 90; // Start from top
      const radius = 58; // Slightly smaller than ring
      const x = radius * Math.cos(angle * Math.PI / 180);
      const y = radius * Math.sin(angle * Math.PI / 180);
      
      dot.style.position = 'absolute';
      dot.style.width = '4px';
      dot.style.height = '4px';
      dot.style.borderRadius = '50%';
      dot.style.backgroundColor = i * (360 / numDots) <= v ? getGaugeColor(v) : '#e0e0e0';
      dot.style.left = `calc(50% + ${x}px - 2px)`;
      dot.style.top = `calc(50% + ${y}px - 2px)`;
      dot.style.transition = 'background-color 0.3s ease';
      
      dotsContainer.appendChild(dot);
    }
    
    // Assemble
    inner.appendChild(value);
    inner.appendChild(label);
    container.appendChild(bgRing);
    container.appendChild(progressRing);
    container.appendChild(dotsContainer);
    container.appendChild(borderRing);
    container.appendChild(inner);
    el.appendChild(container);
  }
  
    function getGaugeColor(value) {
    if (value < 30) return '#81c784';      // vert clair
    if (value < 70) return '#ffb74d';      // orange clair
    return '#e57373';                      // rouge clair
  }
  
  function getGaugeLabel(type) {
    switch(type) {
      case 'vol': return 'VOLATILITY';
      case 'trend': return 'TREND';
      case 'prob': return 'PROBABILITY';
      case 'pl': return 'P/L LIVE';
      default: return '';
    }
  }

  // Nouvelle fonction de mise à jour du gauge P/L
  function updatePLGauge(plValue) {
    if(!ui?.plGauge) return;
    
    // Mise à jour de la valeur globale
    latestPLAmount = plValue;

    // Couleur dynamique selon profit/perte
    const color = plValue >= 0 ? "#4caf50" : "#f44336";
    const deg = Math.min(360, Math.abs(plValue) * 3.6); // 100 = 360°

    // Mettre à jour l'apparence du gauge
    const gauge = ui.plGauge;
    const inner = gauge.querySelector('div:last-child');
    if(inner) {
      const value = inner.querySelector('div:first-child');
      if(value) {
        value.textContent = `${plValue >= 0 ? "+" : ""}${plValue.toFixed(2)}$`;
        value.style.color = color;
      }
    }

    // Mettre à jour le background pour l'indicateur circulaire
    const progressRing = gauge.querySelector('div:nth-child(2)');
    if(progressRing) {
      progressRing.style.background = `conic-gradient(${color} ${deg}deg, #ddd ${deg}deg)`;
    }
  }  function styleGaugesContainer() {
    const container = document.createElement('div');
    container.id = 'gaugesContainer';
    container.style.position = 'fixed';
    container.style.left = '20px';
    container.style.top = '50%';
    container.style.transform = 'translateY(-50%)';
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.gap = '20px';
    container.style.zIndex = '1000';
    return container;
  }

  // Utility: recursively search object for the first numeric value for a set of possible keys
  function findFirstNumericByKeys(obj, keys){
    if(obj == null) return null;
    if(typeof obj !== 'object') return null;
    for(const k of keys){ if(k in obj && obj[k] != null && !isNaN(Number(obj[k]))) return Number(obj[k]); }
    for(const v of Object.values(obj)){
      if(typeof v === 'object'){
        const r = findFirstNumericByKeys(v, keys);
        if(r !== null) return r;
      }
    }
    return null;
  }

  // Utility: recursively scan object to find any nested objects that look like contracts (have contract_id)
  function scanForContracts(obj){
    if(!obj || typeof obj !== 'object') return [];
    const found = [];
    function walk(o){
      if(!o || typeof o !== 'object') return;
      if('contract_id' in o && o.contract_id) { found.push(o); }
      for(const v of Object.values(o)){
        if(typeof v === 'object') walk(v);
      }
    }
    walk(obj);
    return found;
  }

  // Try to extract balance/currency info from contract-related WS messages and update accountInfo
  function updateAccountInfoFromContracts(data){
    if(!ui || !ui.accountInfo) return;
    try{
      // try multiple keys and nested locations with logging
      console.debug('Account update data:', data);
      
      const bal = findFirstNumericByKeys(data, ['balance','account_balance','balance_raw','equity','funds','available']);
      console.debug('Found balance:', bal);
      
      const cur = (function(){
        if(data?.portfolio?.currency) return data.portfolio.currency;
        if(data?.currency) return data.currency;
        if(data?.portfolio && typeof data.portfolio === 'object' && data.portfolio.currency) return data.portfolio.currency;
        // Récupérer la devise depuis le message authorize si disponible
        if(mainWS.authorized && mainWS._lastAuth?.currency) return mainWS._lastAuth.currency;
        return 'USD'; // Fallback to USD
      })();
      
      if(bal !== null && bal !== undefined){
        const existing = (ui.accountInfo.textContent||'').trim();
        const parts = existing.split('|').map(p=>p.trim());
        const possibleLogin = parts.length>1 ? parts[0] : (parts[0] && !parts[0].toLowerCase().startsWith('balance') ? parts[0] : '');
        const newText = possibleLogin ? `${possibleLogin} | Balance: ${Number(bal).toFixed(2)} ${cur}` : `Balance: ${Number(bal).toFixed(2)} ${cur}`;
        
        // Ne mettre à jour que si la valeur a changé
        if(ui.accountInfo.textContent !== newText) {
          ui.accountInfo.textContent = newText;
          console.debug('Balance updated:', newText);
        }
      }

      // Forcer une mise à jour du P/L si on a des contrats actifs
      const contracts = Object.values(activeContractsMap).filter(c => !c.is_sold && !c.is_expired);
      if(contracts.length > 0) {
        updateGauges();
      }

    }catch(e){ console.warn('updateAccountInfoFromContracts failed', e); }
  }

  // Contracts handlers
  contractsWS.on('portfolio', data=>{ const list = data.portfolio?.contracts || data.contracts || []; list.forEach(c=>{ if(c?.contract_id) activeContractsMap[c.contract_id]=c; }); renderActiveContracts(); updateGauges(); updateAccountInfoFromContracts(data); });
  contractsWS.on('active_positions', data=>{ const list = data.active_positions?.positions || data.positions || data.contracts || []; list.forEach(c=>{ if(c?.contract_id) activeContractsMap[c.contract_id]=Object.assign({}, activeContractsMap[c.contract_id]||{}, c); }); renderActiveContracts(); updateGauges(); updateAccountInfoFromContracts(data); });
  contractsWS.on('proposal_open_contract', data=>{ const poc = data.proposal_open_contract||data; if(!poc||!poc.contract_id) return; if(poc.is_expired||poc.is_sold) delete activeContractsMap[poc.contract_id]; else activeContractsMap[poc.contract_id]=Object.assign({}, activeContractsMap[poc.contract_id]||{}, poc); renderActiveContracts(); updateGauges(); updateAccountInfoFromContracts(data); });

  // Generic message scanner for contracts and balance info (some WS messages may not use the specific event types)
  contractsWS.on('message', data => {
    try{
      // Log incoming message for debugging
      console.debug('[ContractsWS] Message:', data);

      // scan for nested contracts
      const found = scanForContracts(data);
      if(found.length){
        found.forEach(c => { 
          if(c?.contract_id) {
            // Deep merge of contract data
            activeContractsMap[c.contract_id] = {
              ...activeContractsMap[c.contract_id] || {},
              ...c,
              // Always update timestamps
              last_update: Date.now()
            };

            // If contract is sold/expired, schedule removal
            if(c.is_sold || c.is_expired) {
              setTimeout(() => {
                delete activeContractsMap[c.contract_id];
                renderActiveContracts();
              }, 2000); // Keep briefly visible then remove
            }
          }
        });
        
        // Immediate UI updates
        renderActiveContracts();
        updateGauges();
      }

      // Balance updates - check multiple message types
      if(data.balance || data.balance_raw || data.account_balance) {
        updateAccountInfoFromContracts(data);
      }
      
      // Portfolio updates
      if(data.portfolio || data.proposal_open_contract || data.active_positions) {
        updateAccountInfoFromContracts(data);
      }

    }catch(e){ 
      console.warn('contractsWS message scanner failed', e);
      console.error(e); // Full error for debugging
    }
  });

  function renderActiveContracts(){ 
    if(!ui.autoHistoryList) return; 
    
    // Get active contracts and sort by purchase time
    const arr = Object.keys(activeContractsMap)
      .map(k => activeContractsMap[k])
      .filter(c => c && !c.is_sold && !c.is_expired)
      .sort((a, b) => (b.purchase_time || 0) - (a.purchase_time || 0));
    
    if(!arr.length){ 
      ui.autoHistoryList.innerHTML='<div style="color:#94a3b8;padding:8px">No active contracts</div>'; 
      return; 
    } 

    let html = `
      <table class="trade-table">
        <thead>
          <tr>
            <th>Time</th>
            <th>ID</th>
            <th>Type</th>
            <th>Entry</th>
            <th>Current</th>
            <th>Stake</th>
            <th>Profit</th>
          </tr>
        </thead>
        <tbody>
    `;

    arr.forEach(c => {
      const t = c.purchase_time ? new Date(c.purchase_time*1000).toLocaleString() : '-';
      const id = c.contract_id || '-';
      const type = c.contract_type || '-';
      const entry = c.entry_tick || c.entry_spot || '-';
      const current = c.current_spot || c.exit_tick || entry;
      const stake = (c.buy_price || c.purchase_price || c.stake || 0).toFixed(2);
      const profit = (('profit' in c) ? Number(c.profit) : 
                    (('current_spot_profit' in c) ? Number(c.current_spot_profit) : 0)).toFixed(2);
      const profitClass = Number(profit) >= 0 ? 'profit-positive' : 'profit-negative';
      const directionClass = type.includes('UP') ? 'buy' : type.includes('DOWN') ? 'sell' : '';

      html += `
        <tr>
          <td>${t}</td>
          <td>${id}</td>
          <td class="${directionClass}">${type}</td>
          <td>${entry}</td>
          <td>${current}</td>
          <td style="text-align:right">${stake}</td>
          <td class="${profitClass}" style="text-align:right">${profit}</td>
        </tr>
      `;
    });

    html += '</tbody></table>';
    ui.autoHistoryList.innerHTML = html;

    // Update total P/L for gauge
    const totalPL = arr.reduce((sum, c) => {
      const profit = ('profit' in c) ? Number(c.profit) : 
                    ('current_spot_profit' in c) ? Number(c.current_spot_profit) : 0;
      return sum + profit;
    }, 0);

    latestPLAmount = totalPL;
    updateGauges();
  }

  // Main WS wiring
  mainWS.on('tick', d=> handleTick(d)); 
  mainWS.on('message', d=>{ 
    if(d && d.tick) handleTick(d);
  }); 
  // Add balance subscription handler
  mainWS.on('balance', data => {
    if(!ui?.accountInfo) return;
    try {
      if(data.balance) {
        const b = data.balance;
        ui.accountInfo.textContent = `Account: ${b.loginid} | Balance: ${Number(b.balance).toFixed(2)} ${b.currency}`;
      }
    } catch(e) {
      console.warn('Balance handler failed', e);
    }
  });

  mainWS.on('authorize', a=>{ 
    if(!ui) return; 
    try{
      const auth = a && a.authorize ? a.authorize : a;
      if(auth) {
        const balance = auth.balance;
        const currency = auth.currency || '';
        const loginid = auth.loginid;
        
        if(ui.accountInfo) {
          ui.accountInfo.textContent = `Account: ${loginid} | Balance: ${Number(balance).toFixed(2)} ${currency}`;
        }

        // Subscribe to balance updates immediately after authorization
        mainWS.send({ balance: 1, subscribe: 1 }, true);

        // Display gauges if symbol already selected
        if(currentSymbol && document.getElementById('gauges')) {
          document.getElementById('gauges').style.display = 'flex';
        }

        // If there was a pending symbol subscription, execute it now
        if(window.pendingSubscribe) {
          setTimeout(() => {
            if(mainWS.ws?.readyState === WebSocket.OPEN) {
              mainWS.send({ forget_all: 'ticks' });
              mainWS.send({ ticks: window.pendingSubscribe, subscribe: 1 });
              currentSymbol = window.pendingSubscribe;
              window.pendingSubscribe = null;
            }
          }, 300);
        }
      }
    }catch(e){ 
      console.warn('authorize handler failed', e); 
    }
    
    if(ui.connectBtn) {
      ui.connectBtn.textContent = 'Disconnect';
      ui.connectBtn.style.background = '#4caf50';
    }
  });
  contractsWS.on('authorize', ()=>{ /*contracts authorized*/ });

  // UI actions
  function attachActions(){ 
    if(!ui) return; 
    
    // Connect button
    if(ui.connectBtn) {
      ui.connectBtn.addEventListener('click', ()=>{ 
        if(mainWS.ws && mainWS.ws.readyState===WebSocket.OPEN){ 
          mainWS.close(); 
          contractsWS.close(); 
          ui.connectBtn.textContent='Se connecter';
          ui.connectBtn.style.background = '#f44336';
          if(ui.accountInfo) {
            ui.accountInfo.textContent='';
          }
          // Masquer les gauges à la déconnexion
          if(document.getElementById('gauges')) {
            document.getElementById('gauges').style.display = 'none';
          }
          window.pendingSubscribe = null;
        } else {
          ui.connectBtn.textContent = 'Connecting...';
          if(ui.accountInfo) {
            ui.accountInfo.textContent = 'Connecting...';
          }
          mainWS.connect(); 
          contractsWS.connect(); 
          ui.connectBtn.textContent='Connecting...';
          ui.connectBtn.style.background = '#ff9800';
        } 
        displaySymbols(); 
      });
    }

    // Trade buttons
    if(ui.buyBtn) {
      ui.buyBtn.addEventListener('click', ()=>{ 
        console.debug('BUY button clicked');
        executeTrade('BUY');
      });
    }
    if(ui.sellBtn) {
      ui.sellBtn.addEventListener('click', ()=>{ 
        console.debug('SELL button clicked');
        executeTrade('SELL');
      });
    }

    if (ui.toggleAutomation) {
      // === Automation Toggle ===
      ui.toggleAutomation.addEventListener("click", () => {
      //let ws = new WebSocket(WS_URL);
      if (!automationRunning) {
         ui.toggleAutomation.textContent = "Stop Automation";
         ui.toggleAutomation.style.background = "linear-gradient(90deg,#f44336,#e57373)";
         //startAutomation(ws);
         automationRunning = true;
      } else {
         ui.toggleAutomation.textContent = "Launch Automation";
         ui.toggleAutomation.style.background = "linear-gradient(90deg,#4caf50,#81c784)";
         //stopAutomation(ws);
         automationRunning = false;
      }
      });
    }

    // Close actions
    if(ui.closeAllBtn) {
      ui.closeAllBtn.addEventListener('click', () => {
        closeAllContracts();
      });
    }
    if(ui.closeWinningBtn) {
      ui.closeWinningBtn.addEventListener('click', () => {
        closeWinningContracts();
      });
    }

    // Contracts panel toggle
    if(ui.contractsPanelToggle) {
      ui.contractsPanelToggle.addEventListener('click', ()=>{ 
        if(!ui.contractsPanel) return;
        const isVisible = ui.contractsPanel.style.display === 'block';
        if(isVisible) {
          ui.contractsPanel.style.display = 'none';
          ui.contractsPanelToggle.textContent = '📊 Show Trades';
        } else {
          ui.contractsPanel.style.display = 'block';
          ui.contractsPanelToggle.textContent = '📊 Hide Trades';
          contractsWS.connect().then(()=>{ 
            contractsWS.send({ portfolio:1, subscribe:1 }, true); 
            contractsWS.send({ active_positions:1, subscribe:1 }, true); 
          });
        }
      });
    }

    // Control panel toggle
    if(ui.controlPanelToggle && ui.controlPanel) {
      ui.controlPanelToggle.addEventListener('click', () => {
        const isVisible = ui.controlPanel.style.display === 'flex';
        if(isVisible) {
          ui.controlPanel.classList.remove('active');
          setTimeout(() => {
            ui.controlPanel.style.display = 'none';
          }, 320);
          ui.controlPanelToggle.textContent = '⚙️ Show Controls';
        } else {
          ui.controlPanel.style.display = 'flex';
          setTimeout(() => {
            ui.controlPanel.classList.add('active');
          }, 10);
          ui.controlPanelToggle.textContent = '⚙️ Hide Controls';
        }
      });
    }
  }

  function executeTrade(type){ 
    if(!ui) return; 
    const stake = parseFloat(ui.stakeInput?.value) || 1;
    const multiplier = parseInt(ui.multiplierSelect?.value) || 300;

    if(!mainWS.authorized || !currentSymbol){ 
      console.warn('not authorized or no symbol'); 
      return; 
    }

    const payload = { 
      buy: 1, 
      price: stake.toFixed(2), 
      parameters: { 
        contract_type: type==="BUY" ? "MULTUP" : "MULTDOWN",
        symbol: currentSymbol,
        currency: "USD",
        basis: "stake",
        amount: stake.toFixed(2),
        multiplier
      }
    };

    let numb_;
    if (type === "BUY") {
      numb_ = parseInt(ui.buyNum?.value) || 1;
    } else if (type === "SELL") {
      numb_ = parseInt(ui.sellNum?.value) || 1;
    }

    console.log(`Executing ${numb_} ${type} trades...`);
    
    for(let i = 0; i < numb_; i++) {
      try{
        mainWS.send(payload);
        console.debug(`Trade ${i+1}/${numb_} sent:`, payload);
      }catch(e){ 
        console.warn(`Trade ${i+1}/${numb_} send failed:`, e, payload); 
      }
    }
  }

  //--- Acccount details of Users :
  function URLParam(){
    // Récupérer les paramètres de l'URL
    const params = new URLSearchParams(window.location.search);

    const accounts = [];
    for (let i = 1; params.has(`acct${i}`); i++) {
      accounts.push({
        account: params.get(`acct${i}`),
        token: params.get(`token${i}`),
        currency: params.get(`cur${i}`)
      });
    }
  }

  // Close all active contracts (best-effort) by sending sell requests via contractsWS
  function closeAllContracts(){
    console.log("Closing all trades...");
    
    // Create new WS connection specifically for closing all trades
    const closeAllWS = new WebSocketManager(WS_URL, 'closeAll');
    
    closeAllWS.on('authorize', (data) => {
      if(!data.authorize?.loginid){ 
        console.log("Token not authorized"); 
        closeAllWS.close();
        return; 
      }
      
      console.log("Connection Authorized.");
      closeAllWS.send({ portfolio: 1 });
    });

    closeAllWS.on('portfolio', (data) => {
      if(data.portfolio?.contracts?.length > 0) {
        const contracts = data.portfolio.contracts;
        console.log('Found '+ contracts.length + ' active contracts - closing all...');
        
        contracts.forEach((contract, i) => {
          setTimeout(() => {
            console.log('Closing contract '+ contract.contract_id + ' (' + contract.contract_type + ')');
            closeAllWS.send({
              sell: contract.contract_id,
              price: 0
            });
          }, i * 200);
        });
      } else {
        console.log('No active contracts found.');
        closeAllWS.close();
      }
    });

    closeAllWS.on('sell', (data) => {
      console.log(`✅ Contract ${data.sell.contract_id} closed with profit: ${parseFloat(data.sell.profit).toFixed(2)}`);
    });

    // Connect and start the process
    closeAllWS.connect();
  }

  // Close only winning contracts (profit > 0)
  function closeWinningContracts(){
    console.log("Closing all profitable trades...");
    
    // Create new WS connection specifically for closing trades
    const closeWS = new WebSocketManager(WS_URL, 'closeWinning');
    
    closeWS.on('authorize', (data) => {
      console.log("✅ Authorized successfully. Fetching portfolio...");
      closeWS.send({ portfolio: 1 });
    });

    closeWS.on('portfolio', (data) => {
      if(data.portfolio?.contracts?.length > 0) {
        const contracts = data.portfolio.contracts;
        console.log("📊 Found " + contracts.length + " active contracts.");

        contracts.forEach((contract, i) => {
          setTimeout(() => {
            closeWS.send({
              proposal_open_contract: 1,
              contract_id: contract.contract_id
            });
          }, i * 200);
        });
      } else {
        console.log("⚠️ No active contracts found.");
        closeWS.close();
      }
    });

    closeWS.on('proposal_open_contract', (data) => {
      if(data.proposal_open_contract) {
        const poc = data.proposal_open_contract;
        const profit = parseFloat(poc.profit);

        if(profit > 0) {
          console.log(`💰 Closing profitable trade ${poc.contract_id} with profit ${profit.toFixed(2)}`);
          closeWS.send({
            sell: poc.contract_id,
            price: 0
          });
        }
      }
    });

    closeWS.on('sell', (data) => {
      const profit = parseFloat(data.sell.profit);
      console.log(`✅ Trade ${data.sell.contract_id} closed with profit: ${profit.toFixed(2)}`);
    });

    // Connect and start the process
    closeWS.connect();
  }

  // expose for debug
  window.__app = { mainWS, contractsWS, subscribeSymbol, renderActiveContracts, activeContractsMap };

  // Start
  document.addEventListener('DOMContentLoaded', ()=>{
    bindUI(); displaySymbols(); initChart(); attachActions(); URLParam(); // connect contracts channel for updates
    contractsWS.connect();
  });

})();
