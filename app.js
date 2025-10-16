// app.js - Live ticks follow + Multiplier buy via WebSocket (proposal -> buy)
document.addEventListener("DOMContentLoaded", () => {
  const APP_ID = 105747;
  const WS_URL = `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;

  // DOM
  const tokenInput = document.getElementById("tokenInput");
  const connectBtn = document.getElementById("connectBtn");
  const statusSpan = document.getElementById("status");
  const userBalance = document.getElementById("userBalance");
  const symbolList = document.getElementById("symbolList");
  const historyList = document.getElementById("historyList");
  const buyBtn = document.getElementById("buyBtn");
  const sellBtn = document.getElementById("sellBtn");
  const closeBtn = document.getElementById("closeBtn");
  const chartInner = document.getElementById("chartInner");
  const gaugeDashboard = document.getElementById("gaugeDashboard");
  const lotInput = document.getElementById("lot");
  const stakeInput = document.getElementById("stake");
  const modeSelect = document.getElementById("modeSelect");
  const multiplierInput = document.getElementById("multiplier"); // multiplier field present in your controls

  // state
  let ws = null;
  let authorized = false;
  let currentSymbol = null;
  let prevPriceMap = {};     // previous price per symbol (for direction)
  let chartData = [];        // raw prices
  let chartTimes = [];       // epochs
  let canvas = null, ctx = null;
  let tooltip = null;
  let openPosition = null;   // simulation position
  const volatilitySymbols = ["BOOM1000","BOOM900","BOOM600","BOOM500","BOOM300","CRASH1000","CRASH900","CRASH600","CRASH500"];

  // Gauges definitions (kept simple)
  let gaugeDefs = [
    { name: "Volatility", smoothed: 0 },
    { name: "ATR", smoothed: 0 },
    { name: "EMA", smoothed: 0 }
  ];
  const GAUGE_ALPHA = 0.18;

  // Prepare chart inner container
  chartInner.style.position = "relative";

  // tooltip
  tooltip = document.createElement("div");
  Object.assign(tooltip.style, {
    position: "absolute",
    padding: "6px 10px",
    background: "rgba(0,0,0,0.78)",
    color: "#fff",
    borderRadius: "6px",
    fontSize: "12px",
    pointerEvents: "none",
    display: "none",
    zIndex: "9999"
  });
  chartInner.appendChild(tooltip);

  // helpers
  function setStatus(t){ statusSpan.textContent = t; }
  function logHistory(t){ const d=document.createElement("div"); d.textContent = `${new Date().toLocaleTimeString()} — ${t}`; historyList.prepend(d); }

  // Symbols UI
  function initSymbols(){
    symbolList.innerHTML = "";
    volatilitySymbols.forEach(sym=>{
      const div = document.createElement("div");
      div.className = "symbolItem";
      div.id = `symbol-${sym}`;
      div.innerHTML = `<span class="symbolName">${sym}</span> — <span class="symbolValue">➡</span>`;
      div.onclick = ()=> selectSymbol(sym);
      symbolList.appendChild(div);
    });
  }

  function selectSymbol(sym){
    currentSymbol = sym;
    document.querySelectorAll(".symbolItem").forEach(el=>el.classList.remove("active"));
    const el = document.getElementById(`symbol-${sym}`);
    if(el) el.classList.add("active");
    chartData = []; chartTimes = [];
    initCanvas();
    initGauges(); // keep gauges inside chart area (top-right)
    // subscribe & request history
    if(ws && ws.readyState === WebSocket.OPEN && authorized){
      subscribeTicks(sym);
      requestHistory(sym);
    } else {
      // fallback to simulation if no WS or not authorized
      startSimulation(sym);
    }
    logHistory(`Selected ${sym}`);
  }

  // Canvas init
  function initCanvas(){
    chartInner.querySelectorAll("canvas, .chart-canvas").forEach(n=>n.remove());
    // append gaugeDashboard first (absolute positioned)
    if(gaugeDashboard) chartInner.appendChild(gaugeDashboard);
    chartInner.appendChild(tooltip);

    canvas = document.createElement("canvas");
    canvas.className = "chart-canvas";
    canvas.width = chartInner.clientWidth;
    canvas.height = chartInner.clientHeight;
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    chartInner.appendChild(canvas);
    ctx = canvas.getContext("2d");

    canvas.addEventListener("mousemove", handleMouseMove);
    canvas.addEventListener("mouseleave", ()=> tooltip.style.display = "none");

    window.addEventListener("resize", ()=> {
      if(!canvas) return;
      canvas.width = chartInner.clientWidth;
      canvas.height = chartInner.clientHeight;
      drawAll();
    });
  }

  // Gauges inside #gaugeDashboard
  function initGauges(){
    if(!gaugeDashboard) return;
    gaugeDashboard.innerHTML = "";
    gaugeDefs.forEach(g=>{
      const c = document.createElement("canvas");
      c.width = 120; c.height = 120;
      c.dataset.name = g.name;
      c.style.width = "120px"; c.style.height = "120px";
      gaugeDashboard.appendChild(c);
      g.smoothed = 0;
    });
  }

  // Draw chart (area + border + current price)
  function drawChart(){
    if(!ctx) return;
    const w = canvas.width, h = canvas.height, pad = 50;
    ctx.clearRect(0,0,w,h);
    if(chartData.length === 0) {
      // empty: draw placeholder
      ctx.fillStyle = "#fafcff"; ctx.fillRect(0,0,w,h);
      return;
    }

    // compute range
    const maxV = Math.max(...chartData);
    const minV = Math.min(...chartData);
    const range = Math.max(1e-8, maxV - minV);

    // background gradient
    const bg = ctx.createLinearGradient(0,0,0,h);
    bg.addColorStop(0, "#f5f9ff"); bg.addColorStop(1, "#eaf2ff");
    ctx.fillStyle = bg; ctx.fillRect(0,0,w,h);

    // axes
    ctx.strokeStyle = "#444"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pad,pad); ctx.lineTo(pad,h-pad); ctx.lineTo(w-pad,h-pad); ctx.stroke();

    // grid + y labels
    ctx.strokeStyle = "#ddd"; ctx.lineWidth = 0.7; ctx.fillStyle = "#333"; ctx.font = "11px Arial"; ctx.textAlign = "right"; ctx.textBaseline = "middle";
    for(let i=0;i<=5;i++){
      const y = h - pad - (i/5)*(h - pad*2);
      ctx.beginPath(); ctx.moveTo(pad,y); ctx.lineTo(w-pad,y); ctx.stroke();
      const val = (minV + (i/5)* (range));
      ctx.fillText(val.toFixed(2), pad - 8, y);
    }

    // area (no smoothing)
    const len = chartData.length;
    ctx.beginPath();
    for(let i=0;i<len;i++){
      const x = pad + (i/(len-1||1))*(w - pad*2);
      const y = h - pad - ((chartData[i] - minV)/range)*(h - pad*2);
      if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    }
    ctx.lineTo(w-pad, h-pad); ctx.lineTo(pad, h-pad); ctx.closePath();
    const fillG = ctx.createLinearGradient(0,pad,0,h-pad);
    fillG.addColorStop(0, "rgba(0,123,255,0.42)"); fillG.addColorStop(1,"rgba(0,123,255,0.06)");
    ctx.fillStyle = fillG; ctx.fill();

    // line
    ctx.beginPath();
    for(let i=0;i<len;i++){
      const x = pad + (i/(len-1||1))*(w - pad*2);
      const y = h - pad - ((chartData[i] - minV)/range)*(h - pad*2);
      if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    }
    ctx.strokeStyle = "#007bff"; ctx.lineWidth = 2; ctx.stroke();

    // current price line
    const last = chartData[len-1];
    const yPrice = h - pad - ((last - minV)/range)*(h - pad*2);
    ctx.strokeStyle = "red"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(pad, yPrice); ctx.lineTo(w-pad, yPrice); ctx.stroke();
    ctx.fillStyle = "red"; ctx.beginPath(); ctx.arc(w-pad-12, yPrice, 5, 0, Math.PI*2); ctx.fill();
    ctx.font = "14px Arial"; ctx.textAlign = "left"; ctx.fillStyle = "#111";
    ctx.fillText(last.toFixed(2), w - pad - 68, yPrice - 6);
  }

  // Draw each small gauge canvas
  function drawAllGauges(){
    if(!gaugeDashboard) return;
    const canvases = Array.from(gaugeDashboard.querySelectorAll("canvas"));
    canvases.forEach((c, idx) => {
      // compute raw value
      let raw = 0;
      const def = gaugeDefs[idx];
      if(def.name === "Volatility") raw = computeVolatility();
      else if(def.name === "ATR") raw = computeATR();
      else if(def.name === "EMA") raw = computeEMAPercent();
      raw = Math.max(0, Math.min(100, raw));
      // smooth to reduce jitter
      def.smoothed = (def.smoothed || 0)*(1 - GAUGE_ALPHA) + raw*GAUGE_ALPHA;
      renderGaugeCanvas(c, def.smoothed, def.name);
    });
  }

  function renderGaugeCanvas(canvasEl, value, title){
    const gctx = canvasEl.getContext("2d");
    const W = canvasEl.width, H = canvasEl.height, cx = W/2, cy = H/2, radius = Math.min(W,H)/2 - 12;
    gctx.clearRect(0,0,W,H);
    // bg ring
    gctx.beginPath(); gctx.arc(cx,cy,radius,0,Math.PI*2); gctx.strokeStyle="#eee"; gctx.lineWidth=12; gctx.stroke();
    // progress
    const end = (value/100)*Math.PI*2;
    gctx.beginPath(); gctx.arc(cx,cy,radius,-Math.PI/2,-Math.PI/2 + end);
    const grad = gctx.createLinearGradient(0,0,W,H); grad.addColorStop(0,"#3b82f6"); grad.addColorStop(1,"#2563eb");
    gctx.strokeStyle = grad; gctx.lineWidth = 12; gctx.lineCap = "round"; gctx.stroke();
    // text
    gctx.fillStyle = "#222"; gctx.font = "12px Arial"; gctx.textAlign = "center"; gctx.textBaseline = "middle";
    gctx.fillText(title, cx, cy - 8); gctx.fillText(value.toFixed(1) + "%", cx, cy + 12);
  }

  // gauge computations (based on actual ticks)
  function computeVolatility(N = 50){
    if(chartData.length < 2) return 0;
    const arr = chartData.slice(-N);
    const mean = arr.reduce((s,v)=>s+v,0)/arr.length;
    if(!isFinite(mean) || mean === 0) return 0;
    const variance = arr.reduce((s,v)=>s + Math.pow(v-mean,2),0)/arr.length;
    const sd = Math.sqrt(variance);
    return Math.min((sd/Math.abs(mean))*100, 100);
  }
  function computeATR(N = 50){
    if(chartData.length < 2) return 0;
    const arr = chartData.slice(-N);
    let sum = 0;
    for(let i=0;i<arr.length-1;i++) sum += Math.abs(arr[i+1]-arr[i]);
    const avg = sum / Math.max(1, arr.length-1);
    const mean = arr.reduce((s,v)=>s+v,0)/arr.length;
    if(!isFinite(mean) || mean===0) return 0;
    return Math.min((avg/Math.abs(mean))*100, 100);
  }
  function computeEMAPercent(period = 20){
    if(chartData.length < 2) return 0;
    const P = Math.min(period, chartData.length);
    let ema = chartData[chartData.length - P];
    const k = 2/(P+1);
    for(let i = chartData.length - P + 1; i < chartData.length; i++){
      ema = chartData[i] * k + ema * (1 - k);
    }
    const last = chartData[chartData.length - 1] || 1;
    return Math.min(Math.abs((ema - last) / Math.abs(last))*100, 100);
  }

  // draw open position (simulation) on chart
  function drawPositionOnChart(){
    if(!ctx || !openPosition || !chartData.length) return;
    const w = canvas.width, h = canvas.height, pad = 50;
    const maxV = Math.max(...chartData), minV = Math.min(...chartData), range = Math.max(1e-8, maxV - minV);
    const entry = openPosition.entry;
    const y = h - pad - ((entry - minV)/range)*(h - pad*2);
    ctx.save();
    ctx.fillStyle = openPosition.type === "BUY" ? "green" : "orange";
    ctx.beginPath();
    ctx.moveTo(pad + 8, y);
    ctx.lineTo(pad + 24, y - 8);
    ctx.lineTo(pad + 24, y + 8);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#111"; ctx.font = "12px Arial";
    ctx.fillText(`${openPosition.type} ${openPosition.qty}@${entry.toFixed(2)}`, pad + 28, y + 4);
    ctx.restore();
  }

  // mouse -> tooltip
  function handleMouseMove(e){
    if(!canvas || !chartData.length) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pad = 50;
    const w = canvas.width - pad*2;
    const len = chartData.length;
    const ratio = (x - pad) / (w || 1);
    let idx = Math.round(ratio * (len - 1));
    idx = Math.max(0, Math.min(idx, len - 1));
    const price = chartData[idx];
    const t = chartTimes[idx] ? new Date(chartTimes[idx]*1000).toLocaleTimeString().slice(0,8) : "";
    tooltip.innerHTML = `<b>${currentSymbol}</b><br>Price: <b>${price.toFixed(2)}</b><br><span style="opacity:0.9">${t}</span>`;
    // place tooltip inside chartInner
    const chartRect = chartInner.getBoundingClientRect();
    let left = e.clientX - chartRect.left + 12;
    let top = e.clientY - chartRect.top - 28;
    // clamp
    if(left + tooltip.offsetWidth > chartInner.clientWidth - 8) left = chartInner.clientWidth - tooltip.offsetWidth - 8;
    if(left < 8) left = 8;
    if(top + tooltip.offsetHeight > chartInner.clientHeight - 8) top = chartInner.clientHeight - tooltip.offsetHeight - 8;
    if(top < 8) top = 8;
    tooltip.style.left = left + "px"; tooltip.style.top = top + "px"; tooltip.style.display = "block";
  }

  // compose and send proposal for multiplier
  function sendMultiplierProposal(type /* "MULTUP" or "MULTDOWN" */, amount, symbol, multiplier){
    if(!ws || ws.readyState !== WebSocket.OPEN) {
      logHistory("WS not open: cannot send proposal");
      return;
    }
    const echo = { action: "proposal", contract_type: type, symbol, amount, multiplier };
    const req = {
      proposal: 1,
      amount: amount,
      contract_type: type,
      symbol: symbol,
      basis: "stake",
      duration_unit: "s", // multiplier typically runs until closed; Deriv may ignore duration for multiplier
      passthrough: echo
    };
    // Include multiplier parameter if provided (some API expects 'multiplier' parameter)
    if(multiplier) req.multiplier = Number(multiplier);
    ws.send(JSON.stringify(req));
    logHistory(`Proposal requested: ${symbol} ${type} stake=${amount} x${multiplier || 1}`);
  }

  // buy using proposal id (preferred) or parameters fallback
  function buyFromProposal(proposalObj){
    // proposalObj should contain id and ask_price or proposal.ask_price
    const prop = proposalObj.proposal || proposalObj;
    const id = prop.id || prop.proposal_id || prop.id_reference || null;
    const ask = prop.ask_price || prop.proposal?.ask_price || prop.price || prop.proposal_price;
    if(!id || !ask){
      logHistory("Proposal response incomplete: cannot buy");
      return;
    }
    // send buy using buy = id (preferred)
    const buyReq = { buy: id, price: ask, subscribe: 1, passthrough: { bought_from_proposal: true } };
    ws.send(JSON.stringify(buyReq));
    logHistory(`Buy request sent (proposal id=${id}, price=${ask})`);
  }

  // handle incoming websocket messages (proposal, buy, tick, history, balance, authorize)
  function handleWsMessage(data){
    if(!data) return;
    // authorize result
    if(data.msg_type === "authorize"){
      if(data.error){
        logHistory("Authorization failed");
        setStatus("Auth failed");
        authorized = false;
        return;
      }
      authorized = true;
      setStatus(`Authorized: ${data.authorize?.loginid || ''}`);
      // subscribe balance
      ws.send(JSON.stringify({ balance: 1, subscribe: 1 }));
      initSymbols();
    }

    // balance
    if(data.msg_type === "balance" && data.balance?.balance != null){
      userBalance.textContent = `Balance: ${parseFloat(data.balance.balance).toFixed(2)} USD`;
    }

    // proposal response (we asked for proposal)
    if(data.msg_type === "proposal" || data.proposal){
      // Deriv returns proposal under 'proposal' property and echo_req in echo_req or passthrough
      const passthrough = data.echo_req?.passthrough || data.passthrough || (data.proposal && data.proposal.passthrough);
      // If this proposal was our multiplier proposal, buy immediately (live mode)
      if(passthrough && passthrough.action === "proposal"){
        // now buy (use id inside data.proposal.id and ask_price)
        const prop = data.proposal || data;
        if(prop.id || prop.proposal_id){
          // buy by id
          const buyReq = { buy: prop.id || prop.proposal_id, price: prop.ask_price || prop.proposal?.ask_price || prop.ask_price };
          // In practice, some docs accept buy: id and price (max price)
          ws.send(JSON.stringify(buyReq));
          logHistory(`Sent buy for proposal id=${buyReq.buy} price=${buyReq.price}`);
        } else {
          // fallback: buy using parameters
          const buyReq = { buy: 1, price: prop.ask_price || prop.proposal?.ask_price || 0, parameters: {
            amount: passthrough.amount,
            contract_type: passthrough.contract_type,
            symbol: passthrough.symbol,
            multiplier: passthrough.multiplier
          }};
          ws.send(JSON.stringify(buyReq));
          logHistory("Sent buy (fallback) with parameters from proposal passthrough");
        }
      }
      return;
    }

    // buy response
    if(data.msg_type === "buy" || data.buy){
      // contract successfully bought
      const contract = data.buy || data;
      logHistory(`BUY confirmed (contract_id: ${contract.contract_id || contract.buy_id || 'n/a'})`);
      return;
    }

    // ticks_history (history response)
    if((data.msg_type === "history" || data.history) && data.history && data.history.prices){
      const prices = data.history.prices.map(p => Number(p));
      const times = data.history.times.map(t => Math.floor(Number(t)));
      // apply to chart only if same symbol requested
      const reqSym = data.echo_req?.ticks_history || data.echo_req?.ticks_history;
      if(reqSym === currentSymbol || !currentSymbol){
        chartData = prices.slice(-300);
        chartTimes = times.slice(-300);
        drawAll();
      }
      return;
    }

    // tick streaming
    if(data.msg_type === "tick" && data.tick){
      const t = data.tick;
      const sym = t.symbol;
      const price = Number(t.quote);
      // maintain previous price to show arrows (we shall compare with prevPriceMap BEFORE we overwrite it)
      const prev = prevPriceMap[sym];
      // update prevMap AFTER using prev
      // Update symbol arrow using prev correctly:
      const symbolEl = document.getElementById(`symbol-${sym}`);
      if(symbolEl){
        const span = symbolEl.querySelector(".symbolValue");
        let dir = "➡", color = "#666";
        if(prev !== undefined){
          if(price > prev){ dir = "🔼"; color = "green"; }
          else if(price < prev){ dir = "🔽"; color = "red"; }
        }
        span.textContent = dir; span.style.color = color;
      }
      prevPriceMap[sym] = price; // set prev after deciding direction

      // if tick is for currentSymbol, append to chart (real tick)
      if(sym === currentSymbol){
        chartData.push(price);
        chartTimes.push(t.epoch);
        if(chartData.length > 300){ chartData.shift(); chartTimes.shift(); }
        // update drawing
        drawAll();
      }
    }
  }

  // subscribe ticks/history
  function subscribeTicks(sym){
    if(!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ ticks: sym, subscribe: 1 }));
    logHistory(`Subscribed ticks: ${sym}`);
  }
  function requestHistory(sym){
    if(!ws || ws.readyState !== WebSocket.OPEN) {
      // simulation fallback
      startSimulation(sym);
      return;
    }
    ws.send(JSON.stringify({ ticks_history: sym, end: "latest", count: 300, style: "ticks" }));
    logHistory(`Requested history: ${sym}`);
  }

  // simulation fallback (random walk) — used if not connected or testing
  let simInt = null;
  function startSimulation(sym){
    stopSimulation();
    let tick = (prevPriceMap[sym] || 1000) + (Math.random()-0.5)*2;
    simInt = setInterval(()=>{
      tick += (Math.random()-0.5)*2;
      const epoch = Math.floor(Date.now()/1000);
      if(sym === currentSymbol){
        chartData.push(tick); chartTimes.push(epoch);
        if(chartData.length>300) { chartData.shift(); chartTimes.shift(); }
        drawAll();
      }
      // update symbol arrow
      const el = document.getElementById(`symbol-${sym}`);
      if(el){
        const span = el.querySelector(".symbolValue");
        const prev = prevPriceMap[sym] || tick;
        let dir = "➡", color = "#666";
        if(tick > prev){ dir = "🔼"; color = "green"; }
        else if(tick < prev){ dir = "🔽"; color = "red"; }
        span.textContent = dir; span.style.color = color;
      }
      prevPriceMap[sym] = tick;
    }, 900);
    logHistory(`Simulation started for ${sym}`);
  }
  function stopSimulation(){ if(simInt){ clearInterval(simInt); simInt = null; } }

  // Combined draw
  function drawAll(){ drawChart(); drawAllGauges(); drawPositionOnChart(); }

  // WebSocket connect
  connectBtn.addEventListener("click", ()=>{
    const token = tokenInput.value.trim();
    try{ if(ws) ws.close(); } catch(e){}
    ws = new WebSocket(WS_URL);
    ws.onopen = ()=> {
      setStatus("Connected");
      logHistory("WS open");
      if(token){
        ws.send(JSON.stringify({ authorize: token }));
      } else {
        initSymbols();
        // we still can subscribe to ticks (no trade permission)
      }
    };
    ws.onmessage = e => {
      let data;
      try{ data = JSON.parse(e.data); } catch(err){ return; }
      handleWsMessage(data);
    };
    ws.onclose = ()=> setStatus("Disconnected");
    ws.onerror = ()=> setStatus("WS error");
  });

  // PLACE LIVE MULTIPLIER ORDER (proposal -> buy). typeStr = "MULTUP" or "MULTDOWN"
  function placeLiveMultiplier(typeStr, stake, symbol, multiplier){
    if(!ws || ws.readyState !== WebSocket.OPEN){
      logHistory("WS not open: cannot place live order");
      return;
    }
    if(!authorized){
      logHistory("Not authorized: cannot place live order");
      return;
    }
    // send a proposal; include passthrough so we can detect it in the response
    const echo = { action: "proposal", contract_type: typeStr, symbol, amount: stake, multiplier: multiplier };
    const proposalReq = {
      proposal: 1,
      amount: stake,
      contract_type: typeStr,
      symbol: symbol,
      basis: "stake",
      passthrough: echo
    };
    // multiplier param (some implementations expect a 'multiplier' field)
    if(multiplier) proposalReq.multiplier = Number(multiplier);
    ws.send(JSON.stringify(proposalReq));
    logHistory(`Live proposal sent (${typeStr}) ${symbol} stake=${stake} x${multiplier}`);
    // when we receive the 'proposal' response, handleWsMessage will immediately send the buy using the returned id/ask_price
  }

  // Trade simulation handlers
  buyBtn.addEventListener("click", ()=>{
    const stake = Number(stakeInput?.value) || 1;
    const lot = Number(lotInput?.value) || 1;
    const mult = Number(multiplierInput?.value) || 1;
    if(modeSelect && modeSelect.value === "live"){
      // live mode: place a multiplier buy (MULTUP)
      if(!currentSymbol) { logHistory("Select a symbol first"); return; }
      if(!authorized) { logHistory("Authorize with API token for live trading"); return; }
      placeLiveMultiplier("MULTUP", stake, currentSymbol, mult);
      return;
    }
    // simulation
    if(!currentSymbol || chartData.length === 0){ logHistory("No symbol or no data"); return; }
    const price = chartData[chartData.length - 1];
    openPosition = { type: "BUY", symbol: currentSymbol, qty: lot, stake, entry: price, time: Date.now() };
    logHistory(`SIM BUY ${lot} ${currentSymbol} @ ${price.toFixed(2)} stake=${stake}`);
    drawAll();
  });

  sellBtn.addEventListener("click", ()=>{
    const stake = Number(stakeInput?.value) || 1;
    const lot = Number(lotInput?.value) || 1;
    const mult = Number(multiplierInput?.value) || 1;
    if(modeSelect && modeSelect.value === "live"){
      if(!currentSymbol) { logHistory("Select a symbol first"); return; }
      if(!authorized) { logHistory("Authorize with API token for live trading"); return; }
      placeLiveMultiplier("MULTDOWN", stake, currentSymbol, mult);
      return;
    }
    if(!currentSymbol || chartData.length === 0){ logHistory("No symbol or no data"); return; }
    const price = chartData[chartData.length - 1];
    openPosition = { type: "SELL", symbol: currentSymbol, qty: lot, stake, entry: price, time: Date.now() };
    logHistory(`SIM SELL ${lot} ${currentSymbol} @ ${price.toFixed(2)} stake=${stake}`);
    drawAll();
  });

  closeBtn.addEventListener("click", ()=>{
    if(!openPosition){ logHistory("No open simulated position"); return; }
    if(chartData.length === 0){ logHistory("No ticks to close"); return; }
    const exit = chartData[chartData.length - 1];
    const diff = openPosition.type === "BUY" ? (exit - openPosition.entry) : (openPosition.entry - exit);
    const pnl = diff * openPosition.qty * (openPosition.stake || 1);
    logHistory(`SIM CLOSE ${openPosition.type} ${openPosition.symbol} entry=${openPosition.entry.toFixed(2)} exit=${exit.toFixed(2)} PnL=${pnl.toFixed(2)}`);
    openPosition = null;
    drawAll();
  });

  // initial UI & pick first symbol
  initSymbols();
  setStatus("Ready — connect or use simulation");
  if(volatilitySymbols.length) selectSymbol(volatilitySymbols[0]);
});
