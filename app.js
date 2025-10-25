document.addEventListener("DOMContentLoaded", () => {
  const APP_ID = 105747;
  const TOKEN = "wgf8TFDsJ8Ecvze";
  const WS_URL = `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;

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

  let automationRunning = false;
  let smoothVol = 0;
  let smoothTrend = 0;
  let ws = null;
  let chart = null;
  let areaSeries = null;
  let chartData = [];
  let lastPrices = {};
  let recentChanges = [];

  // --- NEW: current symbol & pending subscribe ---
  let currentSymbol = null;
  let pendingSubscribe = null;
  let authorized = false;

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
  const safe = v => (typeof v === "number" && !isNaN(v)) ? v : 0;

  // --- SYMBOLS ---
  function displaySymbols() {
    symbolList.innerHTML = "";
    SYMBOLS.forEach(s => {
      const el = document.createElement("div");
      el.className = "symbol-item";
      el.textContent = s.name;
      el.dataset.symbol = s.symbol;
      el.addEventListener("click", () => subscribeSymbol(s.symbol));
      symbolList.appendChild(el);
    });
  }

  // --- CHART INIT ---
  function initChart() {
    try { if (chart) chart.remove(); } catch (e) {}
    chartInner.innerHTML = "";

    chart = LightweightCharts.createChart(chartInner, {
      layout: { textColor: "#333", background: { type: "solid", color: "#fff" } },
      timeScale: { timeVisible: true, secondsVisible: true }
    });

    // use addAreaSeries (works with standalone bundle)
    areaSeries = chart.addAreaSeries({
      lineColor: "#2962FF",
      topColor: "rgba(41,98,255,0.28)",
      bottomColor: "rgba(41,98,255,0.05)",
      lineWidth: 2
    });

    chartData = [];
    recentChanges = [];
    lastPrices = {};

    positionGauges();
  }

  // --- GAUGES ---
  function positionGauges() {
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
    }
  }

  function appendGauge(container, gaugeDiv, labelText) {
    const wrapper = document.createElement("div");
    wrapper.style.display = "flex";
    wrapper.style.flexDirection = "column";
    wrapper.style.alignItems = "center";
    wrapper.style.width = "140px";
    wrapper.style.pointerEvents = "none";

    const content = document.createElement("div");
    content.style.width = "100%";
    content.appendChild(gaugeDiv);
    wrapper.appendChild(content);

    const label = document.createElement("div");
    label.textContent = labelText;
    label.style.fontSize = "13px";
    label.style.fontWeight = "600";
    label.style.textAlign = "center";
    label.style.marginTop = "6px";
    label.style.pointerEvents = "none";
    wrapper.appendChild(label);

    container.appendChild(wrapper);
  }

  // --- CONNECT DERIV ---
  function connectDeriv() {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close();
      ws = null;
      authorized = false;
      connectBtn.textContent = "Se connecter";
      accountInfo.textContent = "";
      return;
    }

    ws = new WebSocket(WS_URL);
    connectBtn.textContent = "Connecting...";
    accountInfo.textContent = "Connecting...";

    ws.onopen = () => {
      // send authorize
      ws.send(JSON.stringify({ authorize: TOKEN }));
    };

    ws.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data);

        // authorize response
        if (data.msg_type === "authorize" && data.authorize) {
          authorized = true;
          const acc = data.authorize.loginid;
          const bal = data.authorize.balance;
          const currency = data.authorize.currency || "";
          connectBtn.textContent = "Disconnect";
          accountInfo.textContent = `Account: ${acc} | Balance: ${Number(bal).toFixed(2)} ${currency}`;

          // subscribe balance updates
          ws.send(JSON.stringify({ balance: 1, subscribe: 1 }));

          // if there was a pending subscribe requested earlier, do it now
          if (pendingSubscribe) {
            // small delay to ensure WS state consistent
            setTimeout(() => {
              if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ forget_all: "ticks" }));
                ws.send(JSON.stringify({ ticks: pendingSubscribe }));
                currentSymbol = pendingSubscribe;
                pendingSubscribe = null;
              }
            }, 100);
          }

          displaySymbols();
          return;
        }

        // balance update
        if (data.msg_type === "balance" && data.balance) {
          const b = data.balance;
          accountInfo.textContent = `Account: ${b.loginid} | Balance: ${Number(b.balance).toFixed(2)} ${b.currency}`;
          return;
        }

        // tick handling
        if (data.msg_type === "tick" && data.tick) {
          handleTick(data.tick);
          return;
        }

        // other messages are ignored here
      } catch (err) {
        console.error("WS parse err", err);
      }
    };

    ws.onclose = () => {
      connectBtn.textContent = "Se connecter";
      accountInfo.textContent = "";
      ws = null;
      authorized = false;
    };

    ws.onerror = (e) => {
      console.error("WS error", e);
    };
  }

  // --- SUBSCRIBE SYMBOL ---
  function subscribeSymbol(symbol) {
    // set desired symbol and reinit chart immediately
    currentSymbol = symbol;
    initChart(); // reinit chart so areaSeries exists before ticks arrive

    // if WS not ready, set pendingSubscribe and open connection
    if (!ws || ws.readyState !== WebSocket.OPEN || !authorized) {
      pendingSubscribe = symbol;
      if (!ws || ws.readyState === WebSocket.CLOSED) {
        connectDeriv();
      }
      // we'll actually send subscription after authorize in ws.onmessage
      return;
    }

    // WS open and authorized -> subscribe now
    try {
      ws.send(JSON.stringify({ forget_all: "ticks" }));
      ws.send(JSON.stringify({ ticks: symbol }));
    } catch (e) {
      // fallback: queue for after authorize
      pendingSubscribe = symbol;
      console.warn("Failed to send subscribe immediately, queued", e);
    }
  }

  // --- TICK HANDLER ---
  function handleTick(tick) {
    // ensure tick belongs to current symbol (or accept if no currentSymbol)
    if (!tick || !tick.symbol) return;
    if (currentSymbol && tick.symbol !== currentSymbol) return;

    const quote = safe(Number(tick.quote));
    // Deriv epoch is seconds; lightweight-charts accepts number seconds
    const epoch = Number(tick.epoch) || Math.floor(Date.now() / 1000);

    // update lastPrices per symbol key (keep generic)
    const prev = lastPrices[tick.symbol] ?? quote;
    lastPrices[tick.symbol] = quote;

    const change = quote - prev;
    recentChanges.push(change);
    if (recentChanges.length > 60) recentChanges.shift();

    updateCircularGauges();

    // update chartData and series
    if (!areaSeries || !chart) return;

    const point = { time: epoch, value: quote };

    // if first data point, setData with small array to initialize
    if (!chartData.length) {
      chartData.push(point);
      try {
        areaSeries.setData(chartData);
      } catch (e) {
        // fallback: try update
        try { areaSeries.update(point); } catch (err) {}
      }
    } else {
      // append and update
      chartData.push(point);
      if (chartData.length > 600) chartData.shift();

      // Prefer update (faster); fallback to setData if update throws
      try {
        areaSeries.update(point);
      } catch (e) {
        try { areaSeries.setData(chartData); } catch (err) {}
      }
    }

    // try to auto-fit time scale (safe)
    try { chart.timeScale().fitContent(); } catch (e) {}
  }

  // --- GAUGES UPDATE ---
  function updateCircularGauges() {
    if (!recentChanges.length) return;
    const mean = recentChanges.reduce((a, b) => a + b, 0) / recentChanges.length;
    const variance = recentChanges.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / recentChanges.length;
    const stdDev = Math.sqrt(variance);
    const volProb = Math.min(100, (stdDev / 0.07) * 100);

    const sum = recentChanges.reduce((a, b) => a + b, 0);
    const trendRaw = Math.min(100, Math.abs(sum) * 1000);

    const pos = recentChanges.filter(v => v > 0).length;
    const neg = recentChanges.filter(v => v < 0).length;
    const dominant = Math.max(pos, neg);
    const prob = recentChanges.length ? Math.round((dominant / recentChanges.length) * 100) : 50;

    const alpha = 0.25; // smoother
    smoothVol = smoothVol === 0 ? volProb : smoothVol + alpha * (volProb - smoothVol);
    smoothTrend = smoothTrend === 0 ? trendRaw : smoothTrend + alpha * (trendRaw - smoothTrend);

    drawCircularGauge(volGauge, smoothVol, "#ff9800");
    drawCircularGauge(trendGauge, smoothTrend, "#2962FF");
    drawCircularGauge(probGauge, prob, "#4caf50");
  }

  // --- DRAW GAUGE ---
  function drawCircularGauge(container, value, color) {
    const size = 110;
    container.style.width = size + "px";
    container.style.height = (size + 28) + "px";

    let canvas = container.querySelector("canvas");
    let pct = container.querySelector(".gauge-percent");
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.width = canvas.height = size;
      canvas.style.display = "block";
      canvas.style.margin = "0 auto";
      canvas.style.pointerEvents = "none";
      container.innerHTML = "";
      container.appendChild(canvas);

      pct = document.createElement("div");
      pct.className = "gauge-percent";
      pct.style.textAlign = "center";
      pct.style.marginTop = "-92px";
      pct.style.fontSize = "16px";
      pct.style.fontWeight = "700";
      pct.style.color = "#222";
      pct.style.pointerEvents = "none";
      container.appendChild(pct);
    }

    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, size, size);
    const center = size / 2;
    const radius = size / 2 - 8;
    const start = -Math.PI / 2;
    const end = start + (Math.min(value, 100) / 100) * 2 * Math.PI;

    ctx.beginPath();
    ctx.arc(center, center, radius, 0, 2 * Math.PI);
    ctx.strokeStyle = "#eee";
    ctx.lineWidth = 8;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(center, center, radius, start, end);
    ctx.strokeStyle = color;
    ctx.lineWidth = 8;
    ctx.lineCap = "round";
    ctx.stroke();

    pct.textContent = `${Math.round(value)}%`;
  }

  // --- TOGGLE PANEL ---
  controlPanelToggle.addEventListener("click", () => {
    if (!controlFormPanel) return;
    if (controlFormPanel.classList.contains("active")) {
      controlFormPanel.classList.remove("active");
      controlFormPanel.style.display = "none";
    } else {
      controlFormPanel.style.display = "flex";
      setTimeout(() => controlFormPanel.classList.add("active"), 10);
    }
  });

  // wire connect button
  connectBtn.addEventListener("click", () => {
    connectDeriv();
    displaySymbols();
  });

  // startup
  displaySymbols();
  initChart();

  // resize handling
  window.addEventListener("resize", () => {
    try { positionGauges(); } catch (e) {}
    if (chart) {
      try { chart.resize(chartInner.clientWidth, chartInner.clientHeight); } catch (e) {}
    }
  });
});
