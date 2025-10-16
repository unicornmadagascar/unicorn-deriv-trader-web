// app.js - Realtime ticks follow + Multiplier live orders (proposal -> buy) + simulation fallback
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
  const multiplierInput = document.getElementById("multiplier");

  // state
  let ws = null;
  let authorized = false;
  let currentSymbol = null;
  let prevPriceMap = {};    // previous price per symbol for direction arrows
  let chartData = [];       // raw price ticks for currentSymbol
  let chartTimes = [];      // epochs for currentSymbol
  let canvas = null, ctx = null;
  let tooltip = null;
  let simInterval = null;
  let openPosition = null; // simulation position
  const volatilitySymbols = ["BOOM1000","BOOM900","BOOM600","BOOM500","BOOM300","CRASH1000","CRASH900","CRASH600","CRASH500"];

  // Gauges smoothing
  let gaugeDefs = [
    { name: "Volatility", smoothed: 0 },
    { name: "ATR", smoothed: 0 },
    { name: "EMA", smoothed: 0 }
  ];
  const GAUGE_ALPHA = 0.18;

  // ensure chartInner positioned
  chartInner.style.position = chartInner.style.position || "relative";

  // tooltip (inside chartInner)
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
  function setStatus(s) { statusSpan.textContent = s; }
  function logHistory(txt) {
    const d = document.createElement("div");
    d.textContent = `${new Date().toLocaleTimeString()} — ${txt}`;
    historyList.prepend(d);
  }

  // Symbol list UI
  function initSymbols() {
    symbolList.innerHTML = "";
    volatilitySymbols.forEach(sym => {
      const div = document.createElement("div");
      div.className = "symbolItem";
      div.id = `symbol-${sym}`;
      div.innerHTML = `<span class="symbolName">${sym}</span> — <span class="symbolValue">➡</span>`;
      div.onclick = () => selectSymbol(sym);
      symbolList.appendChild(div);
    });
  }

  function selectSymbol(sym) {
    currentSymbol = sym;
    document.querySelectorAll(".symbolItem").forEach(el => el.classList.remove("active"));
    const el = document.getElementById(`symbol-${sym}`);
    if (el) el.classList.add("active");
    // reset arrays and redraw
    chartData = []; chartTimes = [];
    logHistory(`Selected ${sym}`);
    initCanvas();
    initGauges();
    // subscribe if ws open and mode=live; otherwise use simulation if simulation mode
    if (ws && ws.readyState === WebSocket.OPEN && modeSelect.value === "live" && authorized) {
      subscribeTicks(sym);
      requestHistory(sym);
    } else {
      // ensure if in simulation mode or no ws we start sim ticks for that symbol
      startSimulation(sym);
    }
  }

  // Canvas & draw functions
  function initCanvas() {
    // keep gaugeDashboard and tooltip around
    chartInner.innerHTML = "";
    if (gaugeDashboard) chartInner.appendChild(gaugeDashboard);
    chartInner.appendChild(tooltip);

    canvas = document.createElement("canvas");
    canvas.style.display = "block";
    canvas.width = chartInner.clientWidth;
    canvas.height = chartInner.clientHeight;
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    chartInner.appendChild(canvas);
    ctx = canvas.getContext("2d");

    canvas.addEventListener("mousemove", handleMouseMove);
    canvas.addEventListener("mouseleave", () => tooltip.style.display = "none");

    // handle resize
    window.addEventListener("resize", () => {
      if (!canvas) return;
      canvas.width = chartInner.clientWidth;
      canvas.height = chartInner.clientHeight;
      drawAll();
    });
  }

  // gauges placed inside #gaugeDashboard
  function initGauges() {
    if (!gaugeDashboard) return;
    gaugeDashboard.innerHTML = "";
    gaugeDefs.forEach(d => {
      const c = document.createElement("canvas");
      c.width = 120; c.height = 120;
      c.dataset.gname = d.name;
      c.style.width = "120px"; c.style.height = "120px";
      gaugeDashboard.appendChild(c);
      d.smoothed = 0;
    });
  }

  function drawAll() {
    drawChart();
    drawAllGauges();
    drawOpenPosition();
  }

  function drawChart() {
    if (!ctx) return;
    const w = canvas.width, h = canvas.height, pad = 50;
    ctx.clearRect(0, 0, w, h);

    if (chartData.length === 0) {
      // empty placeholder
      ctx.fillStyle = "#fafcff";
      ctx.fillRect(0, 0, w, h);
      return;
    }

    // compute min/max
    const maxV = Math.max(...chartData);
    const minV = Math.min(...chartData);
    const range = Math.max(1e-8, maxV - minV);

    // background gradient
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, "#f5f9ff"); bg.addColorStop(1, "#eaf2ff");
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);

    // axes
    ctx.strokeStyle = "#444"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pad, pad); ctx.lineTo(pad, h - pad); ctx.lineTo(w - pad, h - pad); ctx.stroke();

    // grid + y labels
    ctx.strokeStyle = "#ddd"; ctx.lineWidth = 0.7; ctx.fillStyle = "#333"; ctx.font = "11px Arial"; ctx.textAlign = "right"; ctx.textBaseline = "middle";
    for (let i = 0; i <= 5; i++) {
      const y = h - pad - (i / 5) * (h - pad * 2);
      ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(w - pad, y); ctx.stroke();
      ctx.fillText((minV + (i / 5) * (range)).toFixed(2), pad - 8, y);
    }

    // area path (no smoothing)
    const len = chartData.length;
    ctx.beginPath();
    for (let i = 0; i < len; i++) {
      const x = pad + (i / (len - 1 || 1)) * (w - pad * 2);
      const y = h - pad - ((chartData[i] - minV) / range) * (h - pad * 2);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.lineTo(w - pad, h - pad); ctx.lineTo(pad, h - pad); ctx.closePath();
    const g = ctx.createLinearGradient(0, pad, 0, h - pad);
    g.addColorStop(0, "rgba(0,123,255,0.42)"); g.addColorStop(1, "rgba(0,123,255,0.06)");
    ctx.fillStyle = g; ctx.fill();

    // line
    ctx.beginPath();
    for (let i = 0; i < len; i++) {
      const x = pad + (i / (len - 1 || 1)) * (w - pad * 2);
      const y = h - pad - ((chartData[i] - minV) / range) * (h - pad * 2);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = "#007bff"; ctx.lineWidth = 2; ctx.stroke();

    // current price line + label
    const last = chartData[len - 1];
    const yPrice = h - pad - ((last - minV) / range) * (h - pad * 2);
    ctx.strokeStyle = "red"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(pad, yPrice); ctx.lineTo(w - pad, yPrice); ctx.stroke();
    ctx.fillStyle = "red"; ctx.beginPath(); ctx.arc(w - pad - 12, yPrice, 5, 0, Math.PI * 2); ctx.fill();
    ctx.font = "14px Arial"; ctx.fillStyle = "#111"; ctx.textAlign = "left";
    ctx.fillText(last.toFixed(2), w - pad - 68, yPrice - 6);
  }

  // gauges drawing
  function drawAllGauges() {
    if (!gaugeDashboard) return;
    const canvases = Array.from(gaugeDashboard.querySelectorAll("canvas"));
    canvases.forEach((c, idx) => {
      const def = gaugeDefs[idx];
      if (!def) return;
      let raw = 0;
      if (def.name === "Volatility") raw = computeVolatility();
      else if (def.name === "ATR") raw = computeATR();
      else if (def.name === "EMA") raw = computeEMApercent();
      raw = Math.max(0, Math.min(100, raw));
      def.smoothed = (def.smoothed || 0) * (1 - GAUGE_ALPHA) + raw * GAUGE_ALPHA;
      drawGaugeCanvas(c, def.smoothed, def.name);
    });
  }

  function drawGaugeCanvas(canvasEl, value, title) {
    const gtx = canvasEl.getContext("2d");
    const W = canvasEl.width, H = canvasEl.height, cx = W / 2, cy = H / 2, radius = Math.min(W, H) / 2 - 12;
    gtx.clearRect(0, 0, W, H);
    // background ring
    gtx.beginPath(); gtx.arc(cx, cy, radius, 0, Math.PI * 2); gtx.strokeStyle = "#eee"; gtx.lineWidth = 12; gtx.stroke();
    // progress
    const end = (value / 100) * Math.PI * 2;
    gtx.beginPath(); gtx.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + end, false);
    const grad = gtx.createLinearGradient(0, 0, W, H); grad.addColorStop(0, "#3b82f6"); grad.addColorStop(1, "#2563eb");
    gtx.strokeStyle = grad; gtx.lineWidth = 12; gtx.lineCap = "round"; gtx.stroke();
    // text
    gtx.fillStyle = "#222"; gtx.font = "12px Arial"; gtx.textAlign = "center"; gtx.textBaseline = "middle";
    gtx.fillText(title, cx, cy - 8); gtx.fillText(value.toFixed(1) + "%", cx, cy + 12);
  }

  // metrics
  function computeVolatility(N = 50) {
    if (chartData.length < 2) return 0;
    const arr = chartData.slice(-N);
    const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
    if (!isFinite(mean) || mean === 0) return 0;
    const variance = arr.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / arr.length;
    const sd = Math.sqrt(variance);
    return Math.min((sd / Math.abs(mean)) * 100, 100);
  }
  function computeATR(N = 50) {
    if (chartData.length < 2) return 0;
    const arr = chartData.slice(-N);
    let sum = 0;
    for (let i = 0; i < arr.length - 1; i++) sum += Math.abs(arr[i + 1] - arr[i]);
    const avg = sum / Math.max(1, arr.length - 1);
    const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
    if (!isFinite(mean) || mean === 0) return 0;
    return Math.min((avg / Math.abs(mean)) * 100, 100);
  }
  function computeEMApercent(period = 20) {
    if (chartData.length < 2) return 0;
    const P = Math.min(period, chartData.length);
    let ema = chartData[chartData.length - P];
    const k = 2 / (P + 1);
    for (let i = chartData.length - P + 1; i < chartData.length; i++) {
      ema = chartData[i] * k + ema * (1 - k);
    }
    const last = chartData[chartData.length - 1] || 1;
    return Math.min(Math.abs((ema - last) / Math.abs(last)) * 100, 100);
  }

  // draw open simulated position on chart
  function drawOpenPosition() {
    if (!ctx || !openPosition || chartData.length === 0) return;
    const w = canvas.width, h = canvas.height, pad = 50;
    const maxV = Math.max(...chartData), minV = Math.min(...chartData), range = Math.max(1e-8, maxV - minV);
    const entry = openPosition.entry;
    const y = h - pad - ((entry - minV) / range) * (h - pad * 2);
    ctx.save();
    ctx.fillStyle = openPosition.type === "BUY" ? "green" : "orange";
    ctx.beginPath();
    ctx.moveTo(pad + 8, y);
    ctx.lineTo(pad + 24, y - 8);
    ctx.lineTo(pad + 24, y + 8);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#111"; ctx.font = "12px Arial";
    ctx.fillText(`${openPosition.type} ${openPosition.qty}@${entry.toFixed(2)}`, pad + 28, y + 4);
    ctx.restore();
  }

  // tooltip index mapping
  function handleMouseMove(e) {
    if (!canvas || chartData.length === 0) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pad = 50;
    const w = canvas.width - pad * 2;
    const len = chartData.length;
    if (len === 0) return;
    const ratio = (x - pad) / (w || 1);
    let idx = Math.round(ratio * (len - 1));
    idx = Math.max(0, Math.min(idx, len - 1));
    const price = chartData[idx];
    const tEpoch = chartTimes[idx];
    const tLabel = tEpoch ? new Date(tEpoch * 1000).toLocaleTimeString().slice(0, 8) : "";
    tooltip.innerHTML = `<b>${currentSymbol || ""}</b><br>Price: <b>${price.toFixed(2)}</b><br><span style="opacity:0.9">${tLabel}</span>`;
    // place tooltip inside chartInner
    const chartRect = chartInner.getBoundingClientRect();
    let left = e.clientX - chartRect.left + 12;
    let top = e.clientY - chartRect.top - 28;
    if (left + tooltip.offsetWidth > chartInner.clientWidth - 8) left = chartInner.clientWidth - tooltip.offsetWidth - 8;
    if (left < 8) left = 8;
    if (top + tooltip.offsetHeight > chartInner.clientHeight - 8) top = chartInner.clientHeight - tooltip.offsetHeight - 8;
    if (top < 8) top = 8;
    tooltip.style.left = `${left}px`; tooltip.style.top = `${top}px`; tooltip.style.display = "block";
  }

  // ----- WebSocket logic -----
  connectBtn.addEventListener("click", () => {
    const token = tokenInput.value.trim();
    if (ws && ws.readyState === WebSocket.OPEN) ws.close();
    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      setStatus("Connected");
      logHistory("WS connected");
      if (token) {
        ws.send(JSON.stringify({ authorize: token }));
      } else {
        // no token: still allow ticks if available, but trading needs auth
        initSymbols(); // populate list
        logHistory("No token: using simulation or public ticks");
      }
    };

    ws.onmessage = (msg) => {
      let data;
      try { data = JSON.parse(msg.data); } catch (e) { return; }
      handleWsMessage(data);
    };

    ws.onclose = () => setStatus("Disconnected");
    ws.onerror = () => setStatus("WS error");
  });

  function handleWsMessage(data) {
    if (!data) return;

    // authorize response
    if (data.msg_type === "authorize") {
      if (data.error) {
        logHistory("Authorize error: " + (data.error?.message || JSON.stringify(data.error)));
        setStatus("Auth failed (simulation)");
        authorized = false;
        initSymbols();
        return;
      }
      authorized = true;
      setStatus(`Authorized: ${data.authorize?.loginid || ""}`);
      logHistory("Authorized");
      initSymbols();
      // get balance
      ws.send(JSON.stringify({ balance: 1, subscribe: 1 }));
      return;
    }

    // balance update
    if (data.msg_type === "balance" && data.balance?.balance != null) {
      userBalance.textContent = `Balance: ${parseFloat(data.balance.balance).toFixed(2)} USD`;
      return;
    }

    // proposal response (we will buy if passthrough indicates our proposal)
    if (data.msg_type === "proposal" || data.proposal) {
      // If we included passthrough action 'mult_proposal' we can detect
      const passth = data.echo_req?.passthrough || (data.proposal && data.proposal.passthrough) || data.passthrough;
      // buy automatically when proposal matches our passthrough
      if (passth && passth.action === "mult_proposal") {
        // data.proposal should contain id and ask_price
        const prop = data.proposal || data;
        const id = prop.id || prop.proposal_id;
        const ask = prop.ask_price || prop.proposal?.ask_price;
        if (id) {
          // send buy by id (some endpoints accept buy: id)
          const buyReq = { buy: id, price: ask };
          ws.send(JSON.stringify(buyReq));
          logHistory(`Sent buy for proposal id=${id} price=${ask}`);
        } else {
          logHistory("Proposal received but no id — cannot buy automatically");
        }
      }
      return;
    }

    // buy response
    if (data.msg_type === "buy" || data.buy) {
      const resp = data.buy || data;
      logHistory(`Buy response received. Contract id: ${resp.contract_id || resp.buy_id || 'n/a'}`);
      // optional: subscribe to proposal_open_contract updates if you want live PnL
      return;
    }

    // history (ticks_history)
    if ((data.msg_type === "history" || data.history) && data.history && data.history.prices) {
      const prices = data.history.prices.map(p => Number(p));
      const times = data.history.times.map(t => Math.floor(Number(t)));
      const reqSym = data.echo_req?.ticks_history || (data.history?.symbol) || null;
      // if it matches currentSymbol (or if no currentSymbol set), populate chartData
      if (!currentSymbol || reqSym === currentSymbol) {
        chartData = prices.slice(-300);
        chartTimes = times.slice(-300);
        drawAll();
      }
      return;
    }

    // tick streaming
    if (data.msg_type === "tick" && data.tick) {
      const t = data.tick;
      const sym = t.symbol;
      const price = Number(t.quote);

      // compute arrow using prevPriceMap BEFORE update
      const prev = prevPriceMap[sym];
      const el = document.getElementById(`symbol-${sym}`);
      if (el) {
        const span = el.querySelector(".symbolValue");
        let dir = "➡", color = "#666";
        if (prev !== undefined) {
          if (price > prev) { dir = "🔼"; color = "green"; }
          else if (price < prev) { dir = "🔽"; color = "red"; }
        }
        span.textContent = dir; span.style.color = color;
      }
      prevPriceMap[sym] = price; // update prev map

      // If this tick is for the currently selected symbol, append EXACT tick to chart (no filtering)
      if (sym === currentSymbol) {
        chartData.push(price);
        chartTimes.push(t.epoch);
        if (chartData.length > 300) { chartData.shift(); chartTimes.shift(); }
        drawAll(); // immediate redraw so BOOM1000 will follow real ticks
      }
      return;
    }
  }

  // subscribe ticks & request history
  function subscribeTicks(sym) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ ticks: sym, subscribe: 1 }));
    logHistory(`Subscribed ticks: ${sym}`);
  }
  function requestHistory(sym) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      startSimulation(sym);
      return;
    }
    ws.send(JSON.stringify({ ticks_history: sym, end: "latest", count: 300, style: "ticks" }));
    logHistory(`Requested history: ${sym}`);
  }

  // simulation random-walk fallback (only used when no WS or in simulation mode)
  function startSimulation(sym) {
    stopSimulation();
    let base = prevPriceMap[sym] || (1000 + Math.random() * 20);
    simInterval = setInterval(() => {
      base += (Math.random() - 0.5) * 2; // keep ticks realistic
      const epoch = Math.floor(Date.now() / 1000);
      if (sym === currentSymbol) {
        chartData.push(base); chartTimes.push(epoch);
        if (chartData.length > 300) { chartData.shift(); chartTimes.shift(); }
        drawAll();
      }
      // update symbol arrow
      const el = document.getElementById(`symbol-${sym}`);
      if (el) {
        const span = el.querySelector(".symbolValue");
        const prev = prevPriceMap[sym] || base;
        let dir = "➡", color = "#666";
        if (base > prev) { dir = "🔼"; color = "green"; }
        else if (base < prev) { dir = "🔽"; color = "red"; }
        span.textContent = dir; span.style.color = color;
      }
      prevPriceMap[sym] = base;
    }, 900);
    logHistory(`Simulation started for ${sym}`);
  }
  function stopSimulation() { if (simInterval) { clearInterval(simInterval); simInterval = null; } }

  // Place a Multiplier proposal (live). typeStr: "MULTUP" or "MULTDOWN"
  function placeMultiplierProposal(typeStr, stake, symbol, multiplier) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      logHistory("WS not open - cannot place live order");
      return;
    }
    if (!authorized) {
      logHistory("Not authorized - cannot place live order");
      return;
    }
    const passthrough = { action: "mult_proposal", contract_type: typeStr, symbol, amount: stake, multiplier };
    const req = {
      proposal: 1,
      amount: stake,
      contract_type: typeStr,
      symbol: symbol,
      basis: "stake",
      passthrough
    };
    if (multiplier) req.multiplier = Number(multiplier);
    ws.send(JSON.stringify(req));
    logHistory(`Sent multiplier proposal: ${typeStr} ${symbol} stake=${stake} x${multiplier}`);
  }

  // Trading UI handlers
  buyBtn.addEventListener("click", () => {
    const stake = Number(stakeInput?.value) || 1;
    const lot = Number(lotInput?.value) || 1;
    const mult = Number(multiplierInput?.value) || 1;
    if (modeSelect && modeSelect.value === "live") {
      // Live multiplier BUY (MULTUP)
      if (!currentSymbol) { logHistory("Select symbol first"); return; }
      if (!authorized) { logHistory("Authorize first (token)"); return; }
      placeMultiplierProposal("MULTUP", stake, currentSymbol, mult);
      return;
    }
    // simulation buy
    if (!currentSymbol || chartData.length === 0) { logHistory("No symbol / no data"); return; }
    const price = chartData[chartData.length - 1];
    openPosition = { type: "BUY", symbol: currentSymbol, qty: lot, stake, entry: price, time: Date.now() };
    logHistory(`SIM BUY ${lot} ${currentSymbol} @ ${price.toFixed(2)} stake=${stake}`);
    drawAll();
  });

  sellBtn.addEventListener("click", () => {
    const stake = Number(stakeInput?.value) || 1;
    const lot = Number(lotInput?.value) || 1;
    const mult = Number(multiplierInput?.value) || 1;
    if (modeSelect && modeSelect.value === "live") {
      if (!currentSymbol) { logHistory("Select symbol first"); return; }
      if (!authorized) { logHistory("Authorize first (token)"); return; }
      placeMultiplierProposal("MULTDOWN", stake, currentSymbol, mult);
      return;
    }
    if (!currentSymbol || chartData.length === 0) { logHistory("No symbol / no data"); return; }
    const price = chartData[chartData.length - 1];
    openPosition = { type: "SELL", symbol: currentSymbol, qty: lot, stake, entry: price, time: Date.now() };
    logHistory(`SIM SELL ${lot} ${currentSymbol} @ ${price.toFixed(2)} stake=${stake}`);
    drawAll();
  });

  closeBtn.addEventListener("click", () => {
    if (!openPosition) { logHistory("No open simulated position"); return; }
    if (chartData.length === 0) { logHistory("No tick to close with"); return; }
    const exit = chartData[chartData.length - 1];
    const diff = openPosition.type === "BUY" ? (exit - openPosition.entry) : (openPosition.entry - exit);
    const pnl = diff * openPosition.qty * (openPosition.stake || 1);
    logHistory(`SIM CLOSE ${openPosition.type} ${openPosition.symbol} entry=${openPosition.entry.toFixed(2)} exit=${exit.toFixed(2)} PnL=${pnl.toFixed(2)}`);
    openPosition = null;
    drawAll();
  });

  // init UI
  initSymbols();
  setStatus("Ready — connect (token optional) or use simulation");
  // auto select first symbol to show chart
  if (volatilitySymbols.length) selectSymbol(volatilitySymbols[0]);

  // small periodic redraw (keeps gauges smooth)
  setInterval(() => {
    drawAll();
  }, 700);
});
