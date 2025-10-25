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

  let ws = null;
  let chart = null;
  let areaSeries = null;
  let chartData = [];
  let lastPrices = {};
  let recentChanges = [];
  let smoothVol = 0;
  let smoothTrend = 0;
  let currentSymbol = null;

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

  // --- Afficher la liste des symboles
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

  // --- Initialiser le chart
  function initChart() {
    chartInner.innerHTML = "";
    chart = LightweightCharts.createChart(chartInner, {
      layout: { textColor: '#333', background: { type: 'solid', color: '#fff' } },
      timeScale: { timeVisible: true, secondsVisible: true }
    });

    areaSeries = chart.addAreaSeries({
      lineColor: '#2962FF',
      topColor: 'rgba(41,98,255,0.28)',
      bottomColor: 'rgba(41,98,255,0.05)',
      lineWidth: 2,
    });

    chartData = [];
    recentChanges = [];
    lastPrices = {};

    positionGauges();
  }

  function positionGauges() {
    let gaugesContainer = document.getElementById("gaugesContainer");
    if (!gaugesContainer) {
      gaugesContainer = document.createElement("div");
      gaugesContainer.id = "gaugesContainer";
      gaugesContainer.style.position = "absolute";
      gaugesContainer.style.top = "10px";
      gaugesContainer.style.left = "10px";
      gaugesContainer.style.display = "flex";
      gaugesContainer.style.gap = "16px";
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

  // --- Connexion WebSocket
  function connectDeriv() {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close();
      ws = null;
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
        const acc = data.authorize.loginid;
        const bal = data.authorize.balance;
        const currency = data.authorize.currency || "";
        connectBtn.textContent = "Disconnect";
        accountInfo.textContent = `Account: ${acc} | Balance: ${bal.toFixed(2)} ${currency}`;
        ws.send(JSON.stringify({ balance: 1, subscribe: 1 }));
        displaySymbols();
      } else if (data.msg_type === "balance") {
        const b = data.balance;
        accountInfo.textContent = `Account: ${b.loginid} | Balance: ${b.balance.toFixed(2)} ${b.currency}`;
      } else if (data.msg_type === "tick") {
        handleTick(data.tick);
      }
    };

    ws.onclose = () => {
      connectBtn.textContent = "Se connecter";
      accountInfo.textContent = "";
      ws = null;
    };
  }

  // --- Abonnement aux ticks
  function subscribeSymbol(symbol) {
    currentSymbol = symbol;
    initChart();

    if (!ws || ws.readyState !== WebSocket.OPEN) {
      connectDeriv();
      setTimeout(() => subscribeSymbol(symbol), 800);
      return;
    }

    ws.send(JSON.stringify({ forget_all: "ticks" }));
    ws.send(JSON.stringify({ ticks: symbol, subscribe: 1 }));
  }

  // --- Réception d’un tick
  function handleTick(tick) {
    if (!tick || !tick.symbol || tick.symbol !== currentSymbol) return;

    const quote = safe(Number(tick.quote));
    const epoch = Number(tick.epoch) || Math.floor(Date.now() / 1000);

    const prev = lastPrices[currentSymbol] ?? quote;
    lastPrices[currentSymbol] = quote;
    const change = quote - prev;
    recentChanges.push(change);
    if (recentChanges.length > 60) recentChanges.shift();

    updateCircularGauges();

    if (areaSeries) {
      chartData.push({ time: epoch, value: quote });
      if (chartData.length > 500) chartData.shift();
      areaSeries.setData(chartData);
      chart.timeScale().fitContent();
    }
  }

  // --- Gauges
  function updateCircularGauges() {
    if (!recentChanges.length) return;

    const mean = recentChanges.reduce((a, b) => a + b, 0) / recentChanges.length;
    const variance = recentChanges.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / recentChanges.length;
    const stdDev = Math.sqrt(variance);
    const volProb = Math.min(100, (stdDev / 0.07) * 100);

    const sum = recentChanges.reduce((a, b) => a + b, 0);
    const trendRaw = Math.min(100, Math.abs(sum) * 1000);

    const pos = recentChanges.filter(v => v > 0).length;
    const prob = Math.round((pos / recentChanges.length) * 100);

    const alpha = 0.5;
    smoothVol = smoothVol + alpha * (volProb - smoothVol);
    smoothTrend = smoothTrend + alpha * (trendRaw - smoothTrend);

    drawCircularGauge(volGauge, smoothVol, "#ff9800");
    drawCircularGauge(trendGauge, smoothTrend, "#2962FF");
    drawCircularGauge(probGauge, prob, "#4caf50");
  }

  function drawCircularGauge(container, value, color) {
    const size = 110;
    container.style.width = size + "px";
    container.style.height = size + "px";

    let canvas = container.querySelector("canvas");
    let pct = container.querySelector(".gauge-percent");
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.width = canvas.height = size;
      canvas.style.display = "block";
      canvas.style.margin = "0 auto";
      container.innerHTML = "";
      container.appendChild(canvas);

      pct = document.createElement("div");
      pct.className = "gauge-percent";
      pct.style.textAlign = "center";
      pct.style.marginTop = "-90px";
      pct.style.fontSize = "16px";
      pct.style.fontWeight = "700";
      pct.style.color = "#222";
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

  // --- Toggle panneau
  controlPanelToggle.addEventListener("click", () => {
    controlFormPanel.style.display = controlFormPanel.style.display === "none" ? "flex" : "none";
  });

  connectBtn.addEventListener("click", connectDeriv);
  displaySymbols();
  initChart();
});
