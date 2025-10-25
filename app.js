document.addEventListener("DOMContentLoaded", () => {
  const APP_ID = 105747;
  const TOKEN = "wgf8TFDsJ8Ecvze";
  const WS_URL = `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;

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

  // --- CHART INIT (corrigé pour compatibilité) ---
  function initChart() {
  try { if (chart) chart.remove(); } catch (e) {}
  chartInner.innerHTML = "";

  // ✅ Crée le chart correctement
  chart = LightweightCharts.createChart(chartInner, {
    layout: {
      background: { color: '#ffffff' },
      textColor: '#333',
    },
    grid: {
      vertLines: { color: 'rgba(197, 203, 206, 0.5)' },
      horzLines: { color: 'rgba(197, 203, 206, 0.5)' },
    },
    timeScale: { timeVisible: true, secondsVisible: true },
    rightPriceScale: { borderVisible: true },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal }
  });

  // ✅ Utilise addAreaSeries (version standalone)
   if (chart.addAreaSeries) {
    areaSeries = chart.addAreaSeries({
      lineColor: "#2962FF",
      topColor: "rgba(41,98,255,0.28)",
      bottomColor: "rgba(41,98,255,0.05)",
      lineWidth: 2
    });
   } else {
     console.error("⚠️ chart.addAreaSeries non disponible. Vérifie la version du script LightweightCharts dans ton HTML.");
   }

   chartData = [];
   recentChanges = [];
   lastPrices = {};
   positionGauges();
  }

  // --- CONNECT DERIV (inchangé) ---
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

    ws.onopen = () => ws.send(JSON.stringify({ authorize: TOKEN }));

    ws.onmessage = (evt) => {
      const data = JSON.parse(evt.data);

      if (data.msg_type === "authorize" && data.authorize) {
        authorized = true;
        const acc = data.authorize.loginid;
        const bal = data.authorize.balance;
        const currency = data.authorize.currency || "";
        connectBtn.textContent = "Disconnect";
        accountInfo.textContent = `Account: ${acc} | Balance: ${Number(bal).toFixed(2)} ${currency}`;

        ws.send(JSON.stringify({ balance: 1, subscribe: 1 }));

        if (pendingSubscribe) {
          setTimeout(() => {
            if (ws && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ forget_all: "ticks" }));
              ws.send(JSON.stringify({ ticks: pendingSubscribe }));
              currentSymbol = pendingSubscribe;
              pendingSubscribe = null;
            }
          }, 200);
        }

        displaySymbols();
      }

      if (data.msg_type === "balance" && data.balance) {
        const b = data.balance;
        accountInfo.textContent = `Account: ${b.loginid} | Balance: ${Number(b.balance).toFixed(2)} ${b.currency}`;
      }

      if (data.msg_type === "tick" && data.tick) handleTick(data.tick);
    };

    ws.onclose = () => {
      connectBtn.textContent = "Se connecter";
      accountInfo.textContent = "";
      ws = null;
      authorized = false;
    };
  }

  // --- SUBSCRIBE SYMBOL ---
  function subscribeSymbol(symbol) {
    currentSymbol = symbol;
    initChart();

    if (!ws || ws.readyState !== WebSocket.OPEN || !authorized) {
      pendingSubscribe = symbol;
      if (!ws || ws.readyState === WebSocket.CLOSED) connectDeriv();
      return;
    }

    ws.send(JSON.stringify({ forget_all: "ticks" }));
    ws.send(JSON.stringify({ ticks: symbol }));
  }

  // --- TICK HANDLER (corrigé : forcer update correct du chart) ---
  function handleTick(tick) {
    if (!tick || !tick.symbol) return;
    if (currentSymbol && tick.symbol !== currentSymbol) return;
    if (!areaSeries || !chart) return;

    const quote = safe(Number(tick.quote));
    const epoch = Number(tick.epoch) || Math.floor(Date.now() / 1000);
    const prev = lastPrices[tick.symbol] ?? quote;
    lastPrices[tick.symbol] = quote;

    const change = quote - prev;
    recentChanges.push(change);
    if (recentChanges.length > 60) recentChanges.shift();

    updateCircularGauges();

    const point = { time: epoch, value: quote };
    chartData.push(point);
    if (chartData.length > 600) chartData.shift();

    // ✅ Utilisation robuste compatible avec tous builds
    try {
      if (typeof areaSeries.update === "function") {
        areaSeries.update(point);
      } else if (typeof areaSeries.setData === "function") {
        areaSeries.setData(chartData);
      }
    } catch (e) {
      console.warn("⚠️ update chart error", e);
    }

    try { chart.timeScale().fitContent(); } catch (e) {}
  }

  // --- (reste du code identique : gauges, drawCircularGauge, etc.) ---
  // ... [ne change rien à partir d’ici, tout ton code UI/gauges reste valide] ...
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
