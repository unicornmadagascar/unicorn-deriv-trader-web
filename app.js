document.addEventListener("DOMContentLoaded", () => {
  const APP_ID = 105747;
  const WS_URL = `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;

  const tokenInput = document.getElementById("tokenInput");
  const connectBtn = document.getElementById("connectBtn");
  const statusSpan = document.getElementById("status");
  const userBalance = document.getElementById("userBalance");
  const symbolList = document.getElementById("symbolList");
  const chartInner = document.getElementById("chartInner");
  const gaugeDashboard = document.getElementById("gaugeDashboard");
  const buyBtn = document.getElementById("buyBtn");
  const sellBtn = document.getElementById("sellBtn");
  const closeBtn = document.getElementById("closeBtn");
  const historyList = document.getElementById("historyList");
  const stakeInput = document.getElementById("stake");
  const multiplierInput = document.getElementById("multiplier");
  const modeSelect = document.getElementById("modeSelect");

  let ws = null, currentSymbol = null, lastPrices = {}, chartData = [], chartTimes = [];
  let canvas, ctx, authorized = false;
  let trades = [];
  let tooltip = null;

  const volatilitySymbols = [
    "BOOM1000", "BOOM900", "BOOM600", "BOOM500", "BOOM300",
    "CRASH1000", "CRASH900", "CRASH600", "CRASH500"
  ];

  // === Symbols ===
  function initSymbols() {
    symbolList.innerHTML = "";
    volatilitySymbols.forEach(sym => {
      const div = document.createElement("div");
      div.className = "symbolItem";
      div.id = `symbol-${sym}`;
      div.textContent = sym;
      div.onclick = () => selectSymbol(sym);
      symbolList.appendChild(div);
    });
  }

  function selectSymbol(symbol) {
    currentSymbol = symbol;
    document.querySelectorAll(".symbolItem").forEach(el => el.classList.remove("active"));
    const sel = document.getElementById(`symbol-${symbol}`);
    if (sel) sel.classList.add("active");
    chartData = [];
    chartTimes = [];
    initCanvas();
    initGauges();
    subscribeTicks(symbol);
  }

  // === Canvas Chart ===
  function initCanvas() {
    chartInner.innerHTML = "";
    canvas = document.createElement("canvas");
    canvas.width = chartInner.clientWidth;
    canvas.height = chartInner.clientHeight;
    chartInner.appendChild(canvas);
    ctx = canvas.getContext("2d");

    tooltip = document.createElement("div");
    tooltip.style.position = "absolute";
    tooltip.style.background = "rgba(0,0,0,0.8)";
    tooltip.style.color = "#fff";
    tooltip.style.fontSize = "12px";
    tooltip.style.padding = "5px 8px";
    tooltip.style.borderRadius = "5px";
    tooltip.style.pointerEvents = "none";
    tooltip.style.display = "none";
    chartInner.appendChild(tooltip);

    canvas.addEventListener("mousemove", handleMouseMove);
    canvas.addEventListener("mouseleave", () => (tooltip.style.display = "none"));
  }

  function handleMouseMove(e) {
    if (!ctx || chartData.length === 0) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const padding = 50;
    const index = Math.floor(((x - padding) / (canvas.width - padding * 2)) * chartData.length);
    if (index < 0 || index >= chartData.length) return;

    const price = chartData[index];
    const time = chartTimes[index] ? new Date(chartTimes[index] * 1000).toLocaleTimeString() : "";

    tooltip.innerHTML = `Time: ${time}<br>Price: ${price.toFixed(2)}`;
    trades.forEach(tr => {
      if (Math.abs(tr.entry - price) < 0.0005) {
        tooltip.innerHTML += `<br><span style="color:red;">${tr.type} @ ${tr.entry.toFixed(2)}</span>`;
      }
    });

    tooltip.style.left = e.clientX - rect.left + 10 + "px";
    tooltip.style.top = e.clientY - rect.top - 30 + "px";
    tooltip.style.display = "block";
  }

  function drawChart() {
    if (!ctx || chartData.length === 0) return;
    const padding = 50;
    const w = canvas.width - padding * 2;
    const h = canvas.height - padding * 2;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const maxVal = Math.max(...chartData);
    const minVal = Math.min(...chartData);
    const range = maxVal - minVal || 1;

    // Axes
    ctx.strokeStyle = "#444";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding, padding);
    ctx.lineTo(padding, canvas.height - padding);
    ctx.lineTo(canvas.width - padding, canvas.height - padding);
    ctx.stroke();

    // Area chart
    ctx.beginPath();
    chartData.forEach((val, i) => {
      const x = padding + (i / (chartData.length - 1)) * w;
      const y = canvas.height - padding - ((val - minVal) / range) * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.lineTo(canvas.width - padding, canvas.height - padding);
    ctx.lineTo(padding, canvas.height - padding);
    ctx.closePath();

    const fillGrad = ctx.createLinearGradient(0, padding, 0, canvas.height - padding);
    fillGrad.addColorStop(0, "rgba(3,168,244,0.5)");
    fillGrad.addColorStop(1, "rgba(3,168,244,0)");
    ctx.fillStyle = fillGrad;
    ctx.fill();

    // Line
    ctx.beginPath();
    chartData.forEach((val, i) => {
      const x = padding + (i / (chartData.length - 1)) * w;
      const y = canvas.height - padding - ((val - minVal) / range) * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = "#03A8F4";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Draw trades
    trades.forEach(tr => {
      if (tr.symbol !== currentSymbol) return;
      const y = canvas.height - padding - ((tr.entry - minVal) / range) * h;
      ctx.setLineDash([5, 5]);
      ctx.strokeStyle = "red";
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(canvas.width - padding, y);
      ctx.stroke();
      ctx.setLineDash([]);

      const lastX = padding + ((chartData.length - 1) / (chartData.length - 1)) * w;
      ctx.fillStyle = "red";
      ctx.beginPath();
      if (tr.type === "BUY") {
        ctx.moveTo(lastX, y - 10);
        ctx.lineTo(lastX - 6, y);
        ctx.lineTo(lastX + 6, y);
      } else {
        ctx.moveTo(lastX, y + 10);
        ctx.lineTo(lastX - 6, y);
        ctx.lineTo(lastX + 6, y);
      }
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = "red";
      ctx.font = "12px Arial";
      ctx.textAlign = "left";
      ctx.fillText(tr.entry.toFixed(2), lastX + 8, y);
    });

    // Last tick current price
    const lastPrice = chartData[chartData.length - 1];
    const yLast = canvas.height - padding - ((lastPrice - minVal) / range) * h;
    ctx.fillStyle = "#00ff00";
    ctx.beginPath();
    ctx.arc(canvas.width - padding - 10, yLast, 5, 0, 2 * Math.PI);
    ctx.fill();
    ctx.fillStyle = "#0f0";
    ctx.font = "13px Arial";
    ctx.fillText(lastPrice.toFixed(2), canvas.width - padding - 60, yLast - 10);
  }

  // === Gauges ===
  function initGauges() {
    gaugeDashboard.innerHTML = "";
    ["Volatility", "ATR", "EMA"].forEach(name => {
      const c = document.createElement("canvas");
      c.width = 120;
      c.height = 120;
      c.dataset.gaugeName = name;
      gaugeDashboard.appendChild(c);
    });
  }

  function drawGauges() {
    gaugeDashboard.querySelectorAll("canvas").forEach(c => {
      let value = 0;
      if (c.dataset.gaugeName === "Volatility") value = calculateVolatility();
      else if (c.dataset.gaugeName === "ATR") value = calculateATR();
      else if (c.dataset.gaugeName === "EMA") value = calculateEMA();
      drawGauge(c, value);
    });
  }

  function drawGauge(canvas, value) {
    const ctx = canvas.getContext("2d");
    const w = canvas.width, h = canvas.height, radius = Math.min(w, h) / 2 - 12;
    ctx.clearRect(0, 0, w, h);
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, radius, 0, 2 * Math.PI);
    ctx.strokeStyle = "#ddd";
    ctx.lineWidth = 12;
    ctx.stroke();
    ctx.beginPath();
    const endAngle = (value / 100) * 2 * Math.PI;
    ctx.arc(w / 2, h / 2, radius, -Math.PI / 2, -Math.PI / 2 + endAngle);
    ctx.strokeStyle = "#2563eb";
    ctx.lineWidth = 12;
    ctx.stroke();
    ctx.fillStyle = "#333";
    ctx.font = "12px Arial";
    ctx.textAlign = "center";
    ctx.fillText(canvas.dataset.gaugeName, w / 2, h / 2 - 10);
    ctx.fillText(value.toFixed(1) + "%", w / 2, h / 2 + 10);
  }

  function calculateVolatility() { if (chartData.length < 2) return 0; const lastN = chartData.slice(-20); const max = Math.max(...lastN); const min = Math.min(...lastN); return ((max - min) / chartData[chartData.length - 1]) * 100; }
  function calculateATR() { if (chartData.length < 2) return 0; let sum = 0; for (let i = 1; i < chartData.length; i++) sum += Math.abs(chartData[i] - chartData[i - 1]); return (sum / (chartData.length - 1)) / Math.max(...chartData) * 100; }
  function calculateEMA(period = 20) { if (chartData.length < 2) return 0; let k = 2 / (period + 1); let ema = chartData[chartData.length - period] || chartData[0]; for (let i = chartData.length - period + 1; i < chartData.length; i++) ema = chartData[i] * k + ema * (1 - k); return (ema / Math.max(...chartData)) * 100; }

  // === Trades ===
  function executeTrade(type) {
    if (!currentSymbol || chartData.length === 0) return;
    const stake = parseFloat(stakeInput.value) || 1;
    const multiplier = parseInt(multiplierInput.value) || 100;
    const mode = modeSelect.value;
    const entry = chartData[chartData.length - 1];

    const trade = { symbol: currentSymbol, type, stake, multiplier, entry, timestamp: Date.now() };
    trades.push(trade);
    logHistory(`${type} ${currentSymbol} @ ${entry.toFixed(2)} stake:${stake}x${multiplier}`);
    drawChart();

    if (mode === "live" && ws && authorized) {
      const request = {
        buy: 1,
        price: 0,
        parameters: {
          amount: stake,
          basis: "stake",
          contract_type: type === "BUY" ? "MULTUP" : "MULTDOWN",
          currency: "USD",
          multiplier,
          symbol: currentSymbol
        }
      };
      ws.send(JSON.stringify(request));
    }
  }

  function closeAllTrades() {
    trades = [];
    drawChart();
    logHistory("Closed all trades");
  }

  buyBtn.onclick = () => executeTrade("BUY");
  sellBtn.onclick = () => executeTrade("SELL");
  closeBtn.onclick = () => closeAllTrades();

  // === WebSocket ===
  connectBtn.onclick = () => {
    const token = tokenInput.value.trim() || null;
    ws = new WebSocket(WS_URL);
    ws.onopen = () => {
      setStatus("Connected");
      if (token) authorize(token);
      else initSymbols();
    };
    ws.onmessage = msg => handleMessage(JSON.parse(msg.data));
    ws.onclose = () => setStatus("Disconnected");
    ws.onerror = () => setStatus("Error");
  };

  function handleMessage(data) {
    if (data.msg_type === "authorize") {
      if (data.error) { logHistory("❌ Invalid token"); setStatus("Simulation mode"); return; }
      authorized = true;
      setStatus(`Authorized: ${data.authorize.loginid}`);
      getBalance();
    }
    if (data.msg_type === "balance" && data.balance?.balance != null)
      userBalance.textContent = `Balance: ${parseFloat(data.balance.balance).toFixed(2)} USD`;

    if (data.msg_type === "tick" && data.tick?.symbol) {
      const tick = data.tick, symbol = tick.symbol, price = Number(tick.quote);
      if (symbol === currentSymbol) {
        chartData.push(price); chartTimes.push(tick.epoch);
        if (chartData.length > 300) { chartData.shift(); chartTimes.shift(); }
        drawChart(); drawGauges();
      }
      lastPrices[symbol] = price;
    }
  }

  function authorize(token) { ws.send(JSON.stringify({ authorize: token })); }
  function getBalance() { ws.send(JSON.stringify({ balance: 1, subscribe: 1 })); }
  function subscribeTicks(symbol) { if (!ws || ws.readyState !== WebSocket.OPEN) return; ws.send(JSON.stringify({ ticks: symbol, subscribe: 1 })); }

  function logHistory(txt) {
    const div = document.createElement("div");
    div.textContent = `${new Date().toLocaleTimeString()} — ${txt}`;
    historyList.prepend(div);
  }

  function setStatus(txt) { statusSpan.textContent = txt; }

  setStatus("Ready. Connect and select a symbol.");
  initSymbols();
});
