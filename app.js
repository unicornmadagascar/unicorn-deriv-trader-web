document.addEventListener("DOMContentLoaded", () => {
  const APP_ID = 105747;
  const WS_URL = `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;

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

  let ws = null, currentSymbol = null, lastPrices = {}, chartData = [], chartTimes = [];
  let canvas, ctx, authorized = false;

  const volatilitySymbols = [
    "BOOM1000","BOOM900","BOOM600","BOOM500","BOOM300",
    "CRASH1000","CRASH900","CRASH600","CRASH500"
  ];

  // Ensure chartInner is positioned so tooltip absolute coords are relative to it
  chartInner.style.position = chartInner.style.position || "relative";

  // === Tooltip (styled + clamp logic) ===
  const tooltip = document.createElement("div");
  tooltip.style.position = "absolute";
  tooltip.style.padding = "6px 10px";
  tooltip.style.background = "rgba(0,0,0,0.78)";
  tooltip.style.color = "#fff";
  tooltip.style.fontSize = "12px";
  tooltip.style.borderRadius = "6px";
  tooltip.style.pointerEvents = "none";
  tooltip.style.display = "none";
  tooltip.style.boxShadow = "0 6px 18px rgba(0,0,0,0.35)";
  tooltip.style.zIndex = "9999";
  tooltip.innerHTML = ""; // initial
  chartInner.appendChild(tooltip);

  // === Helpers ===
  function logHistory(txt) {
    const div = document.createElement("div");
    div.textContent = `${new Date().toLocaleTimeString()} — ${txt}`;
    historyList.prepend(div);
  }
  function setStatus(txt) { statusSpan.textContent = txt; }

  // === Symbols ===
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

  function selectSymbol(symbol) {
    currentSymbol = symbol;
    document.querySelectorAll(".symbolItem").forEach(el => el.classList.remove("active"));
    const sel = document.getElementById(`symbol-${symbol}`);
    if (sel) sel.classList.add("active");
    logHistory(`Selected symbol: ${symbol}`);
    initCanvas();
    initGauges();
    subscribeTicks(symbol);
    loadHistoricalTicks(symbol);
  }

  // === Canvas chart init + resize handling ===
  function initCanvas() {
    chartInner.innerHTML = "";
    // re-append tooltip (because we cleared chartInner)
    chartInner.appendChild(tooltip);

    canvas = document.createElement("canvas");
    // reserve space for gauges to the right if dashboard exists
    const gaugeWidth = (gaugeDashboard && gaugeDashboard.clientWidth) ? gaugeDashboard.clientWidth : 0;
    // fill available width
    canvas.width = chartInner.clientWidth - (gaugeWidth > 0 ? gaugeWidth + 16 : 0);
    canvas.height = chartInner.clientHeight;
    canvas.style.display = "block";
    chartInner.appendChild(canvas);
    ctx = canvas.getContext("2d");
    chartData = []; chartTimes = [];

    // events
    canvas.addEventListener("mousemove", handleMouseMove);
    canvas.addEventListener("mouseleave", () => { tooltip.style.display = "none"; });

    // handle window resize – resize canvas and redraw
    window.addEventListener("resize", () => {
      // recompute width each resize (keep gauge space)
      const gaugeWidth2 = (gaugeDashboard && gaugeDashboard.clientWidth) ? gaugeDashboard.clientWidth : 0;
      canvas.width = chartInner.clientWidth - (gaugeWidth2 > 0 ? gaugeWidth2 + 16 : 0);
      canvas.height = chartInner.clientHeight;
      // reattach tooltip (still child)
      if (!chartInner.contains(tooltip)) chartInner.appendChild(tooltip);
      // redraw immediately
      drawChart();
      drawGauges();
    });
  }

  // === Drawing functions ===
  function drawChart() {
    if (!ctx || chartData.length === 0) return;
    const padding = 50;
    const w = canvas.width - padding * 2;
    const h = canvas.height - padding * 2;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Background gradient
    const bgGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
    bgGrad.addColorStop(0, "#f5f9ff");
    bgGrad.addColorStop(1, "#eaf2ff");
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const maxVal = Math.max(...chartData);
    const minVal = Math.min(...chartData);
    const range = maxVal - minVal || 1;

    // Axes
    ctx.strokeStyle = "#444"; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding, padding);
    ctx.lineTo(padding, canvas.height - padding);
    ctx.lineTo(canvas.width - padding, canvas.height - padding);
    ctx.stroke();

    // Grid & labels
    ctx.strokeStyle = "#ddd"; ctx.lineWidth = 0.5;
    ctx.font = "11px Arial"; ctx.fillStyle = "#333"; ctx.textAlign = "right"; ctx.textBaseline = "middle";
    for (let i = 0; i <= 5; i++) {
      const y = canvas.height - padding - (i / 5) * h;
      ctx.beginPath(); ctx.moveTo(padding, y); ctx.lineTo(canvas.width - padding, y); ctx.stroke();
      ctx.fillText((minVal + (i / 5) * range).toFixed(2), padding - 8, y);
    }

    // Area chart (no smoothing)
    const len = chartData.length;
    if (len < 1) return;
    ctx.beginPath();
    for (let i = 0; i < len; i++) {
      const x = padding + (i / (len - 1 || 1)) * w;
      const y = canvas.height - padding - ((chartData[i] - minVal) / range) * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.lineTo(canvas.width - padding, canvas.height - padding);
    ctx.lineTo(padding, canvas.height - padding);
    ctx.closePath();

    // fill with blue gradient
    const areaGrad = ctx.createLinearGradient(0, padding, 0, canvas.height - padding);
    areaGrad.addColorStop(0, "rgba(0, 123, 255, 0.45)");
    areaGrad.addColorStop(1, "rgba(0, 123, 255, 0.1)");
    ctx.fillStyle = areaGrad;
    ctx.fill();

    // border line
    ctx.beginPath();
    for (let i = 0; i < len; i++) {
      const x = padding + (i / (len - 1 || 1)) * w;
      const y = canvas.height - padding - ((chartData[i] - minVal) / range) * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = "#007bff"; ctx.lineWidth = 2; ctx.stroke();

    // current price
    const lastPrice = chartData[len - 1];
    const yPrice = canvas.height - padding - ((lastPrice - minVal) / range) * h;
    ctx.strokeStyle = "red"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(padding, yPrice); ctx.lineTo(canvas.width - padding, yPrice); ctx.stroke();

    ctx.fillStyle = "red"; ctx.beginPath();
    ctx.arc(canvas.width - padding - 10, yPrice, 5, 0, 2 * Math.PI); ctx.fill();

    ctx.font = "14px Arial"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.fillText(lastPrice.toFixed(2), canvas.width - padding - 70, yPrice - 5);
  }

  // === Tooltip: compute index and clamp within chartInner bounds ===
  function handleMouseMove(e) {
    if (!canvas || chartData.length === 0) return;
    const rect = canvas.getBoundingClientRect();
    const chartRect = chartInner.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const padding = 50;
    const w = canvas.width - padding * 2;
    const len = chartData.length;
    if (len === 0) return;

    // map mouseX to index
    let idx = Math.round((mouseX - padding) / (w || 1) * (len - 1));
    idx = Math.max(0, Math.min(idx, len - 1));

    const price = chartData[idx];
    const time = chartTimes[idx] ? new Date(chartTimes[idx] * 1000).toLocaleTimeString().slice(0, 8) : "";

    // tooltip content
    tooltip.innerHTML = `<strong style="display:block;margin-bottom:4px">${currentSymbol || ""}</strong>
                         <div>Price: <b>${price.toFixed(2)}</b></div>
                         <div style="opacity:0.85;font-size:11px">${time}</div>`;

    // position tooltip relative to chartInner, try to show on right of cursor but clamp inside chartInner
    const offsetX = 12;
    const offsetY = -28;
    // client coords for tooltip top-left
    let tLeft = e.clientX - chartRect.left + offsetX;
    let tTop = e.clientY - chartRect.top + offsetY;

    // clamp horizontally inside chartInner
    const maxLeft = chartInner.clientWidth - tooltip.offsetWidth - 8;
    if (tLeft > maxLeft) tLeft = maxLeft;
    if (tLeft < 6) tLeft = 6;
    // clamp vertically
    const maxTop = chartInner.clientHeight - tooltip.offsetHeight - 6;
    if (tTop > maxTop) tTop = maxTop;
    if (tTop < 6) tTop = 6;

    tooltip.style.left = `${tLeft}px`;
    tooltip.style.top = `${tTop}px`;
    tooltip.style.display = "block";
  }

  // === Gauges ===
  function initGauges() {
    if (!gaugeDashboard) return;
    gaugeDashboard.innerHTML = "";
    gaugeDashboard.style.display = "flex";
    gaugeDashboard.style.flexDirection = "row";
    gaugeDashboard.style.alignItems = "center";
    gaugeDashboard.style.gap = "10px";
    ["Volatility", "ATR", "EMA"].forEach(name => {
      const c = document.createElement("canvas");
      c.width = 120; c.height = 120;
      c.dataset.gaugeName = name;
      c.style.marginRight = "6px";
      gaugeDashboard.appendChild(c);
    });
  }

  function drawGauges() {
    if (!gaugeDashboard) return;
    gaugeDashboard.querySelectorAll("canvas").forEach(c => {
      let value = 0;
      if (c.dataset.gaugeName === "Volatility") value = calculateVolatility();
      else if (c.dataset.gaugeName === "ATR") value = calculateATR();
      else if (c.dataset.gaugeName === "EMA") value = calculateEMA();
      drawGauge(c, value);
    });
  }

  function drawGauge(canvas, value) {
    const gctx = canvas.getContext("2d");
    const w = canvas.width, h = canvas.height;
    const radius = Math.min(w, h) / 2 - 12;
    gctx.clearRect(0, 0, w, h);

    // background ring
    gctx.beginPath();
    gctx.arc(w / 2, h / 2, radius, 0, Math.PI * 2);
    gctx.strokeStyle = "#eee";
    gctx.lineWidth = 12;
    gctx.stroke();

    // progress arc
    const endAngle = (value / 100) * 2 * Math.PI;
    gctx.beginPath();
    gctx.arc(w / 2, h / 2, radius, -Math.PI / 2, -Math.PI / 2 + endAngle);
    const grad = gctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, "#3b82f6");
    grad.addColorStop(1, "#2563eb");
    gctx.strokeStyle = grad;
    gctx.lineWidth = 12;
    gctx.lineCap = "round";
    gctx.stroke();

    // text
    gctx.fillStyle = "#333";
    gctx.font = "12px Arial";
    gctx.textAlign = "center";
    gctx.textBaseline = "middle";
    gctx.fillText(canvas.dataset.gaugeName, w / 2, h / 2 - 10);
    gctx.fillText(value.toFixed(1) + "%", w / 2, h / 2 + 10);
  }

  // === Gauge calculations (real ticks) ===
  function calculateVolatility() {
    if (chartData.length < 2) return 0;
    const lastN = chartData.slice(-50);
    const max = Math.max(...lastN);
    const min = Math.min(...lastN);
    const last = chartData[chartData.length - 1] || 1;
    return Math.min(((max - min) / Math.abs(last)) * 100, 100);
  }

  function calculateATR() {
    if (chartData.length < 2) return 0;
    const look = Math.min(50, chartData.length - 1);
    let sum = 0;
    for (let i = chartData.length - look; i < chartData.length - 1; i++) {
      sum += Math.abs(chartData[i + 1] - chartData[i]);
    }
    const denom = Math.max(...chartData) || 1;
    return Math.min((sum / Math.max(1, look)) / denom * 100, 100);
  }

  function calculateEMA(period = 20) {
    if (chartData.length < 2) return 0;
    const actualPeriod = Math.min(period, chartData.length);
    let ema = chartData[chartData.length - actualPeriod];
    const k = 2 / (actualPeriod + 1);
    for (let i = chartData.length - actualPeriod + 1; i < chartData.length; i++) {
      ema = chartData[i] * k + ema * (1 - k);
    }
    const denom = Math.max(...chartData) || 1;
    return Math.min(Math.abs((ema / denom) * 100), 100);
  }

  // update loop (faster if you want real-time)
  setInterval(() => {
    if (chartData.length > 0) {
      drawChart();
      drawGauges();
    }
  }, 500);

  // === WebSocket ===
  connectBtn.onclick = () => {
    const token = tokenInput.value.trim() || null;
    ws = new WebSocket(WS_URL);
    ws.onopen = () => {
      setStatus("Connected to Deriv WebSocket");
      logHistory("WebSocket connected");
      if (token) authorize(token);
      else initSymbols();
    };
    ws.onmessage = msg => handleMessage(JSON.parse(msg.data));
    ws.onclose = () => setStatus("WebSocket disconnected");
    ws.onerror = () => setStatus("WebSocket error");
  };

  function handleMessage(data) {
    if (data.msg_type === "authorize") {
      if (data.error) { logHistory("❌ Invalid token"); setStatus("Simulation mode"); return; }
      authorized = true; setStatus(`Authorized: ${data.authorize.loginid}`); getBalance();
    }
    if (data.msg_type === "balance" && data.balance?.balance != null) userBalance.textContent = `Balance: ${parseFloat(data.balance.balance).toFixed(2)} USD`;
    if (data.msg_type === "tick" && data.tick?.symbol) {
      const tick = data.tick, symbol = tick.symbol, price = Number(tick.quote);
      if (symbol === currentSymbol) {
        chartData.push(price); chartTimes.push(tick.epoch);
        if (chartData.length > 300) { chartData.shift(); chartTimes.shift(); }
      }
      const el = document.getElementById(`symbol-${symbol}`);
      if (el) {
        const span = el.querySelector(".symbolValue");
        let direction = "➡", color = "#666";
        if (lastPrices[symbol] !== undefined) {
          if (price > lastPrices[symbol]) { direction = "🔼"; color = "green"; }
          else if (price < lastPrices[symbol]) { direction = "🔽"; color = "red"; }
        }
        span.textContent = direction; span.style.color = color; lastPrices[symbol] = price;
      }
    }
  }

  function authorize(token) { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ authorize: token })); }
  function getBalance() { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ balance: 1, subscribe: 1 })); }
  function subscribeTicks(symbol) { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ ticks: symbol, subscribe: 1 })); }
  function loadHistoricalTicks(symbol) { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ ticks_history: symbol, end: "latest", count: 300, style: "ticks", subscribe: 1 })); }

  // === Trades ===
  function logHistory(txt) { const div = document.createElement("div"); div.textContent = `${new Date().toLocaleTimeString()} — ${txt}`; historyList.prepend(div); }
  buyBtn.onclick = () => logTrade("BUY");
  sellBtn.onclick = () => logTrade("SELL");
  closeBtn.onclick = () => logTrade("CLOSE");
  function logTrade(type) { if (!currentSymbol) return; logHistory(`${type} ${currentSymbol}`); }

  function setStatus(txt) { statusSpan.textContent = txt; }

  // init
  setStatus("Ready. Connect and select a symbol.");
  initSymbols();
});
