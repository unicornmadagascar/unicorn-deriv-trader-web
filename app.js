document.addEventListener("DOMContentLoaded", () => {
  const APP_ID = 105747;
  const TOKEN = "wgf8TFDsJ8Ecvze"; // <-- mettez votre token ici
  const WS_URL = `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;

  // UI
  const connectBtn = document.getElementById("connectBtn");
  const symbolList = document.getElementById("symbolList");
  const chartInner = document.getElementById("chartInner");
  const volGauge = document.getElementById("volGauge");
  const trendGauge = document.getElementById("trendGauge");
  const probGauge = document.getElementById("probGauge");

  // zone info compte (créée dynamiquement)
  const accountInfo = document.createElement("div");
  accountInfo.id = "accountInfo";
  accountInfo.style.marginRight = "12px";
  accountInfo.style.fontSize = "14px";
  accountInfo.style.fontWeight = "600";
  accountInfo.style.color = "#333";
  connectBtn.parentNode.insertBefore(accountInfo, connectBtn);

  // state
  let ws = null;
  let chart = null;
  let areaSeries = null;
  let chartData = [];
  let lastPrices = {};
  let recentChanges = [];
  let connected = false;

  // Symbols (Deriv indices only)
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

  // helpers
  const fmt = n => Number(n).toFixed(2);
  const safe = v => (typeof v === "number" && !isNaN(v)) ? v : 0;

  // init symbol list
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

  // init chart
  function initChart() {
    try { if (chart) chart.remove(); } catch (e) {}

    chartInner.innerHTML = "";
    chart = LightweightCharts.createChart(chartInner, {
      layout: { textColor: '#333', background: { type: 'solid', color: '#ffffff' } },
      timeScale: { timeVisible: true, secondsVisible: true, rightOffset: 8 }
    });

    areaSeries = chart.addAreaSeries({
      lineColor: '#2962FF',
      topColor: 'rgba(41,98,255,0.28)',
      bottomColor: 'rgba(41,98,255,0.05)',
      lineWidth: 2
    });

    chartData = [];
  }

  // connect WS
  function connectDeriv() {
    if (connected) {
      // si déjà connecté, on déconnecte
      ws.close();
      connected = false;
      connectBtn.textContent = "Connect";
      accountInfo.textContent = "";
      console.log("Disconnected manually");
      return;
    }

    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      console.log("WS open — authorizing");
      ws.send(JSON.stringify({ authorize: TOKEN }));
    };

    ws.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data);

        if (data.msg_type === "authorize" && data.authorize) {
          connected = true;
          connectBtn.textContent = "Disconnect";
          const acc = data.authorize.loginid;
          const bal = fmt(data.authorize.balance);
          accountInfo.textContent = `${acc} | $${bal}`;

          // demander la balance en live
          ws.send(JSON.stringify({ balance: 1, subscribe: 1 }));

          // afficher symboles
          displaySymbols();
        }

        else if (data.msg_type === "balance" && data.balance) {
          const bal = fmt(data.balance.balance);
          accountInfo.textContent = `${data.balance.loginid} | $${bal}`;
        }

        else if (data.msg_type === "tick" && data.tick) {
          handleTick(data.tick);
        }

        else if (data.msg_type === "error") {
          console.warn("WS error:", data);
        }

      } catch (err) {
        console.error("WS message parse err", err);
      }
    };

    ws.onclose = () => {
      console.log("WS closed");
      connected = false;
      connectBtn.textContent = "Connect";
      accountInfo.textContent = "";
    };

    ws.onerror = (e) => {
      console.error("WS error", e);
      connected = false;
      connectBtn.textContent = "Connect";
      accountInfo.textContent = "";
    };
  }

  // subscribe symbol ticks
  function subscribeSymbol(symbol) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      connectDeriv();
      setTimeout(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ forget_all: "ticks" }));
          ws.send(JSON.stringify({ ticks: symbol }));
          console.log("Subscribed:", symbol);
        }
      }, 600);
    } else {
      ws.send(JSON.stringify({ forget_all: "ticks" }));
      ws.send(JSON.stringify({ ticks: symbol }));
      console.log("Subscribed:", symbol);
    }

    initChart();
  }

  // handle tick updates
  function handleTick(tick) {
    const symbol = tick.symbol;
    const quote = safe(Number(tick.quote));
    const epoch = Number(tick.epoch) || Math.floor(Date.now() / 1000);

    const prev = lastPrices[symbol] ?? quote;
    lastPrices[symbol] = quote;
    const change = quote - prev;
    recentChanges.push(change);
    if (recentChanges.length > 60) recentChanges.shift();

    updateGauges();

    if (areaSeries && chart) {
      const point = { time: epoch, value: quote };
      chartData.push(point);
      if (chartData.length > 600) chartData.shift();

      try {
        if (chartData.length === 1) areaSeries.setData(chartData);
        else areaSeries.update(point);
      } catch (e) {
        areaSeries.setData(chartData);
      }
      try { chart.timeScale().fitContent(); } catch (e) {}
    }
  }

  // compute gauges
  function updateGauges() {
    if (!recentChanges.length) return;
    const meanAbs = recentChanges.reduce((a, b) => a + Math.abs(b), 0) / recentChanges.length;
    const vol = Math.min(100, meanAbs * 1000);
    const sum = recentChanges.reduce((a, b) => a + b, 0);
    const trend = Math.min(100, Math.abs(sum) * 1000);
    const pos = recentChanges.filter(v => v > 0).length;
    const neg = recentChanges.filter(v => v < 0).length;
    const dominant = Math.max(pos, neg);
    const prob = recentChanges.length ? Math.round((dominant / recentChanges.length) * 100) : 50;

    setGauge(volGauge, vol, "#ff9800");
    setGauge(trendGauge, trend, "#2962FF");
    setGauge(probGauge, prob, "#4caf50");
  }

  function setGauge(el, percent, color) {
    const smoothPrev = parseFloat(el.dataset.prev || 0);
    const smooth = smoothPrev + (percent - smoothPrev) * 0.12;
    el.dataset.prev = smooth;
    const deg = Math.max(0, Math.min(360, smooth * 3.6));
    el.style.background = `conic-gradient(${color} ${deg}deg, #eee ${deg}deg)`;
    const span = el.querySelector("span");
    if (span) span.innerText = `${Math.round(smooth)}%`;
  }

  // button
  connectBtn.addEventListener("click", connectDeriv);

  // init
  displaySymbols();
  initChart();

  window.addEventListener("resize", () => {
    if (chart) {
      try { chart.resize(chartInner.clientWidth, chartInner.clientHeight); } catch (e) {}
    }
  });
});
