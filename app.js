document.addEventListener("DOMContentLoaded", () => {
  const WS_URL = "wss://ws.derivws.com/websockets/v3?app_id=105747";
  const API_TOKEN = "YOUR_API_TOKEN_HERE"; // 🔒 Ton token Deriv ici

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
  let previousPrice = {};

  const volatilitySymbols = [
    "BOOM1000", "CRASH1000", "BOOM900", "CRASH900",
    "BOOM600", "CRASH600", "BOOM500", "CRASH500",
    "R_100", "R_75", "R_50", "R_25", "R_10"
  ];

  const setStatus = (txt) => (statusSpan.textContent = txt);
  const formatNum = (n) => Number(n).toFixed(2);

  // ------------------ Gauges ------------------
  function updateGauge(gaugeId, value, color = "#2962FF") {
    const circle = document.querySelector(`#${gaugeId} .meter`);
    const offset = 283 - (283 * value) / 100;
    circle.style.strokeDashoffset = offset;
    circle.style.stroke = color;
  }

  function updateAllGauges(vol, trend, prob) {
    updateGauge("volGauge", vol, vol > 60 ? "#e53935" : "#2962FF");
    updateGauge("trendGauge", trend, trend > 60 ? "#43a047" : "#2962FF");
    updateGauge("probGauge", prob, prob > 50 ? "#fbc02d" : "#2962FF");
  }

  // ------------------ Chart Init ------------------
  function initChart() {
    chartContainer.querySelector("canvas")?.remove();
    chart = LightweightCharts.createChart(chartContainer, {
      width: chartContainer.clientWidth,
      height: chartContainer.clientHeight,
      layout: { background: { type: "solid", color: "#fff" }, textColor: "#000" },
      grid: { vertLines: { color: "#eee" }, horzLines: { color: "#eee" } },
      timeScale: { timeVisible: true, secondsVisible: true },
    });

    areaSeries = chart.addAreaSeries({
      lineColor: "#2962FF",
      topColor: "rgba(41, 98, 255, 0.3)",
      bottomColor: "rgba(41, 98, 255, 0.05)",
      lineWidth: 2,
    });
  }

  // ------------------ Symbol List ------------------
  function initSymbols() {
    symbolList.innerHTML = "";
    volatilitySymbols.forEach((sym) => {
      const el = document.createElement("div");
      el.className = "symbolItem";
      el.id = `symbol-${sym}`;
      el.innerHTML = `
        <span>${sym}</span>
        <div class="progress"><div class="progress-inner"></div></div>
      `;
      el.onclick = () => selectSymbol(sym);
      symbolList.appendChild(el);
    });
    selectSymbol(currentSymbol);
  }

  function selectSymbol(sym) {
    currentSymbol = sym;
    document.querySelectorAll(".symbolItem").forEach((e) => e.classList.remove("selected"));
    document.getElementById(`symbol-${sym}`).classList.add("selected");
    chartData = [];
    initChart();
    subscribeTicks(sym);
  }

  // ------------------ Deriv WebSocket ------------------
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

      if (data.msg_type === "balance" && data.balance)
        userBalance.textContent = `Balance: ${formatNum(data.balance.balance)} ${data.balance.currency}`;

      if (data.msg_type === "tick" && data.tick) handleTick(data.tick);
    };

    ws.onclose = () => setStatus("Disconnected");
    ws.onerror = (e) => console.error("WS Error:", e);
  }

  function subscribeTicks(symbol) {
    if (ws && ws.readyState === WebSocket.OPEN)
      ws.send(JSON.stringify({ ticks: symbol, subscribe: 1 }));
  }

  function handleTick(tick) {
    const p = Number(tick.quote);
    const s = tick.symbol;
    const time = Math.floor(tick.epoch);

    const el = document.getElementById(`symbol-${s}`);
    if (!el) return;

    const inner = el.querySelector(".progress-inner");
    const prev = previousPrice[s] || p;
    const diff = p - prev;
    const percent = Math.min(Math.abs(diff / prev) * 100, 100);
    inner.style.width = `${percent}%`;
    inner.style.backgroundColor = diff >= 0 ? "#43a047" : "#e53935";

    previousPrice[s] = p;

    if (s === currentSymbol) {
      chartData.push({ time, value: p });
      if (chartData.length > 500) chartData.shift();
      areaSeries.setData(chartData);

      const vol = Math.min(Math.random() * 100, 100);
      const trend = Math.abs(diff) * 120;
      const prob = Math.random() * 100;
      updateAllGauges(vol, trend, prob);
    }
  }

  // ------------------ Init ------------------
  connectBtn.onclick = connectDeriv;
  initSymbols();
  initChart();
  window.addEventListener("resize", () => chart.resize(chartContainer.clientWidth, chartContainer.clientHeight));
});
