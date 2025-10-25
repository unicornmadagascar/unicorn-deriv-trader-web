document.addEventListener("DOMContentLoaded", () => {
  const APP_ID = 105747;
  const TOKEN = "wgf8TFDsJ8Ecvze"; // <-- Mets ton token Deriv ici
  const WS_URL = `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;
  let ws, chart, areaSeries;
  let lastTick = null;

  const connectBtn = document.getElementById("connectBtn");
  const symbolList = document.getElementById("symbolList");
  const container = document.getElementById("container");

  // Symbols Deriv non forex
  const SYMBOLS = [
    { symbol: "BOOM1000", name: "Boom 1000 Index" },
    { symbol: "CRASH1000", name: "Crash 1000 Index" },
    { symbol: "BOOM500", name: "Boom 500 Index" },
    { symbol: "CRASH500", name: "Crash 500 Index" },
    { symbol: "BOOM300", name: "Boom 300 Index" },
    { symbol: "CRASH300", name: "Crash 300 Index" },
    { symbol: "R_50", name: "Volatility 50 Index" },
    { symbol: "R_75", name: "Volatility 75 Index" },
    { symbol: "R_100", name: "Volatility 100 Index" },
    { symbol: "R_25", name: "Volatility 25 Index" },
    { symbol: "R_10", name: "Volatility 10 Index" },
    { symbol: "RDBULL", name: "Step Index" }
  ];

  // === Init chart ===
  function initChart() {
    container.innerHTML = `
      <div id="gauges">
        <div class="gauge-container">
          <div id="volGauge" class="gauge"><span>0%</span></div>
          <div class="gauge-label">Volatilité</div>
        </div>
        <div class="gauge-container">
          <div id="trendGauge" class="gauge"><span>0%</span></div>
          <div class="gauge-label">Tendance</div>
        </div>
        <div class="gauge-container">
          <div id="probGauge" class="gauge"><span>0%</span></div>
          <div class="gauge-label">Probabilité</div>
        </div>
      </div>
    `;
    chart = LightweightCharts.createChart(container, {
      layout: { textColor: 'black', background: { type: 'solid', color: 'white' } },
      timeScale: { timeVisible: true, secondsVisible: true },
    });
    areaSeries = chart.addAreaSeries({
      lineColor: '#2962FF',
      topColor: 'rgba(41, 98, 255, 0.4)',
      bottomColor: 'rgba(41, 98, 255, 0.1)',
    });
    chart.timeScale().fitContent();
  }

  // === Update Gauges ===
  function updateGauge(gaugeEl, value, color1, color2) {
    const prev = parseFloat(gaugeEl.dataset.prev || 0);
    const smooth = prev + (value - prev) * 0.3;
    gaugeEl.dataset.prev = smooth;
    gaugeEl.style.background = `conic-gradient(${color1} ${smooth * 3.6}deg, ${color2} ${smooth * 3.6}deg)`;
    gaugeEl.querySelector("span").innerText = `${Math.round(smooth)}%`;
  }

  function updateMetrics(tick) {
    if (!lastTick) return;
    const change = ((tick.quote - lastTick) / lastTick) * 100;
    const vol = Math.min(100, Math.abs(change) * 20);
    const trend = Math.min(100, Math.abs(change) * 40);
    const prob = 50 + (change > 0 ? trend / 2 : -trend / 2);

    updateGauge(document.getElementById("volGauge"), vol, "#ff9800", "#ddd");
    updateGauge(document.getElementById("trendGauge"), trend, change > 0 ? "#4caf50" : "#f44336", "#ddd");
    updateGauge(document.getElementById("probGauge"), prob, "#2196f3", "#ddd");
  }

  // === Connection ===
  connectBtn.onclick = () => {
    ws = new WebSocket(WS_URL);
    ws.onopen = () => {
      console.log("✅ Connecté");
      ws.send(JSON.stringify({ authorize: TOKEN }));
    };

    ws.onmessage = (msg) => {
      const data = JSON.parse(msg.data);
      if (data.msg_type === "authorize") {
        console.log("✅ Autorisé");
        displaySymbols();
      }
      if (data.msg_type === "tick") handleTick(data.tick);
    };
  };

  function displaySymbols() {
    symbolList.innerHTML = "";
    SYMBOLS.forEach(sym => {
      const el = document.createElement("div");
      el.className = "symbol-item";
      el.innerText = sym.name;
      el.onclick = () => subscribeSymbol(sym.symbol);
      symbolList.appendChild(el);
    });
  }

  function subscribeSymbol(symbol) {
    ws.send(JSON.stringify({ forget_all: "ticks" }));
    ws.send(JSON.stringify({ ticks: symbol }));
    initChart();
    console.log("📊 Subscribed to", symbol);
  }

  function handleTick(tick) {
    const localTime = Math.floor(Date.now() / 1000);
    const point = { time: localTime, value: tick.quote };
    areaSeries.update(point);
    chart.timeScale().fitContent();
    updateMetrics(tick.quote);
    lastTick = tick.quote;
  }
});
