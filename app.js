// app.js - Unicorn Madagascar (Canvas + Multipliers minimal flow)
document.addEventListener("DOMContentLoaded", () => {
  const APP_ID = 105747;
  const WS_URL = `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;

  // UI
  const tokenInput = document.getElementById("tokenInput");
  const connectBtn = document.getElementById("connectBtn");
  const statusSpan = document.getElementById("status");
  const userBalance = document.getElementById("userBalance");
  const symbolList = document.getElementById("symbolList");
  const chartInner = document.getElementById("chartInner");
  const gaugeDashboard = document.getElementById("gaugeDashboard");
  const buyBtn = document.getElementById("buyBtn");
  const sellBtn = document.getElementById("sellBtn");
  const closeBtn = document.getElementById("closeBtn");
  const historyList = document.getElementById("historyList");
  const stakeInput = document.getElementById("stake");
  const multiplierInput = document.getElementById("multiplier");
  const modeSelect = document.getElementById("modeSelect");
  const pnlDisplay = document.getElementById("pnl");

  // State
  let ws = null;
  let currentSymbol = null;
  let lastPrices = {};
  let chartData = [];
  let chartTimes = [];
  let canvas, ctx;
  let authorized = false;
  let trades = []; // trades: {symbol,type,stake,multiplier,entry,index,timestamp,proposal_id,contract_id}
  let proposalMap = {}; // map echo / proposal id => request metadata (if needed)

  const volatilitySymbols = ["BOOM1000","BOOM900","BOOM600","BOOM500","BOOM300","CRASH1000","CRASH900","CRASH600","CRASH500"];

  // Tooltip (attached to chartInner; chartInner is position:relative in your CSS)
  const tooltip = document.createElement("div");
  tooltip.style.position = "absolute";
  tooltip.style.padding = "6px 10px";
  tooltip.style.background = "rgba(0,0,0,0.8)";
  tooltip.style.color = "#fff";
  tooltip.style.fontSize = "12px";
  tooltip.style.borderRadius = "4px";
  tooltip.style.pointerEvents = "none";
  tooltip.style.display = "none";
  tooltip.style.zIndex = 9999;
  chartInner.appendChild(tooltip);

  // --- Helpers ---
  function logHistory(txt){
    const div = document.createElement("div");
    div.textContent = `${new Date().toLocaleTimeString()} — ${txt}`;
    historyList.prepend(div);
  }
  function setStatus(txt){ statusSpan.textContent = txt; }
  function formatTimeEpoch(epoch){
    try { return new Date(epoch*1000).toLocaleTimeString().slice(0,8); } catch { return ""; }
  }

  // --- Symbols ---
  function initSymbols(){
    symbolList.innerHTML = "";
    volatilitySymbols.forEach(sym=>{
      const div = document.createElement("div");
      div.className = "symbolItem";
      div.id = `symbol-${sym}`;
      div.textContent = sym;
      div.onclick = () => selectSymbol(sym);
      symbolList.appendChild(div);
    });
  }

  function selectSymbol(symbol){
    currentSymbol = symbol;
    document.querySelectorAll(".symbolItem").forEach(el => el.classList.remove("active"));
    const sel = document.getElementById(`symbol-${symbol}`);
    if(sel) sel.classList.add("active");
    chartData = [];
    chartTimes = [];
    initCanvas();
    initGauges();
    subscribeTicks(symbol);
    logHistory(`Selected ${symbol}`);
  }

  // --- Canvas Chart ---
  function initCanvas(){
    chartInner.innerHTML = "";
    // gauge dashboard must remain in DOM: re-append container
    const gd = document.getElementById("gaugeDashboard");
    if(gd){
      chartInner.appendChild(gd);
      // move gaugeDashboard to top-right by CSS already
    }

    canvas = document.createElement("canvas");
    // make canvas full width of chartInner
    canvas.width = chartInner.clientWidth;
    canvas.height = chartInner.clientHeight;
    canvas.style.position = "absolute";
    canvas.style.left = "0";
    canvas.style.top = "0";
    chartInner.appendChild(canvas);
    ctx = canvas.getContext("2d");

    // mouse handling relative to chartInner
    canvas.addEventListener("mousemove", handleMouseMove);
    canvas.addEventListener("mouseleave", () => tooltip.style.display = "none");
    window.addEventListener("resize", () => {
      // keep canvas synced with container
      if(chartInner && canvas){
        canvas.width = chartInner.clientWidth;
        canvas.height = chartInner.clientHeight;
        drawChart();
      }
    });
  }

  // --- Chart drawing: area gradient + line + current tick label + trades markers
  function drawChart(){
    if(!ctx) return;
    // if no data, clear and return
    if(chartData.length === 0){
      ctx.clearRect(0,0,canvas.width,canvas.height);
      return;
    }

    const padding = 50;
    const w = canvas.width - padding*2;
    const h = canvas.height - padding*2;
    ctx.clearRect(0,0,canvas.width,canvas.height);

    // Background subtle
    const bgGrad = ctx.createLinearGradient(0,0,0,canvas.height);
    bgGrad.addColorStop(0, "#f9faff");
    bgGrad.addColorStop(1, "#e6f0ff");
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0,0,canvas.width,canvas.height);

    const maxVal = Math.max(...chartData);
    const minVal = Math.min(...chartData);
    const range = Math.max( (maxVal - minVal), 1e-8 );

    // Axes
    ctx.strokeStyle = "#444";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding, padding);
    ctx.lineTo(padding, canvas.height - padding);
    ctx.lineTo(canvas.width - padding, canvas.height - padding);
    ctx.stroke();

    // Grid Y labels
    ctx.strokeStyle = "#ddd";
    ctx.lineWidth = 0.8;
    ctx.fillStyle = "#555";
    ctx.font = "12px Inter, Arial";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for(let i=0;i<=5;i++){
      const y = canvas.height - padding - (i/5)*h;
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(canvas.width - padding, y);
      ctx.stroke();
      const val = (minVal + (i/5)* (maxVal - minVal));
      ctx.fillText(val.toFixed(2), padding - 10, y);
    }

    // Grid X labels (sparse)
    const len = chartData.length;
    const stepX = Math.max(1, Math.ceil(len/5));
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for(let i=0;i<len;i+=stepX){
      const x = padding + (i/(len-1))*w;
      ctx.beginPath();
      ctx.moveTo(x,padding);
      ctx.lineTo(x,canvas.height-padding);
      ctx.stroke();
      ctx.fillText(chartTimes[i] ? formatTimeEpoch(chartTimes[i]) : "", x, canvas.height - padding + 5);
    }

    // Area path (no smoothing) - fill with gradient
    ctx.beginPath();
    chartData.forEach((val,i)=>{
      const x = padding + (i/(len-1))*w;
      const y = canvas.height - padding - ((val - minVal)/range)*h;
      if(i===0) ctx.moveTo(x,y);
      else ctx.lineTo(x,y);
    });
    ctx.lineTo(canvas.width - padding, canvas.height - padding);
    ctx.lineTo(padding, canvas.height - padding);
    ctx.closePath();
    const fillGrad = ctx.createLinearGradient(0,padding,0,canvas.height-padding);
    fillGrad.addColorStop(0, "rgba(0,123,255,0.35)");
    fillGrad.addColorStop(1, "rgba(0,123,255,0.06)");
    ctx.fillStyle = fillGrad;
    ctx.fill();

    // Line on top
    ctx.beginPath();
    chartData.forEach((val,i)=>{
      const x = padding + (i/(len-1))*w;
      const y = canvas.height - padding - ((val - minVal)/range)*h;
      if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    });
    ctx.strokeStyle = "#007bff";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Draw trades: arrow, dotted horizontal line, label. Use stored trade.index for precise x; if missing, approximate at current end.
    trades.forEach(tr => {
      if(tr.symbol !== currentSymbol) return;
      const idx = (typeof tr.index === "number") ? Math.max(0, Math.min(tr.index, chartData.length-1)) : (chartData.length - 1);
      const x = padding + (idx/(len-1))*w;
      const y = canvas.height - padding - ((tr.entry - minVal)/range)*h;

      // dotted line
      ctx.setLineDash([6,4]);
      ctx.strokeStyle = "rgba(200,30,30,0.9)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(canvas.width - padding, y);
      ctx.stroke();
      ctx.setLineDash([]);

      // arrow head
      ctx.fillStyle = tr.type === "BUY" ? "green" : "red";
      ctx.beginPath();
      if(tr.type === "BUY"){
        // upward arrow
        ctx.moveTo(x, y - 10);
        ctx.lineTo(x - 7, y + 4);
        ctx.lineTo(x + 7, y + 4);
      } else {
        // downward arrow
        ctx.moveTo(x, y + 10);
        ctx.lineTo(x - 7, y - 4);
        ctx.lineTo(x + 7, y - 4);
      }
      ctx.closePath();
      ctx.fill();

      // price label near arrow
      ctx.fillStyle = "#c62828";
      ctx.font = "12px Inter, Arial";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(tr.entry.toFixed(2), x + 10, y);
    });

    // Current tick line + label (green)
    const currentPrice = chartData[len - 1];
    const yCur = canvas.height - padding - ((currentPrice - minVal)/range)*h;
    ctx.strokeStyle = "green";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(padding, yCur);
    ctx.lineTo(canvas.width - padding, yCur);
    ctx.stroke();

    ctx.fillStyle = "green";
    ctx.font = "13px Inter, Arial";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(currentPrice.toFixed(2), canvas.width - padding, yCur - 10);
  }

  // --- Tooltip handling (over chart) ---
  function handleMouseMove(e){
    if(!canvas || chartData.length === 0) return;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const padding = 50;
    const w = canvas.width - padding*2;
    const len = chartData.length;
    let nearestIndex = Math.round((mouseX - padding)/w*(len-1));
    nearestIndex = Math.max(0, Math.min(nearestIndex, len-1));
    const price = chartData[nearestIndex];
    const time = chartTimes[nearestIndex] ? formatTimeEpoch(chartTimes[nearestIndex]) : "";

    // collect trades for currentSymbol at/near that index (allow approximate)
    const tradeLines = trades.filter(t=>t.symbol===currentSymbol).map(t=>{
      const idx = (typeof t.index === "number") ? t.index : (chartData.length - 1);
      return `${t.type} @ ${t.entry.toFixed(2)} mult:${t.multiplier} idx:${idx}`;
    });

    let html = `<strong>${currentSymbol}</strong><br>Price: ${price.toFixed(2)}<br>Time: ${time}`;
    if(tradeLines.length) html += "<br><br><strong>Trades</strong><br>" + tradeLines.join("<br>");

    tooltip.style.display = "block";
    // position tooltip inside chartInner: ensure not overflow
    const left = Math.min(chartInner.clientWidth - 140, e.clientX - rect.left + 15);
    const top = Math.max(8, e.clientY - rect.top - 30);
    tooltip.style.left = left + "px";
    tooltip.style.top = top + "px";
    tooltip.innerHTML = html;
  }

  // --- Gauges ---
  function initGauges(){
    gaugeDashboard.innerHTML = "";
    ["Volatility","ATR","EMA"].forEach(name=>{
      const c = document.createElement("canvas");
      c.width = 120;
      c.height = 120;
      c.dataset.gaugeName = name;
      c.style.marginRight = "10px";
      gaugeDashboard.appendChild(c);
    });
  }

  function drawGauges(){
    const canvases = gaugeDashboard.querySelectorAll("canvas");
    canvases.forEach(c=>{
      let value = 0;
      if(c.dataset.gaugeName === "Volatility") value = calculateVolatility();
      else if(c.dataset.gaugeName === "ATR") value = calculateATR();
      else if(c.dataset.gaugeName === "EMA") value = calculateEMA();
      // smooth value a bit (exponential smoothing) to avoid very noisy needle
      const smoothed = (c._last == null) ? value : (0.7*c._last + 0.3*value);
      c._last = smoothed;
      drawGauge(c, smoothed);
    });
  }

  function drawGauge(canvas, value){
    const gctx = canvas.getContext("2d");
    const w = canvas.width, h = canvas.height, radius = Math.min(w,h)/2 - 12;
    gctx.clearRect(0,0,w,h);
    // background ring
    gctx.beginPath();
    gctx.arc(w/2, h/2, radius, 0, 2*Math.PI);
    gctx.strokeStyle = "#eee";
    gctx.lineWidth = 12;
    gctx.stroke();
    // progress arc
    const endAngle = (value/100) * 2 * Math.PI;
    gctx.beginPath();
    gctx.arc(w/2, h/2, radius, -Math.PI/2, -Math.PI/2 + endAngle);
    gctx.strokeStyle = "#2563eb";
    gctx.lineWidth = 12;
    gctx.stroke();
    // text
    gctx.fillStyle = "#333";
    gctx.font = "12px Inter, Arial";
    gctx.textAlign = "center";
    gctx.textBaseline = "middle";
    gctx.fillText(canvas.dataset.gaugeName, w/2, h/2 - 10);
    gctx.fillText(value.toFixed(1) + "%", w/2, h/2 + 12);
  }

  // --- Gauge calculations (raw from ticks) ---
  function calculateVolatility(){
    if(chartData.length < 2) return 0;
    const lastN = chartData.slice(-20);
    const max = Math.max(...lastN);
    const min = Math.min(...lastN);
    const cur = chartData[chartData.length - 1] || max;
    return Math.abs((max - min) / Math.max(cur, 1e-8)) * 100;
  }
  function calculateATR(){
    if(chartData.length < 2) return 0;
    const N = Math.min(chartData.length-1, 20);
    let trSum = 0;
    for(let i = chartData.length - N; i < chartData.length; i++){
      trSum += Math.abs(chartData[i] - chartData[i-1] || 0);
    }
    const avg = trSum / Math.max(N,1);
    const scale = Math.max(...chartData) || 1;
    return (avg / scale) * 100;
  }
  function calculateEMA(period = 20){
    if(chartData.length < 2) return 0;
    const k = 2/(period+1);
    let ema = chartData[Math.max(0, chartData.length - period)] || chartData[0];
    for(let i = Math.max(1, chartData.length - period + 1); i < chartData.length; i++){
      ema = chartData[i] * k + ema * (1 - k);
    }
    const scale = Math.max(...chartData) || 1;
    return (ema / scale) * 100;
  }

  // --- Trades: execute simulation or live (Multipliers) ---
  // For live: we send a proposal request, wait for 'proposal' response, then send 'buy' with proposal.id
  function executeTrade(type){
    if(!currentSymbol || chartData.length === 0) return;
    const stake = parseFloat(stakeInput?.value) || 1;
    const multiplier = parseInt(multiplierInput?.value) || 100;
    const mode = modeSelect?.value || "simulation";
    const entry = chartData[chartData.length - 1];
    const index = chartData.length - 1;

    const trade = {
      symbol: currentSymbol,
      type,
      stake,
      multiplier,
      entry,
      index,
      timestamp: Date.now(),
      proposal_id: null,
      contract_id: null
    };

    trades.push(trade);
    logHistory(`${type} ${currentSymbol} @ ${entry.toFixed(2)} stake:${stake} mult:${multiplier}`);

    if(mode === "simulation"){
      // simulate: nothing else (updatePnL will incorporate)
      updatePnL();
    } else if(mode === "live" && ws && authorized){
      // Build a proposal for multipliers:
      // contract_type for Multipliers: MULTUP (for BUY/long) or MULTDOWN (for SELL/short) — server expects these names
      const contract_type = (type === "BUY") ? "MULTUP" : "MULTDOWN";
      // duration/duration_unit are required by proposal — multipliers usually use duration in ticks; we'll request 60 ticks as example
      const proposalReq = {
        proposal: 1,
        amount: stake,
        basis: "stake",
        contract_type,
        currency: "USD",
        symbol: currentSymbol,
        duration: 60,
        duration_unit: "s",
        multiplier: multiplier
      };
      // store a temporary id mapping via an echo_req (optional). We'll include an 'echo' field to identify later responses.
      // Note: Deriv WS returns 'proposal' object when accepted — we'll listen for data.proposal.
      ws.send(JSON.stringify(proposalReq));
      // store pending proposal metadata so we can correlate when buy happens (not strictly necessary)
      // We'll find matching proposal in response and then send buy with proposal.id
    }
  }

  // When receiving a 'proposal' message from server, send 'buy' request using returned 'id' (if user intended to buy)
  function handleProposalResponse(proposal){
    // find the last trade for currentSymbol without proposal_id and buy it
    // (simple heuristic: last pushed trade for that symbol)
    for(let i = trades.length - 1; i >= 0; i--){
      const tr = trades[i];
      if(tr.symbol === proposal.symbol && !tr.proposal_id && !tr.contract_id){
        tr.proposal_id = proposal.id || proposal.proposal_id || proposal.echo_req?.proposal;
        // send buy using proposal.id (Deriv expects {"buy": <proposal.id>})
        if(proposal.id){
          ws.send(JSON.stringify({ buy: proposal.id }));
        } else if(proposal.proposal_id){
          ws.send(JSON.stringify({ buy: proposal.proposal_id }));
        } else if(proposal.echo_req && proposal.echo_req.proposal){
          // fallback - try to buy echo id
          ws.send(JSON.stringify({ buy: proposal.echo_req.proposal }));
        }
        logHistory(`Proposal received for ${proposal.symbol} — sending buy`);
        return;
      }
    }
  }

  // Handle buy response: contains details of purchased contract (or error)
  function handleBuyResponse(buyResp){
    // buyResp.buy may exist, or msg_type 'buy' - server responses vary; we'll check fields
    const payload = buyResp.buy || buyResp;
    // If contains contract_id or transaction, save it to most recent trade
    if(payload && payload.contract_id){
      // find trade by symbol without contract_id
      for(let i = trades.length -1; i>=0; i--){
        if(trades[i].symbol === payload.symbol && !trades[i].contract_id){
          trades[i].contract_id = payload.contract_id;
          logHistory(`Buy success contract_id=${payload.contract_id}`);
          break;
        }
      }
    }
    // If server returned new balance, update UI
    if(payload && payload.balance != null){
      try {
        const bal = parseFloat(payload.balance);
        userBalance.textContent = `Balance: ${bal.toFixed(2)} USD`;
      } catch {}
    }
  }

  function updatePnL(){
    if(chartData.length === 0) return;
    const priceNow = chartData[chartData.length - 1];
    let pnl = 0;
    trades.forEach(tr=>{
      // approximate PnL: difference * stake (not precise multiplier profit model)
      pnl += (tr.type === "BUY") ? (priceNow - tr.entry) * tr.stake : (tr.entry - priceNow) * tr.stake;
    });
    pnlDisplay.textContent = "PnL: " + pnl.toFixed(2);
  }

  buyBtn.onclick = ()=> executeTrade("BUY");
  sellBtn.onclick = ()=> executeTrade("SELL");
  closeBtn.onclick = ()=> {
    trades = [];
    updatePnL();
    logHistory("Closed all simulated trades");
  };

  // --- WebSocket / messages ---
  connectBtn.onclick = ()=>{
    const token = tokenInput.value.trim() || null;
    ws = new WebSocket(WS_URL);
    ws.onopen = ()=>{
      setStatus("Connected to Deriv WebSocket");
      logHistory("WebSocket connected");
      if(token) authorize(token);
      initSymbols();
    };
    ws.onmessage = msg => {
      try {
        const data = JSON.parse(msg.data);
        handleMessage(data);
      } catch (e) {
        console.error("Invalid JSON", e);
      }
    };
    ws.onclose = ()=> setStatus("WebSocket disconnected");
    ws.onerror = ()=> setStatus("WebSocket error");
  };

  function handleMessage(data){
    // authorization
    if(data.msg_type === "authorize"){
      if(data.error){
        logHistory("❌ Invalid token");
        setStatus("Simulation mode");
        return;
      }
      authorized = true;
      setStatus(`Authorized: ${data.authorize?.loginid || "?"}`);
      getBalance();
    }

    // balance update
    if(data.msg_type === "balance" && data.balance?.balance != null){
      userBalance.textContent = `Balance: ${parseFloat(data.balance.balance).toFixed(2)} USD`;
    }

    // proposal response (server sends 'proposal' object)
    if(data.proposal){
      handleProposalResponse(data.proposal);
      return;
    }

    // buy response (server often returns object with 'buy' wrapper)
    if(data.buy){
      handleBuyResponse(data.buy);
      return;
    }
    // sometimes buy response may be top-level
    if(data.msg_type === "buy" || data.contract_id){
      handleBuyResponse(data);
    }

    // tick handling
    if(data.msg_type === "tick" && data.tick?.symbol){
      const tick = data.tick;
      const symbol = tick.symbol;
      const price = Number(tick.quote);
      lastPrices[symbol] = price;
      if(symbol === currentSymbol){
        chartData.push(price);
        chartTimes.push(tick.epoch);
        if(chartData.length > 300){ chartData.shift(); chartTimes.shift(); }
        drawChart();
        drawGauges();
        updatePnL();
      }
    }

    // handle errors or other messages (log)
    if(data.error){
      logHistory("API error: " + (data.error?.message || JSON.stringify(data.error)));
    }
  }

  function authorize(token){
    if(!ws) return;
    ws.send(JSON.stringify({ authorize: token }));
  }
  function getBalance(){
    if(!ws) return;
    ws.send(JSON.stringify({ balance: 1, subscribe: 1 }));
  }
  function subscribeTicks(symbol){
    if(!ws) return;
    // subscribe only if WS is open
    if(ws.readyState === WebSocket.OPEN){
      ws.send(JSON.stringify({ ticks: symbol, subscribe: 1 }));
      // ask for historical ticks to seed chart
      ws.send(JSON.stringify({ ticks_history: symbol, end: "latest", count: 300, style: "ticks" }));
    } else {
      // can't subscribe; still OK - user can connect later
    }
  }

  // Logging helper
  function logHistoryLine(txt){
    const div = document.createElement("div");
    div.textContent = `${new Date().toLocaleTimeString()} — ${txt}`;
    historyList.prepend(div);
  }

  function logHistory(txt){ logHistoryLine(txt); }

  // Init / intervals
  setStatus("Ready. Connect and select a symbol.");
  initSymbols();
  initCanvas();
  initGauges();

  // Update loop for gauges + ensure canvas re-draw occasionally
  setInterval(()=>{
    if(chartData.length > 0){
      drawGauges();
      drawChart();
      updatePnL();
    }
  }, 600);

});
