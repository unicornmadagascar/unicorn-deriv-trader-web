document.addEventListener("DOMContentLoaded", () => {
  const APP_ID = 105747;
  const TOKEN = "wgf8TFDsJ8Ecvze";
  const WS_URL = `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;
  let ws;
  let chart, areaSeries;
  let lastTick = null;

  const connectBtn = document.getElementById("connectBtn");
  const symbolList = document.getElementById("symbolList");
  const container = document.getElementById("container");

  // === Init chart ===
  function initChart() {
    const chartOptions = {
      layout: { textColor: 'black', background: { type: 'solid', color: 'white' } },
      timeScale: { timeVisible: true, secondsVisible: true }
    };
    chart = LightweightCharts.createChart(container, chartOptions);
    areaSeries = chart.addAreaSeries({
      lineColor: '#2962FF',
      topColor: 'rgba(41, 98, 255, 0.4)',
      bottomColor: 'rgba(41, 98, 255, 0.1)',
    });
    chart.timeScale().fitContent();
  }

  // === Update Gauges ===
  function updateGauge(gaugeEl, value, color1, color2) {
    const smooth = value * 0.9 + parseFloat(gaugeEl.dataset.prev || 0) * 0.1;
    gaugeEl.dataset.prev = smooth;
    gaugeEl.style.background = `conic-gradient(${color1} ${smooth * 3.6}deg, ${color2} ${smooth * 3.6}deg)`;
    gaugeEl.querySelector("span").innerText = `${Math.round(smooth)}%`;
  }

  function randomMetrics() {
    // Simule des indicateurs en fonction des ticks
    const vol = Math.min(100, Math.random() * 80 + 20);
    const trend = Math.min(100, Math.random() * 70 + 30);
    const prob = Math.min(100, Math.random() * 90 + 10);
    updateGauge(document.getElementById("volGauge"), vol, "#ff9800", "#ddd");
    updateGauge(document.getElementById("trendGauge"), trend, "#4caf50", "#ddd");
    updateGauge(document.getElementById("probGauge"), prob, "#2196f3", "#ddd");
  }

  // === Connect and fetch symbols ===
  connectBtn.onclick = () => {
    ws = new WebSocket(WS_URL);
    ws.onopen = () => {
      console.log("✅ Connected");
      ws.send(JSON.stringify({ authorize: TOKEN }));
    };

    ws.onmessage = (msg) => {
      const data = JSON.parse(msg.data);

      if (data.msg_type === "authorize") {
        ws.send(JSON.stringify({ active_symbols: "brief", product_type: "basic" }));
      }

      if (data.msg_type === "active_symbols") {
        displaySymbols(data.active_symbols);
      }

      if (data.msg_type === "tick") {
        handleTick(data.tick);
      }
    };
  };

  function displaySymbols(symbols) {
    symbolList.innerHTML = "";
    symbols.slice(0, 15).forEach(sym => {
      const el = document.createElement("div");
      el.className = "symbol-item";
      el.innerText = sym.display_name;
      el.onclick = () => subscribeSymbol(sym.symbol);
      symbolList.appendChild(el);
    });
  }

  function subscribeSymbol(symbol) {
    ws.send(JSON.stringify({ forget_all: "ticks" }));
    ws.send(JSON.stringify({ ticks: symbol }));
    initChart();
  }

  function handleTick(tick) {
    const localTime = Math.floor(Date.now() / 1000);
    const point = { time: localTime, value: tick.quote };
    areaSeries.update(point);
    chart.timeScale().fitContent();
    randomMetrics();
  }
});
