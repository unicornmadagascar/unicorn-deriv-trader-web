// Clean working app (app.fixed.js)
// Safe, single-entry version of app.js with central WebSocketManager

document.addEventListener('DOMContentLoaded', () => {
  const APP_ID = 105747;
  const TOKEN = 'wgf8TFDsJ8Ecvze';
  const WS_URL = `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;

  function safeCall(cb, ...args) { try { cb(...args); } catch (e) { console.error('handler error', e); } }

  class WebSocketManager {
    constructor(url, name = 'ws') {
      this.url = url; this.name = name; this.ws = null; this.handlers = new Map();
      this.reconnectAttempts = 0; this.maxReconnectAttempts = 10; this.reconnectBaseDelay = 1000;
      this.authorized = false; this._outgoingQueue = []; this._connecting = false;
    }
    connect() {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) return Promise.resolve(this.ws);
      if (this._connecting) return Promise.resolve(this.ws);
      this._connecting = true;
      return new Promise((resolve, reject) => {
        try {
          this.ws = new WebSocket(this.url);
          this.ws.onopen = () => { this._log('open'); this.reconnectAttempts = 0; this._connecting = false; this.send({ authorize: TOKEN }, true); while (this._outgoingQueue.length) this._rawSend(this._outgoingQueue.shift()); resolve(this.ws); };
          this.ws.onmessage = (evt) => { let data; try { data = JSON.parse(evt.data); } catch (e) { this._log('parse error', e); return; } this._handleMessage(data); };
          this.ws.onclose = () => { this._log('closed'); this.authorized = false; this._scheduleReconnect(); };
          this.ws.onerror = (err) => { this._log('error', err); };
        } catch (err) { this._connecting = false; reject(err); }
      });
    }
    close() { try { this.ws?.close(); } catch(e){} this.ws = null; this.authorized = false; }
    _scheduleReconnect() { if (this.reconnectAttempts >= this.maxReconnectAttempts) return; this.reconnectAttempts++; const delay = this.reconnectBaseDelay * this.reconnectAttempts; this._log('reconnect in', delay); setTimeout(()=>{ try{ this.connect(); } catch(e){} }, delay); }
    on(t,cb){ if(!this.handlers.has(t)) this.handlers.set(t,new Set()); this.handlers.get(t).add(cb);} off(t,cb){ this.handlers.get(t)?.delete(cb);} _emit(t,p){ const c=this.handlers.get(t); if(c) c.forEach(cb=>safeCall(cb,p)); const any=this.handlers.get('message'); if(any) any.forEach(cb=>safeCall(cb,p)); }
    _handleMessage(data){ if(data.msg_type==='authorize' || data.authorize){ this.authorized = Boolean(data.authorize); this._emit('authorize', data); return; } const type = data.msg_type || Object.keys(data)[0]; if(type && this.handlers.has(type)) this.handlers.get(type).forEach(cb=>safeCall(cb,data)); else this._emit('message', data); }
    _rawSend(o){ try{ this.ws.send(JSON.stringify(o)); } catch(e){ this._log('rawSend failed', e); } }
    send(o, immediate=false){ if(!this.ws||this.ws.readyState!==WebSocket.OPEN){ if(immediate) this.connect().then(()=>this._rawSend(o)).catch(e=>this._log('send failed',e)); else { this._outgoingQueue.push(o); this.connect().catch(e=>this._log('connect queued failed', e)); } return; } this._rawSend(o); }
    _log(...a){ console.debug(`[${this.name}]`,...a); }
  }

  const mainWS = new WebSocketManager(WS_URL,'main');
  const contractsWS = new WebSocketManager(WS_URL,'contracts');

  const symbolList = document.getElementById('symbolList');
  const chartInner = document.getElementById('chartInner');
  const volGauge = document.getElementById('volGauge');
  const trendGauge = document.getElementById('trendGauge');
  const probGauge = document.getElementById('probGauge');
  const autoHistoryList = document.getElementById('autoHistoryList');

  let currentSymbol = null; let recentChanges = []; let smoothVol=0, smoothTrend=0; const activeContractsMap = {};

  const SYMBOLS = [ {symbol:'R_100',name:'R_100'},{symbol:'R_50',name:'R_50'},{symbol:'CRASH500',name:'CRASH500'},{symbol:'BOOM500',name:'BOOM500'} ];

  function displaySymbols(){ if(!symbolList) return; symbolList.innerHTML=''; SYMBOLS.forEach(s=>{ const el=document.createElement('div'); el.className='symbol-item'; el.textContent=s.name; el.dataset.symbol=s.symbol; el.addEventListener('click',()=>{ document.querySelectorAll('.symbol-item').forEach(i=>i.classList.remove('active')); el.classList.add('active'); subscribeSymbol(s.symbol); }); symbolList.appendChild(el); }); }
  function initChart(){ if(!chartInner) return; chartInner.innerHTML = '<div style="color:#94a3b8;padding:8px">Chart ready</div>'; }
  function drawCircularGauge(container,value){ if(!container) return; container.innerHTML=''; const d=document.createElement('div'); d.style.width='110px'; d.style.height='110px'; d.style.borderRadius='50%'; d.style.background='#f3f4f6'; d.style.display='flex'; d.style.alignItems='center'; d.style.justifyContent='center'; d.style.fontWeight='700'; d.textContent= Math.round(value)+'%'; container.appendChild(d); }
  function updateCircularGauges(){ if(!recentChanges.length) return; const mean = recentChanges.reduce((a,b)=>a+b,0)/recentChanges.length; const variance = recentChanges.reduce((a,b)=>a+Math.pow(b-mean,2),0)/recentChanges.length; const stdDev = Math.sqrt(variance); const volProb = Math.min(100,(stdDev/0.07)*100); const sum=recentChanges.reduce((a,b)=>a+b,0); const trendRaw = Math.min(100, Math.abs(sum)*1000); const alpha=0.25; smoothVol = smoothVol===0?volProb:smoothVol+alpha*(volProb-smoothVol); smoothTrend = smoothTrend===0?trendRaw:smoothTrend+alpha*(trendRaw-smoothTrend); drawCircularGauge(volGauge,smoothVol); drawCircularGauge(trendGauge,smoothTrend); }

  function subscribeSymbol(symbol){ currentSymbol=symbol; initChart(); mainWS.connect().then(()=>{ mainWS.send({ forget_all:'ticks' }); mainWS.send({ ticks:symbol, subscribe:1 }); }); }
  function handleTick(msg){ const tick = msg.tick||msg; if(!tick||!tick.symbol) return; if(currentSymbol && tick.symbol !== currentSymbol) return; const quote=Number(tick.quote); const prev=(handleTick.lastQuote&&handleTick.lastQuote[tick.symbol])||quote; handleTick.lastQuote=handleTick.lastQuote||{}; handleTick.lastQuote[tick.symbol]=quote; const change=quote-prev; recentChanges.push(change); if(recentChanges.length>60) recentChanges.shift(); updateCircularGauges(); }
  mainWS.on('tick', data=>handleTick(data)); mainWS.on('message', data=>{ if(data&&data.tick) handleTick(data); });

  contractsWS.on('portfolio', d=>{ const list = d.portfolio?.contracts||d.contracts||[]; list.forEach(c=>{ if(c?.contract_id) activeContractsMap[c.contract_id]=c; }); renderActiveContracts(); });
  contractsWS.on('active_positions', d=>{ const list = d.active_positions?.positions||d.positions||d.contracts||[]; list.forEach(c=>{ if(c?.contract_id) activeContractsMap[c.contract_id]=Object.assign({},activeContractsMap[c.contract_id]||{},c); }); renderActiveContracts(); });
  contractsWS.on('proposal_open_contract', d=>{ const poc = d.proposal_open_contract||d; if(!poc||!poc.contract_id) return; if(poc.is_expired||poc.is_sold) delete activeContractsMap[poc.contract_id]; else activeContractsMap[poc.contract_id]=Object.assign({},activeContractsMap[poc.contract_id]||{},poc); renderActiveContracts(); });

  function renderActiveContracts(){ if(!autoHistoryList) return; const arr=Object.keys(activeContractsMap).map(k=>activeContractsMap[k]); if(!arr.length){ autoHistoryList.innerHTML='<div style="color:#94a3b8;padding:8px">No active contracts</div>'; return; } let html='<table class="trade-table"><thead><tr><th>Time</th><th>Contract</th><th>Profit</th></tr></thead><tbody>'; arr.forEach(c=>{ const time=c.purchase_time?new Date(c.purchase_time*1000).toLocaleString():'-'; const id=c.contract_id||'-'; const profit=(('profit' in c)?Number(c.profit):(('current_spot_profit' in c)?Number(c.current_spot_profit):0)).toFixed(2); html+=`<tr><td>${time}</td><td>${id}</td><td>${profit}</td></tr>`; }); html+='</tbody></table>'; autoHistoryList.innerHTML=html; }

  if(window.__app === undefined) window.__app = {};
  window.__app.mainWS = mainWS; window.__app.contractsWS = contractsWS; window.__app.subscribeSymbol = subscribeSymbol;

  displaySymbols(); initChart(); contractsWS.connect();
});
