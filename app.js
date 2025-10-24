// app.js — Unicorn Madagascar (chart + symbol quotes modernisés)
document.addEventListener("DOMContentLoaded", () => {
  const APP_ID = 105747;
  const WS_URL = `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;
  const DEFAULT_SYMBOL = "BOOM1000";

  // UI elements
  const tokenInput = document.getElementById("tokenInput");
  const connectBtn = document.getElementById("connectBtn");
  const statusSpan = document.getElementById("status");
  const symbolList = document.getElementById("symbolList");
  const chartContainer = document.getElementById("tradingChart");

  // State
  let ws = null;
  let chart, areaSeries;
  let currentSymbol = DEFAULT_SYMBOL;
  let symbolQuotes = {}; // pour stocker les quotes en direct

  // ===============================
  // 1️⃣ Initialiser le chart avant tout
  // ===============================
  function initChart() {
    chartContainer.innerHTML = "";
    chart = LightweightCharts.createChart(chartContainer, {
      width: chartContainer.clientWidth,
      height: chartContainer.clientHeight,
      layout: {
        background: { color: "transparent" },
        textColor: "#0f172a",
      },
      grid: {
        vertLines: { color: "#e2e8f0" },
        horzLines: { color: "#e2e8f0" },
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: true,
      },
      crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
      rightPriceScale: {
        borderColor: "#cbd5e1",
      },
    });

    areaSeries = chart.addAreaSeries({
      lineColor: "#2563eb",
      topColor: "rgba(37,99,235,0.4)",
      bottomColor: "rgba(37,99,235,0.05)",
      lineWidth: 2,
      crosshairMarkerVisible: true,
    });

    window.addEventListener("resize", () => {
      chart.applyOptions({
        width: chartContainer.clientWidth,
        height: chartContainer.clientHeight,
      });
    });

    console.log("📊 Chart initialized for", currentSymbol);
  }

  // ===============================
  // 2️⃣ Gestion WebSocket
  // ===============================
  function connectDeriv() {
    const token = tokenInput.value.trim();
    if (!token) {
      alert("Please enter your Deriv API token.");
      return;
    }

    ws = new WebSocket(WS_URL);
    setStatus("Connecting...");

    ws.onopen = () => {
      setStatus("Authorizing...");
      ws.send(JSON.stringify({ authorize: token }));
    };

    ws.onmessage = (msg) => {
      const data = JSON.parse(msg.data);

      if (data.msg_type === "authorize") {
        setStatus("Connected ✅");
        subscribeSymbol(currentSymbol);
      }

      if (data.msg_type === "history") loadHistory(data);
      if (data.msg_type === "tick") updateTick(data.tick);
    };

    ws.onclose = () => setStatus("Disconnected 🔴");
    ws.onerror = () => setStatus("Error ❌");
  }

  // ===============================
  // 3️⃣ Abonnement aux ticks
  // ===============================
  function subscribeSymbol(symbol) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    areaSeries.setData([]);
    ws.send(JSON.stringify({ ticks_history: symbol, adjust_start_time: 1, count: 100, end: "latest", start: 1 }));
    ws.send(JSON.stringify({ ticks: symbol, subscribe: 1 }));
    setStatus(`Subscribed to ${symbol}`);
  }

  // ===============================
  // 4️⃣ Gestion des ticks & historique
  // ===============================
  function loadHistory(data) {
    const prices = data.history.prices;
    const times = data.history.times.map(t => parseInt(t));
    const chartData = prices.map((p, i) => ({ time: times[i], value: parseFloat(p) }));
    areaSeries.setData(chartData);
  }

  function updateTick(tick) {
    if (!tick || tick.symbol !== currentSymbol) return;
    const price = parseFloat(tick.quote);
    const time = tick.epoch;
    areaSeries.update({ time, value: price });
    symbolQuotes[tick.symbol] = price;
    updateSymbolQuotesUI(tick.symbol);
  }

  // ===============================
  // 5️⃣ UI — Liste des symboles + quotes
  // ===============================
  function initSymbolList() {
    const symbols = ["BOOM1000", "CRASH1000", "BOOM900", "CRASH900"];
    symbolList.innerHTML = "";
    symbols.forEach(sym => {
      const item = document.createElement("div");
      item.className = "symbol-item";
      item.innerHTML = `
        <span>${sym}</span>
        <span class="symbol-quote" id="quote-${sym}">--</span>
      `;
      item.onclick = () => {
        document.querySelectorAll(".symbol-item").forEach(e => e.classList.remove("active"));
        item.classList.add("active");
        currentSymbol = sym;
        subscribeSymbol(sym);
      };
      if (sym === DEFAULT_SYMBOL) item.classList.add("active");
      symbolList.appendChild(item);
    });
  }

  function updateSymbolQuotesUI(symbol) {
    const el = document.getElementById(`quote-${symbol}`);
    if (el) el.textContent = symbolQuotes[symbol]?.toFixed(2) ?? "--";
  }

  // ===============================
  // 6️⃣ Utilitaires
  // ===============================
  function setStatus(text) {
    statusSpan.textContent = text;
  }

  // ===============================
  // 7️⃣ Événements
  // ===============================
  connectBtn.onclick = () => {
    if (!ws || ws.readyState === WebSocket.CLOSED) connectDeriv();
    else setStatus("Already connected");
  };

  // ===============================
  // ⚙️ INIT
  // ===============================
  initChart();
  initSymbolList();
  setStatus("Ready — Enter token & connect");
});
