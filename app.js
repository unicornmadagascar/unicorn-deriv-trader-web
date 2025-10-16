// app.js - Chart (canvas) + gauges + simulation trades (uses elements in your index.html)
document.addEventListener("DOMContentLoaded", () => {
  const APP_ID = 105747;
  const WS_URL = `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;

  // DOM refs
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

  // controls used for trading simulation
  const lotInput = document.getElementById("lot");
  const stakeInput = document.getElementById("stake");
  const modeSelect = document.getElementById("modeSelect");

  // state
  let ws = null;
  let authorized = false;
  let currentSymbol = null;
  let lastPrices = {};
  let chartData = [];   // array of prices (raw ticks)
  let chartTimes = [];  // array of epochs
  let canvas = null, ctx = null;
  let tooltip = null;
  let simulationInterval = null;
  let simulationActive = false;
  let openPosition = null; // {type, symbol, qty, entry, time}
  let gaugeDefs = [
    { name: "Volatility", smoothed: 0 },
    { name: "ATR", smoothed: 0 },
    { name: "EMA", smoothed: 0 }
  ];
  const GAUGE_ALPHA = 0.16; // smoothing for gauge display

  const volatilitySymbols = ["BOOM1000","BOOM900","BOOM600","BOOM500","BOOM300","CRASH1000","CRASH900","CRASH600","CRASH500"];

  // ensure chartInner is positioned for absolute tooltip/gauges
  chartInner.style.position = chartInner.style.position || "relative";

  // tooltip
  tooltip = document.createElement("div");
  tooltip.style.position = "absolute";
  tooltip.style.padding = "6px 10px";
  tooltip.style.background = "rgba(0,0,0,0.78)";
  tooltip.style.color = "#fff";
  tooltip.style.borderRadius = "6px";
  tooltip.style.fontSize = "12px";
  tooltip.style.pointerEvents = "none";
  tooltip.style.display = "none";
  tooltip.style.zIndex = "9999";
  chartInner.appendChild(tooltip);

  // initialize symbol list
  function initSymbolList() {
    symbolList.innerHTML = "";
    volatilitySymbols.forEach(sym => {
      const div = document.createElement("div");
      div.className = "symbolItem";
      div.id = `symbol-${sym}`;
      div.innerHTML = `<span class="symbolName">${sym}</span> — <span class="symbolValue">➡</span>`;
      div.addEventListener("click", () => selectSymbol(sym));
      symbolList.appendChild(div);
    });
  }

  // select symbol
  function selectSymbol(sym) {
    currentSymbol = sym;
    document.querySelectorAll(".symbolItem").forEach(el => el.classList.remove("active"));
    const e = document.getElementById(`symbol-${sym}`);
    if (e) e.classList.add("active");
    logHistory(`Selected ${sym}`);
    initCanvas();        // create/rescale canvas
    initGauges();        // create gauge canvases inside gaugeDashboard
    subscribeTicks(sym);
    requestHistory(sym);
  }

  // initialize canvas (full width inside chartInner)
  function initCanvas() {
    // clear chartInner but keep tooltip and gaugeDashboard appended after clear
    chartInner.innerHTML = "";
    // append gauge dashboard (it's absolute positioned) and tooltip back
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

    // events
    canvas.addEventListener("mousemove", handleMouseMove);
    canvas.addEventListener("mouseleave", () => tooltip.style.display = "none");

    // resize handling
    window.requestAnimationFrame(() => drawFrame()); // initial draw attempt
    window.addEventListener("resize", () => {
      if (!canvas) return;
      canvas.width = chartInner.clientWidth;
      canvas.height = chartInner.clientHeight;
      drawFrame();
    });
  }

  // gauges are rendered as canvas elements inside #gaugeDashboard
  function initGauges() {
    if (!gaugeDashboard) return;
    gaugeDashboard.innerHTML = "";
    gaugeDefs.forEach(d => {
      const c = document.createElement("canvas");
      c.width = 120;
      c.height = 120;
      c.dataset.gaugeName = d.name;
      c.style.width = "120px";
      c.style.height = "120px";
      gaugeDashboard.appendChild(c);
      d.smoothed = 0;
    });
  }

  // draw whole frame: chart + gauges
  function drawFrame() {
    drawChart();
    drawAllGauges();
    drawPositionOnChart();
  }

  // Draw area chart (no smoothing), with gradient and border line and current price line
  function drawChart() {
    if (!ctx || chartData.length === 0) {
      // clear if exists
      if (ctx) {
        ctx.clearRect(0,0,canvas.width,canvas.height);
      }
      return;
    }

    const width = canvas.width;
    const height = canvas.height;
    const padding = 50;
    ctx.clearRect(0, 0, width, height);

    // background
    const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
    bgGrad.addColorStop(0, "#f5f9ff");
    bgGrad.addColorStop(1, "#eaf2ff");
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, width, height);

    // compute min/max
    const maxVal = Math.max(...chartData);
    const minVal = Math.min(...chartData);
    const range = Math.max(1e-8, maxVal - minVal);

    // axes (simple)
    ctx.strokeStyle = "#444";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding, padding);
    ctx.lineTo(padding, height - padding);
    ctx.lineTo(width - padding, height - padding);
    ctx.stroke();

    // grid & Y labels
    ctx.strokeStyle = "#ddd";
    ctx.lineWidth = 0.6;
    ctx.font = "11px Arial";
    ctx.fillStyle = "#333";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let i = 0; i <= 5; i++) {
      const y = height - padding - (i / 5) * (height - padding * 2);
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(width - padding, y);
      ctx.stroke();
      ctx.fillText((minVal + (i / 5) * range).toFixed(2), padding - 8, y);
    }

    // area path
    const len = chartData.length;
    ctx.beginPath();
    for (let i = 0; i < len; i++) {
      const x = padding + (i / (len - 1 || 1)) * (width - padding * 2);
      const y = height - padding - ((chartData[i] - minVal) / range) * (height - padding * 2);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    // close and fill
    ctx.lineTo(width - padding, height - padding);
    ctx.lineTo(padding, height - padding);
    ctx.closePath();
    const areaGrad = ctx.createLinearGradient(0, padding, 0, height - padding);
    areaGrad.addColorStop(0, "rgba(0,123,255,0.45)");
    areaGrad.addColorStop(1, "rgba(0,123,255,0.08)");
    ctx.fillStyle = areaGrad;
    ctx.fill();

    // border line
    ctx.beginPath();
    for (let i = 0; i < len; i++) {
      const x = padding + (i / (len - 1 || 1)) * (width - padding * 2);
      const y = height - padding - ((chartData[i] - minVal) / range) * (height - padding * 2);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = "#007bff";
    ctx.lineWidth = 2;
    ctx.stroke();

    // current price horizontal line + small circle + label
    const lastPrice = chartData[len - 1];
    const yPrice = height - padding - ((lastPrice - minVal) / range) * (height - padding * 2);
    ctx.strokeStyle = "red";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(padding, yPrice);
    ctx.lineTo(width - padding, yPrice);
    ctx.stroke();
    ctx.fillStyle = "red";
    ctx.beginPath();
    ctx.arc(width - padding - 12, yPrice, 5, 0, Math.PI * 2);
    ctx.fill();

    ctx.font = "14px Arial";
    ctx.fillStyle = "#333";
    ctx.textAlign = "left";
    ctx.fillText(lastPrice.toFixed(2), width - padding - 68, yPrice - 6);
  }

  // draw gauges inside gaugeDashboard
  function drawAllGauges() {
    if (!gaugeDashboard) return;
    const canvases = Array.from(gaugeDashboard.querySelectorAll("canvas"));
    canvases.forEach((c, idx) => {
      const g = gaugeDefs[idx];
      if (!g) return;
      // compute raw metric
      let raw = 0;
      if (g.name === "Volatility") raw = computeVolatility();
      else if (g.name === "ATR") raw = computeATR();
      else if (g.name === "EMA") raw = computeEMAPercent();

      raw = Math.max(0, Math.min(raw, 100));
      // smooth
      g.smoothed = (g.smoothed || 0) * (1 - GAUGE_ALPHA) + raw * GAUGE_ALPHA;
      drawGaugeCanvas(c, g.smoothed, g.name);
    });
  }

  // small canvas gauge renderer
  function drawGaugeCanvas(canvasEl, value, title) {
    const gtx = canvasEl.getContext("2d");
    const w = canvasEl.width;
    const h = canvasEl.height;
    gtx.clearRect(0, 0, w, h);
    const radius = Math.min(w, h) / 2 - 12;
    const cx = w / 2, cy = h / 2;

    // background ring
    gtx.beginPath();
    gtx.arc(cx, cy, radius, 0, Math.PI * 2);
    gtx.strokeStyle = "#eee";
    gtx.lineWidth = 12;
    gtx.stroke();

    // progress arc
    const endAngle = (value / 100) * Math.PI * 2;
    gtx.beginPath();
    gtx.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + endAngle, false);
    const grad = gtx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, "#3b82f6");
    grad.addColorStop(1, "#2563eb");
    gtx.strokeStyle = grad;
    gtx.lineWidth = 12;
    gtx.lineCap = "round";
    gtx.stroke();

    // text
    gtx.fillStyle = "#222";
    gtx.font = "12px Arial";
    gtx.textAlign = "center";
    gtx.textBaseline = "middle";
    gtx.fillText(title, cx, cy - 8);
    gtx.fillText(value.toFixed(1) + "%", cx, cy + 12);
  }

  // compute volatility = stddev / mean * 100 of last N ticks
  function computeVolatility(N = 50) {
    if (chartData.length < 2) return 0;
    const arr = chartData.slice(-N);
    const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
    if (!isFinite(mean) || mean === 0) return 0;
    const variance = arr.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / arr.length;
    const stddev = Math.sqrt(variance);
    return Math.min((stddev / Math.abs(mean)) * 100, 100);
  }

  // compute ATR-like = avg(|diff|)/mean * 100
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

  // compute EMA percent diff: |EMA - last| / last * 100
  function computeEMAPercent(period = 20) {
    if (chartData.length < 2) return 0;
    const P = Math.min(period, chartData.length);
    // compute EMA using normal recursive formula
    let ema = chartData[chartData.length - P];
    const k = 2 / (P + 1);
    for (let i = chartData.length - P + 1; i < chartData.length; i++) {
      ema = chartData[i] * k + ema * (1 - k);
    }
    const last = chartData[chartData.length - 1] || 1;
    return Math.min(Math.abs((ema - last) / Math.abs(last)) * 100, 100);
  }

  // draw open position marker (arrow + label) on chart
  function drawPositionOnChart() {
    if (!ctx || !openPosition || chartData.length === 0) return;
    const width = canvas.width, height = canvas.height, padding = 50;
    const maxVal = Math.max(...chartData);
    const minVal = Math.min(...chartData);
    const range = Math.max(1e-8, maxVal - minVal);
    const entry = openPosition.entry;
    const yEntry = height - padding - ((entry - minVal) / range) * (height - padding * 2);
    // arrow
    ctx.save();
    ctx.fillStyle = openPosition.type === "BUY" ? "green" : "orange";
    ctx.beginPath();
    // small triangle at left side
    ctx.moveTo(padding + 8, yEntry);
    ctx.lineTo(padding + 22, yEntry - 8);
    ctx.lineTo(padding + 22, yEntry + 8);
    ctx.closePath();
    ctx.fill();
    // label
    ctx.font = "12px Arial";
    ctx.fillStyle = "#111";
    ctx.fillText(`${openPosition.type} ${openPosition.qty}@${entry.toFixed(2)}`, padding + 28, yEntry + 4);
    ctx.restore();
  }

  // tooltip handling (index clamped)
  function handleMouseMove(e) {
    if (!canvas || chartData.length === 0) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const padding = 50;
    const w = canvas.width - padding * 2;
    const len = chartData.length;
    if (len === 0) return;
    const ratio = (x - padding) / (w || 1);
    let idx = Math.round(ratio * (len - 1));
    idx = Math.max(0, Math.min(idx, len - 1));
    const price = chartData[idx];
    const tEpoch = chartTimes[idx];
    const tLabel = tEpoch ? new Date(tEpoch * 1000).toLocaleTimeString().slice(0,8) : "";
    tooltip.innerHTML = `<b>${currentSymbol || ""}</b><br>Price: <b>${price.toFixed(2)}</b><br><span style="opacity:0.9">${tLabel}</span>`;
    // position tooltip inside chartInner bounding box
    const chartRect = chartInner.getBoundingClientRect();
    let left = e.clientX - chartRect.left + 12;
    let top = e.clientY - chartRect.top - 28;
    // clamp
    const maxLeft = chartInner.clientWidth - tooltip.offsetWidth - 8;
    if (left > maxLeft) left = maxLeft;
    if (left < 8) left = 8;
    const maxTop = chartInner.clientHeight - tooltip.offsetHeight - 8;
    if (top > maxTop) top = maxTop;
    if (top < 8) top = 8;
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
    tooltip.style.display = "block";
  }

  // log trade history
  function logHistory(txt) {
    const el = document.createElement("div");
    el.textContent = `${new Date().toLocaleTimeString()} — ${txt}`;
    historyList.prepend(el);
  }

  // WebSocket connect & handlers
  connectBtn.addEventListener("click", () => {
    const token = (tokenInput && tokenInput.value) ? tokenInput.value.trim() : null;
    // if already connected close first
    try { if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) ws.close(); } catch(e){}

    ws = new WebSocket(WS_URL);
    ws.onopen = () => {
      setStatus("Connected");
      logHistory("WebSocket connected");
      if (token) {
        ws.send(JSON.stringify({ authorize: token }));
      } else {
        // we still open socket (no auth) — but if user switches to simulation use simulation
        setStatus("Connected (no token)");
        initSymbolList();
      }
    };
    ws.onmessage = msg => {
      let data;
      try { data = JSON.parse(msg.data); } catch(e) { return; }
      handleWsMessage(data);
    };
    ws.onclose = () => setStatus("Disconnected");
    ws.onerror = () => setStatus("Connection error");
  });

  function handleWsMessage(data) {
    // authorize response
    if (data.msg_type === "authorize") {
      if (data.error) {
        logHistory("Invalid token — simulation mode");
        setStatus("Simulation mode");
        initSymbolList();
        return;
      }
      authorized = true;
      setStatus(`Authorized: ${data.authorize.loginid}`);
      initSymbolList();
      // request balance
      ws.send(JSON.stringify({ balance: 1, subscribe: 1 }));
    }

    // balance update
    if (data.msg_type === "balance" && data.balance?.balance != null) {
      userBalance.textContent = `Balance: ${parseFloat(data.balance.balance).toFixed(2)} USD`;
    }

    // ticks
    if (data.msg_type === "tick" && data.tick?.symbol) {
      const t = data.tick;
      const sym = t.symbol;
      const price = Number(t.quote);
      lastPrices[sym] = price;

      // update symbol arrow
      const el = document.getElementById(`symbol-${sym}`);
      if (el) {
        const span = el.querySelector(".symbolValue");
        let dir = "➡";
        let col = "#666";
        if (lastPrices[sym] !== undefined && typeof lastPrices[sym] === "number") {
          // use previous stored (we stored above), but to compare we need previous value; keep separate store prevPrices
        }
        // We need a prev store; implement small logic:
      }

      // if tick belongs to currentSymbol, add to chart arrays
      if (sym === currentSymbol) {
        chartData.push(price);
        chartTimes.push(t.epoch);
        if (chartData.length > 300) { chartData.shift(); chartTimes.shift(); }
      }
    }

    // ticks_history (history response)
    if (data.msg_type === "history" || data.history) {
      // Deriv sometimes returns with msg_type "history" or "history"
      const symbol = data.echo_req?.ticks_history || data.history?.symbol || null;
      // Prefer using data.history.prices and data.history.times
      if (data.history && data.history.prices && data.history.times) {
        const prices = data.history.prices.map(p => Number(p));
        const times = data.history.times.map(t => Math.floor(Number(t)));
        // set as chart data if it matches currentSymbol
        const reqSym = data.echo_req?.ticks_history;
        if (reqSym && reqSym === currentSymbol) {
          chartData = prices.slice(-300);
          chartTimes = times.slice(-300);
          drawFrame();
        }
      }
    }
  }

  // utility to subscribe ticks for a symbol (check readyState)
  function subscribeTicks(sym) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ ticks: sym, subscribe: 1 }));
  }

  // request historical ticks (300)
  function requestHistory(sym) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      // if ws not available start simulation
      startSimulationForSymbol(sym);
      return;
    }
    ws.send(JSON.stringify({ ticks_history: sym, end: "latest", count: 300, style: "ticks" }));
  }

  // fallback: simulation generator (if no ws or simulation mode selected)
  function startSimulationForSymbol(sym) {
    stopSimulation();
    simulationActive = true;
    // Create a simple random walk starting from a base (1000 or lastPrices if present)
    let base = lastPrices[sym] || 1000 + Math.random() * 20;
    simulationInterval = setInterval(() => {
      // small random step
      base += (Math.random() - 0.5) * 2;
      const epoch = Math.floor(Date.now() / 1000);
      // feed tick into chart arrays only if this symbol is currentSymbol
      if (sym === currentSymbol) {
        chartData.push(base);
        chartTimes.push(epoch);
        if (chartData.length > 300) { chartData.shift(); chartTimes.shift(); }
        drawFrame();
      }
      // update arrows in symbol list
      const el = document.getElementById(`symbol-${sym}`);
      if (el) {
        const span = el.querySelector(".symbolValue");
        const prev = lastPrices[sym] || base;
        let dir = "➡", color = "#666";
        if (base > prev) { dir = "🔼"; color = "green"; }
        else if (base < prev) { dir = "🔽"; color = "red"; }
        span.textContent = dir;
        span.style.color = color;
        lastPrices[sym] = base;
      }
    }, 900);
  }
  function stopSimulation() {
    simulationActive = false;
    if (simulationInterval) { clearInterval(simulationInterval); simulationInterval = null; }
  }

  // Trading simulation: BUY/SELL/ CLOSE using stake & lot
  buyBtn.addEventListener("click", () => {
    if (!currentSymbol || chartData.length === 0) { logHistory("No symbol selected or no data"); return; }
    const stake = Number(stakeInput?.value) || 1;
    const lot = Number(lotInput?.value) || 1;
    const qty = lot;
    const price = chartData[chartData.length - 1];
    openPosition = { type: "BUY", symbol: currentSymbol, qty, stake, entry: price, time: Date.now() };
    logHistory(`BUY(sim) ${qty} ${currentSymbol} @ ${price.toFixed(2)} stake=${stake}`);
    drawFrame();
  });

  sellBtn.addEventListener("click", () => {
    if (!currentSymbol || chartData.length === 0) { logHistory("No symbol selected or no data"); return; }
    const stake = Number(stakeInput?.value) || 1;
    const lot = Number(lotInput?.value) || 1;
    const qty = lot;
    const price = chartData[chartData.length - 1];
    openPosition = { type: "SELL", symbol: currentSymbol, qty, stake, entry: price, time: Date.now() };
    logHistory(`SELL(sim) ${qty} ${currentSymbol} @ ${price.toFixed(2)} stake=${stake}`);
    drawFrame();
  });

  closeBtn.addEventListener("click", () => {
    if (!openPosition || chartData.length === 0) { logHistory("No open position"); return; }
    const exit = chartData[chartData.length - 1];
    const diff = openPosition.type === "BUY" ? (exit - openPosition.entry) : (openPosition.entry - exit);
    // simple PnL = diff * qty * stake (stake as multiplier of per-lot value)
    const pnl = diff * openPosition.qty * (openPosition.stake || 1);
    logHistory(`CLOSE ${openPosition.type} ${openPosition.symbol} entry=${openPosition.entry.toFixed(2)} exit=${exit.toFixed(2)} PnL=${pnl.toFixed(2)}`);
    openPosition = null;
    drawFrame();
  });

  // draw gauges at interval
  setInterval(() => {
    // update chart/gauges even if no new ticks
    drawFrame();
  }, 600);

  // helper: set status text
  function setStatus(txt) { statusSpan.textContent = txt; }

  // init
  initSymbolList();
  setStatus("Ready — connect to Deriv or select symbol (simulation)");

  // auto-select first symbol to show something
  if (volatilitySymbols.length) selectSymbol(volatilitySymbols[0]);
});
