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

  let smoothVol = 0;
  let smoothTrend = 0;

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
      gaugesContainer.style.top = "8px";
      gaugesContainer.style.left = "8px";
      gaugesContainer.style.display = "flex";
      gaugesContainer.style.gap = "12px";
      gaugesContainer.style.opacity = "0.95";
      gaugesContainer.style.zIndex = "12";
      gaugesContainer.style.pointerEvents = "none"; // évite d'interférer avec le chart
      chartInner.style.position = "relative";
      chartInner.appendChild(gaugesContainer);

      // chaque gauge reçoit son conteneur (pour label + pourcent)
      const vCont = createGaugeWrapper("volGaugeWrapper");
      const tCont = createGaugeWrapper("trendGaugeWrapper");
      const pCont = createGaugeWrapper("probGaugeWrapper");

      // insérer dans le DOM : on place les wrappers dans gaugesContainer
      gaugesContainer.appendChild(vCont.wrapper);
      gaugesContainer.appendChild(tCont.wrapper);
      gaugesContainer.appendChild(pCont.wrapper);

      // déplacer les éléments existants (les div fournis) DANS chaque wrapper
      // cela préserve tout style utilisateur sur volGauge, trendGauge, probGauge
      vCont.content.appendChild(volGauge);
      tCont.content.appendChild(trendGauge);
      pCont.content.appendChild(probGauge);

      // créer les noms des gauges
      const nameVol = document.createElement("div");
      nameVol.textContent = "Volatility";
      nameVol.style.textAlign = "center";
      nameVol.style.fontSize = "13px";
      nameVol.style.fontWeight = "600";
      nameVol.style.marginTop = "6px";
      nameVol.style.pointerEvents = "none";

      const nameTrend = document.createElement("div");
      nameTrend.textContent = "Tendance";
      nameTrend.style.textAlign = "center";
      nameTrend.style.fontSize = "13px";
      nameTrend.style.fontWeight = "600";
      nameTrend.style.marginTop = "6px";
      nameTrend.style.pointerEvents = "none";

      const nameProb = document.createElement("div");
      nameProb.textContent = "Probabilité";
      nameProb.style.textAlign = "center";
      nameProb.style.fontSize = "13px";
      nameProb.style.fontWeight = "600";
      nameProb.style.marginTop = "6px";
      nameProb.style.pointerEvents = "none";

      // ajouter les noms sous chaque wrapper
      vCont.wrapper.appendChild(nameVol);
      tCont.wrapper.appendChild(nameTrend);
      pCont.wrapper.appendChild(nameProb);
    }
  }

  // crée une structure wrapper qui garde le container original (content)
  function createGaugeWrapper(id) {
    const wrapper = document.createElement("div");
    wrapper.id = id;
    wrapper.style.display = "flex";
    wrapper.style.flexDirection = "column";
    wrapper.style.alignItems = "center";
    wrapper.style.width = "140px"; // espace suffisant pour canvas + label
    wrapper.style.pointerEvents = "none";

    // zone interne (où on placera l'élément original du DOM)
    const content = document.createElement("div");
    content.style.width = "100%";
    content.style.pointerEvents = "none";

    wrapper.appendChild(content);
    return { wrapper, content };
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

          // Abonnement balance en temps réel
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

  // === 🟢 GAUGES AGRANDIES, AVEC LABELS ===
  function updateCircularGauges() {
   if (!recentChanges.length) return;

   // === 🔹 1. Écart-type comme mesure de volatilité ===
   const mean = recentChanges.reduce((a, b) => a + b, 0) / recentChanges.length;
   const variance = recentChanges.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / recentChanges.length;
   const stdDev = Math.sqrt(variance); // écart-type

   // Normalisation en probabilité 0–100 %
   // Ajuste le facteur selon la sensibilité de ta gauge
   const volProb = Math.min(100, (stdDev / 0.07) * 100);

   // === 🔹 2. Tendance brute (somme des variations) ===
   const sum = recentChanges.reduce((a, b) => a + b, 0);
   const trendRaw = Math.min(100, Math.abs(sum) * 1000);

   // === 🔹 3. Probabilité de direction dominante ===
   const pos = recentChanges.filter(v => v > 0).length;
   const neg = recentChanges.filter(v => v < 0).length;
   const dominant = Math.max(pos, neg);
   const prob = recentChanges.length ? Math.round((dominant / recentChanges.length) * 100) : 50;

   // === 🔹 4. Lissage EMA pour stabilité ===
   const alpha = 0.08; // plus petit = plus lisse
   smoothVol = smoothVol === 0 ? volProb : smoothVol + alpha * (volProb - smoothVol);
   smoothTrend = smoothTrend === 0 ? trendRaw : smoothTrend + alpha * (trendRaw - smoothTrend);

   // === 🔹 5. Dessin des jauges ===
   drawCircularGauge(volGauge, smoothVol, "#ff9800"); // Volatilité basée sur écart-type
   drawCircularGauge(trendGauge, smoothTrend, "#2962FF");
   drawCircularGauge(probGauge, prob, "#4caf50");
  }

  function drawCircularGauge(container, value, color) {
    const size = 110; // taille des anneaux
    // Ensure container exists and is visible
    container.style.width = size + "px";
    container.style.height = (size + 28) + "px"; // laisser place pour label en dessous

    // Create canvas + percent label if not exists
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

    pct.textContent = `${Math.round(value)}%`;
  }

  // wire up connect button
  connectBtn.addEventListener("click", () => {
    connectDeriv();
    displaySymbols();
  });

  displaySymbols();
  initChart();

  // reposition gauges on resize (keeps them inside chart)
  window.addEventListener("resize", () => {
    try { positionGauges(); } catch(e){}
    if (chart) {
      try { chart.resize(chartInner.clientWidth, chartInner.clientHeight); } catch(e){}
    }
  });
});
