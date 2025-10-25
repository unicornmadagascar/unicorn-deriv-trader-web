document.addEventListener("DOMContentLoaded", () => {
  const WS_URL = "wss://ws.derivws.com/websockets/v3?app_id=105747";
  const API_TOKEN = "wgf8TFDsJ8Ecvze"; // 🔒 fixe ici ton token Deriv

  const connectBtn = document.getElementById("connectBtn");
  const statusSpan = document.getElementById("status");
  const userBalance = document.getElementById("userBalance");
  const symbolList = document.getElementById("symbolList");
  const chartContainer = document.getElementById("chartInner");

  let ws = null;
  let authorized = false;
  let currentSymbol = "BOOM1000";
  let chart = null;
  let areaSeries = null;
  let chartData = [];
  let lastPrices = {};

  const volatilitySymbols = [
    "BOOM1000", "CRASH1000", "BOOM900", "CRASH900",
    "BOOM600", "CRASH600", "BOOM500", "CRASH500",
    "R_100", "R_75", "R_50", "R_25", "R_10"
  ];

  const setStatus = (txt) => (statusSpan.textContent = txt);
  const formatNum = (n) => Number(n).toFixed(2);

  // --- Gauges ---
  function updateGauge(gaugeId, value, color = "#2962FF") {
    const circle = document.querySelector(`#${gaugeId} .meter`);
    const offset = 283 - (283 * value) / 100;
    circle.style.strokeDashoffset = offset;
    circle.style.stroke = color;
  }

  function updateAllGauges(vol, trend, prob) {
    updateGauge("volGauge", vol, vol > 70 ? "#e53935" : "#2962FF");
    updateGauge("trendGauge", trend, trend > 60 ? "#43a047" : "#2962FF");
    updateGauge("probGauge", prob, prob > 50 ? "#fbc02d" : "#2962FF");
  }

  // --- Chart ---
  function initChart() {
    chartContainer.querySelector("canvas")?.remove();
    chart = LightweightCharts.createChart(chartContainer, {
      width: chartContainer.clientWidth,
      height: chartContainer.clientHeight,
      layout: { background: { color: "white" }, textColor: "black" },
      grid: { vertLines: { color: "#eee" }, horzLines: { color: "#eee" } },
      timeScale: { timeVisible: true, secondsVisible: true },
    });
    areaSeries = chart.addAreaSeries({
      lineColor: "#2962FF",
      topColor: "rgba(41,98,255,0.3)",
      bottomColor: "rgba(41,98,255,0.05)",
      lineWidth: 2,
    });
  }

  // --- Symboles ---
  function initSymbols() {
    symbolList.innerHTML = "";
    volatilitySymbols.forEach((sym) => {
      const el = document.createElement("div");
      el.className = "symbolItem";
      el.id = `symbol-${sym}`;
      el.innerHTML = `<span>${sym}</span><span class="lastPrice">0</span>`;
      el.onclick = () => selectSymbol(sym);
      symbolList.appendChild(el);
    });
    selectSymbol(currentSymbol);
  }

  function selectSymbol(sym) {
    currentSymbol = sym;
    document.querySelectorAll(".symbolItem").forEach((e) => e.classList.remove("selected"));
    const el = document.getElementById(`symbol-${sym}`);
    if (el) el.classList.add("selected");
    chartData = [];
    initChart();
    subscribeTicks(sym);
  }

  // --- WebSocket ---
  function connectDeriv() {
    if (ws) ws.close();
    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      setStatus("Connecting...");
      ws.send(JSON.stringify({ authorize: API_TOKEN }));
    };

    ws.onmessage = (msg) => {
      const data = JSON.parse(msg.data);

      if (data.msg_type === "authorize") {
        setStatus(`Connected: ${data.authorize.loginid}`);
        authorized = true;
        volatilitySymbols.forEach((sym) => subscribeTicks(sym));
        ws.send(JSON.stringify({ balance: 1, subscribe: 1 }));
      }

      if (data.msg_type === "balance" && data.balance) {
        const bal = parseFloat(data.balance.balance).toFixed(2);
        const cur = data.balance.currency;
        userBalance.textContent = `Balance: ${bal} ${cur}`;
      }

      if (data.msg_type === "tick" && data.tick) handleTick(data.tick);
    };

    ws.onclose = () => setStatus("Disconnected");
    ws.onerror = (e) => console.error("WS Error:", e);
  }

  function subscribeTicks(symbol) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ ticks: symbol, subscribe: 1 }));
    }
  }

  function handleTick(tick) {
    const p = Number(tick.quote);
    const s = tick.symbol;
    const time = Math.floor(tick.epoch);

    lastPrices[s] = p;
    const el = document.getElementById(`symbol-${s}`);
    if (el) el.querySelector(".lastPrice").textContent = formatNum(p);

    if (s === currentSymbol) {
      chartData.push({ time, value: p });
      if (chartData.length > 500) chartData.shift();
      areaSeries.setData(chartData);

      // Simuler des valeurs de gauges basées sur la volatilité et tendance
      const vol = Math.min(Math.random() * 100, 100);
      const trend = Math.abs((p % 50) - 25) * 4;
      const prob = 50 + (Math.random() - 0.5) * 50;
      updateAllGauges(vol, trend, prob);
    }
  }

  // --- Init ---
  connectBtn.onclick = connectDeriv;
  initSymbols();
  initChart();

  window.addEventListener("resize", () => {
    chart.resize(chartContainer.clientWidth, chartContainer.clientHeight);
  });
});
