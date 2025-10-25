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

  // Élément pour afficher compte + balance
  const accountInfo = document.createElement("div");
  accountInfo.id = "accountInfo";
  accountInfo.style.display = "inline-block";
  accountInfo.style.marginRight = "10px";
  accountInfo.style.fontSize = "14px";
  accountInfo.style.fontWeight = "600";
  accountInfo.style.color = "#333";
  connectBtn.parentNode.insertBefore(accountInfo, connectBtn);

  let ws = null;
  let chart = null;
  let areaSeries = null;
  let chartData = [];
  let lastPrices = {};
  let recentChanges = [];

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

  function initChart() {
    try { if (chart) chart.remove(); } catch (e) {}
    chartInner.innerHTML = "";

    chart = LightweightCharts.createChart(chartInner, {
      layout: { textColor: '#333', background: { type: 'solid', color: '#fff' } },
      timeScale: { timeVisible: true, secondsVisible: true }
    });

    areaSeries = chart.addSeries(LightweightCharts.AreaSeries, {
      lineColor: '#2962FF',
      topColor: 'rgba(41,98,255,0.28)',
      bottomColor: 'rgba(41,98,255,0.05)',
      lineWidth: 2,
      lineType: LightweightCharts.LineType.Smooth
    });

    chartData = [];

    // Positionner les gauges dans le chart
    positionGauges();
  }

  function positionGauges() {
    // Conteneur pour toutes les gauges
    let gaugesContainer = document.getElementById("gaugesContainer");
    if (!gaugesContainer) {
      gaugesContainer = document.createElement("div");
      gaugesContainer.id = "gaugesContainer";
      gaugesContainer.style.position = "absolute";
      gaugesContainer.style.top = "10px";
      gaugesContainer.style.left = "10px";
      gaugesContainer.style.display = "flex";
      gaugesContainer.style.gap = "10px";
      gaugesContainer.style.opacity = "0.9";
      gaugesContainer.style.zIndex = "10";
      chartInner.style.position = "relative";
      chartInner.appendChild(gaugesContainer);
      gaugesContainer.appendChild(volGauge);
      gaugesContainer.appendChild(trendGauge);
      gaugesContainer.appendChild(probGauge);
    }
  }

  function connectDeriv() {
    const accountInfo = document.getElementById("accountInfo");
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close();
      ws = null;
      connectBtn.textContent = "Connect";
      accountInfo.textContent = "";
      return;
    }

    ws = new WebSocket(WS_URL);
    connectBtn.textContent = "Connecting...";
    accountInfo.textContent = "Connecting...";

    ws.onopen = () => {
      ws.send(JSON.stringify({ authorize: TOKEN }));
    };

    ws.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data);
        if (data.msg_type === "authorize" && data.authorize) {
          const acc = data.authorize.loginid;
          const bal = data.authorize.balance;
          const currency = data.authorize.currency || "";
          connectBtn.textContent = "Disconnect";
          accountInfo.textContent = `Account: ${acc} | Balance: ${bal.toFixed(2)} ${currency}`;

          ws.send(JSON.stringify({ balance: 1, subscribe: 1 }));
          displaySymbols();
        }

        else if (data.msg_type === "balance" && data.balance) {
          accountInfo.textContent = `Account: ${data.balance.loginid} | Balance: ${data.balance.balance.toFixed(2)} ${data.balance.currency}`;
        }

        else if (data.msg_type === "tick" && data.tick) {
          handleTick(data.tick);
        }
      } catch (err) {
        console.error("WS parse err", err);
      }
    };

    ws.onclose = () => {
      connectBtn.textContent = "Connect";
      accountInfo.textContent = "";
      ws = null;
    };
  }

  function subscribeSymbol(symbol) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      connectDeriv();
      setTimeout(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ forget_all: "ticks" }));
          ws.send(JSON.stringify({ ticks: symbol }));
        }
      }, 600);
    } else {
      ws.send(JSON.stringify({ forget_all: "ticks" }));
      ws.send(JSON.stringify({ ticks: symbol }));
    }
    initChart();
  }

  function handleTick(tick) {
    const symbol = tick.symbol;
    const quote = safe(Number(tick.quote));
    const epoch = Number(tick.epoch) || Math.floor(Date.now() / 1000);

    const prev = lastPrices[symbol] ?? quote;
    lastPrices[symbol] = quote;
    const change = quote - prev;
    recentChanges.push(change);
    if (recentChanges.length > 60) recentChanges.shift();

    updateCircularGauges();

    if (areaSeries && chart) {
      const point = { time: epoch, value: quote };
      chartData.push(point);
      if (chartData.length > 600) chartData.shift();
      areaSeries.setData(chartData);
      try { chart.timeScale().fitContent(); } catch(e){}
    }
  }

  // === 🟢 GAUGES AGRANDIES ET DÉPLACÉES ===
  function updateCircularGauges() {
    if (!recentChanges.length) return;
    const meanAbs = recentChanges.reduce((a,b)=>a+Math.abs(b),0)/recentChanges.length;
    const vol = Math.min(100, meanAbs * 1000);
    const sum = recentChanges.reduce((a,b)=>a+b,0);
    const trend = Math.min(100, Math.abs(sum) * 1000);
    const pos = recentChanges.filter(v=>v>0).length;
    const neg = recentChanges.filter(v=>v<0).length;
    const dominant = Math.max(pos,neg);
    const prob = recentChanges.length ? Math.round((dominant/recentChanges.length)*100) : 50;

    drawCircularGauge(volGauge, vol, "#ff9800");
    drawCircularGauge(trendGauge, trend, "#2962FF");
    drawCircularGauge(probGauge, prob, "#4caf50");
  }

  function drawCircularGauge(container, value, color) {
    const size = 110; // ✅ plus grand
    if (!container.querySelector("canvas")) {
      const c = document.createElement("canvas");
      c.width = c.height = size;
      c.style.borderRadius = "50%";
      c.style.display = "block";
      c.style.margin = "auto";
      container.innerHTML = "";
      container.appendChild(c);

      const label = document.createElement("div");
      label.style.textAlign = "center";
      label.style.marginTop = "-85px";
      label.style.fontSize = "16px";
      label.style.fontWeight = "700";
      label.style.color = "#333";
      container.appendChild(label);
    }

    const canvas = container.querySelector("canvas");
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0,0,size,size);

    const center = size/2;
    const radius = size/2 - 8;
    const start = -Math.PI/2;
    const end = start + (Math.min(value,100)/100)*2*Math.PI;

    // fond gris
    ctx.beginPath();
    ctx.arc(center,center,radius,0,2*Math.PI);
    ctx.strokeStyle = "#eee";
    ctx.lineWidth = 8;
    ctx.stroke();

    // arc coloré
    ctx.beginPath();
    ctx.arc(center,center,radius,start,end);
    ctx.strokeStyle = color;
    ctx.lineWidth = 8;
    ctx.lineCap = "round";
    ctx.stroke();

    const label = container.querySelector("div");
    label.textContent = `${Math.round(value)}%`;
  }

  connectBtn.addEventListener("click", () => {
    connectDeriv();
    displaySymbols();
  });

  displaySymbols();
  initChart();
});
