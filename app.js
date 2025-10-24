// app.js - Unicorn Madagascar (modernisé avec Lightweight Chart)
document.addEventListener("DOMContentLoaded", () => {
  const APP_ID = 105747;
  const WS_URL = `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;
  const DEFAULT_SYMBOL = "BOOM1000";

  // UI elements
  const tokenInput = document.getElementById("tokenInput");
  const connectBtn = document.getElementById("connectBtn");
  const statusSpan = document.getElementById("status");
  const symbolList = document.getElementById("symbolList");
  const chartContainer = document.getElementById("chartInner");

  // App state
  let ws = null;
  let currentSymbol = DEFAULT_SYMBOL;
  let chart, areaSeries;
  let lastPrice = 0;
  let isConnected = false;

  // ===========================
  // 🟩 1️⃣ — INITIALISATION DU CHART
  // ===========================
  function initLightChart() {
    chartContainer.innerHTML = "";
    chart = LightweightCharts.createChart(chartContainer, {
      layout: {
        background: { color: "transparent" },
        textColor: "#d1d5db",
      },
      grid: {
        vertLines: { color: "#334155" },
        horzLines: { color: "#334155" },
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: true,
        borderColor: "#475569",
      },
      rightPriceScale: {
        borderColor: "#475569",
      },
      crosshair: {
        mode: LightweightCharts.CrosshairMode.Normal,
      },
      localization: {
        priceFormatter: p => p.toFixed(2),
      },
      width: chartContainer.clientWidth,
      height: chartContainer.clientHeight,
    });

    areaSeries = chart.addAreaSeries({
      lineColor: "#3b82f6",
      topColor: "rgba(59,130,246,0.4)",
      bottomColor: "rgba(59,130,246,0.05)",
      lineWidth: 2,
      crosshairMarkerVisible: true,
    });

    window.addEventListener("resize", () => {
      chart.applyOptions({
        width: chartContainer.clientWidth,
        height: chartContainer.clientHeight,
      });
    });

    console.log("📈 Lightweight chart initialized.");
  }

  // ===========================
  // 🟩 2️⃣ — ABONNEMENT AUX TICKS
  // ===========================
  function subscribeTicks(symbol) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    ws.send(JSON.stringify({ ticks_history: symbol, adjust_start_time: 1, count: 100, end: "latest", start: 1 }));
    ws.send(JSON.stringify({ ticks: symbol, subscribe: 1 }));
    statusSpan.textContent = `Subscribed to ${symbol}`;
  }

  function handleTickStream(data) {
    if (data.tick && data.tick.symbol === currentSymbol) {
      const price = parseFloat(data.tick.quote);
      const time = data.tick.epoch;
      lastPrice = price;
      areaSeries.update({ time, value: price });
    } else if (data.history) {
      const prices = data.history.prices;
      const times = data.history.times.map(t => parseInt(t));
      const seriesData = prices.map((p, i) => ({ time: times[i], value: parseFloat(p) }));
      areaSeries.setData(seriesData);
    }
  }

  // ===========================
  // 🟩 3️⃣ — CONNEXION WEBSOCKET
  // ===========================
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
        isConnected = true;
        setStatus("Connected ✅");
        subscribeTicks(currentSymbol);
      }
      if (["tick", "history"].includes(data.msg_type)) handleTickStream(data);
    };

    ws.onclose = () => {
      isConnected = false;
      setStatus("Disconnected 🔴");
    };

    ws.onerror = (err) => {
      console.error("WebSocket Error:", err);
      setStatus("Error ❌");
    };
  }

  function setStatus(text) {
    statusSpan.textContent = text;
  }

  // ===========================
  // 🟩 4️⃣ — CHANGEMENT DE SYMBOLE
  // ===========================
  function initSymbolList() {
    const symbols = ["BOOM1000", "CRASH1000", "BOOM900", "CRASH900"];
    symbolList.innerHTML = "";
    symbols.forEach(sym => {
      const el = document.createElement("div");
      el.textContent = sym;
      el.className = "symbol-item";
      el.onclick = () => {
        document.querySelectorAll(".symbol-item").forEach(e => e.classList.remove("active"));
        el.classList.add("active");
        currentSymbol = sym;
        areaSeries.setData([]);
        subscribeTicks(sym);
        setStatus(`Subscribed to ${sym}`);
      };
      if (sym === DEFAULT_SYMBOL) el.classList.add("active");
      symbolList.appendChild(el);
    });
  }

  // ===========================
  // 🟩 5️⃣ — ÉVÉNEMENTS UI
  // ===========================
  connectBtn.onclick = () => {
    if (!isConnected) connectDeriv();
    else setStatus("Already connected");
  };

  // ===========================
  // ⚙️ INIT TOUTE L’INTERFACE
  // ===========================
  initSymbolList();
  initLightChart();
  setStatus("Ready — enter token & connect.");
});
