document.addEventListener("DOMContentLoaded", () => {
  const APP_ID = 105747;
  const WS_URL = `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;

  const tokenInput = document.getElementById("tokenInput");
  const connectBtn = document.getElementById("connectBtn");
  const statusSpan = document.getElementById("status");
  const userBalance = document.getElementById("userBalance");
  const symbolList = document.getElementById("symbolList");
  const chartInner = document.getElementById("chartInner");
  const buyBtn = document.getElementById("buyBtn");
  const sellBtn = document.getElementById("sellBtn");
  const closeBtn = document.getElementById("closeBtn");
  const historyList = document.getElementById("historyList");
  const stakeInput = document.getElementById("stake");
  const multiplierInput = document.getElementById("timeframe");
  const modeSelect = document.getElementById("modeSelect");
  const pnlDisplay = document.getElementById("pnl");

  let ws = null, currentSymbol = null, lastPrices = {};
  let chartData = [], chartTimes = [], trades = [];
  let chart, areaSeries, authorized = false;

  const volatilitySymbols = ["BOOM1000","BOOM900","BOOM600","BOOM500","BOOM300","CRASH1000","CRASH900","CRASH600","CRASH500"];

  // --- Tooltip ---
  const tooltip = document.createElement("div");
  tooltip.style.position = "absolute";
  tooltip.style.padding = "6px 10px";
  tooltip.style.background = "rgba(0,0,0,0.8)";
  tooltip.style.color = "#fff";
  tooltip.style.fontSize = "12px";
  tooltip.style.borderRadius = "4px";
  tooltip.style.pointerEvents = "none";
  tooltip.style.display = "none";
  chartInner.appendChild(tooltip);

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
    initChart();
    subscribeTicks(symbol);
  }

  function initChart() {
    chartInner.innerHTML = "";
    chart = LightweightCharts.createChart(chartInner, {
      width: chartInner.clientWidth,
      height: chartInner.clientHeight,
      layout: { backgroundColor: 'var(--bg-panel)', textColor: 'var(--text-main)' },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false },
    });

    areaSeries = chart.addAreaSeries({
      topColor: 'rgba(3, 168, 244, 0.5)',
      bottomColor: 'rgba(3, 168, 244, 0)',
      lineColor: '#03A8F4',
      lineWidth: 2,
    });

    chart.subscribeCrosshairMove((param) => {
      if (!param || !param.time) { tooltip.style.display = "none"; return; }
      const price = param.seriesData.get(areaSeries);
      if (!price) return;

      let text = `Price: ${price.toFixed(2)}`;
      trades.forEach(tr => {
        if (tr.symbol !== currentSymbol) return;
        text += `\n${tr.type} @ ${tr.entry.toFixed(2)} stake:${tr.stake} mult:${tr.multiplier}`;
      });

      tooltip.style.display = "block";
      tooltip.style.left = (param.point.x + 15) + "px";
      tooltip.style.top = (param.point.y - 30) + "px";
      tooltip.innerHTML = text.replace(/\n/g, "<br>");
    });
  }

  function updateChart() {
    if (!areaSeries) return;
    const data = chartData.map((price, idx) => ({ time: chartTimes[idx], value: price }));
    areaSeries.setData(data);

    // Draw trade markers
    trades.forEach(tr => {
      if (tr.symbol !== currentSymbol) return;
      const marker = {
        time: chartTimes[chartTimes.length - 1],
        position: tr.type === "BUY" ? "aboveBar" : "belowBar",
        color: "red",
        shape: "arrowDown",
        text: tr.entry.toFixed(2)
      };
      areaSeries.setMarkers([marker]);
    });
  }

  function executeTrade(type) {
    if (!currentSymbol || chartData.length === 0) return;
    const stake = parseFloat(stakeInput.value) || 1;
    const multiplier = parseInt(multiplierInput.value) || 100;
    const mode = modeSelect.value;
    const entry = chartData[chartData.length - 1];

    const trade = {symbol: currentSymbol, type, stake, multiplier, entry, timestamp: Date.now()};
    trades.push(trade);
    logHistory(`${type} ${currentSymbol} @ ${entry.toFixed(2)} stake:${stake} mult:${multiplier}`);
    updatePnL();
    updateChart();

    if (mode === "live" && ws && authorized) {
      const proposalReq = {
        proposal: 1,
        amount: stake,
        basis: "stake",
        contract_type: type === "BUY" ? "CALL" : "PUT",
        currency: "USD",
        symbol: currentSymbol,
        duration: 60,
        duration_unit: "s",
        multiplier: multiplier
      };
      ws.send(JSON.stringify(proposalReq));
    }
  }

  function updatePnL() {
    let pnl = 0;
    const currentPrice = chartData[chartData.length - 1];
    trades.forEach(tr => {
      pnl += tr.type === "BUY" ? (currentPrice - tr.entry) * tr.stake : (tr.entry - currentPrice) * tr.stake;
    });
    pnlDisplay.textContent = "PnL: " + pnl.toFixed(2);
  }

  buyBtn.onclick = () => executeTrade("BUY");
  sellBtn.onclick = () => executeTrade("SELL");
  closeBtn.onclick = () => { trades = []; updatePnL(); updateChart(); logHistory("Closed all trades"); }

  connectBtn.onclick = () => {
    const token = tokenInput.value.trim() || null;
    ws = new WebSocket(WS_URL);
    ws.onopen = () => { setStatus("Connected to Deriv WebSocket"); if (token) authorize(token); else initSymbols(); };
    ws.onmessage = msg => handleMessage(JSON.parse(msg.data));
    ws.onclose = () => setStatus("WebSocket disconnected");
    ws.onerror = () => setStatus("WebSocket error");
  };

  function handleMessage(data) {
    if (data.msg_type === "authorize") {
      if (data.error) { logHistory("❌ Invalid token"); setStatus("Simulation mode"); return; }
      authorized = true; setStatus(`Authorized: ${data.authorize.loginid}`); getBalance();
    }
    if (data.msg_type === "balance" && data.balance?.balance != null)
      userBalance.textContent = `Balance: ${parseFloat(data.balance.balance).toFixed(2)} USD`;
    if (data.msg_type === "tick" && data.tick?.symbol) {
      const tick = data.tick, symbol = tick.symbol, price = Number(tick.quote);
      if (symbol === currentSymbol) {
        chartData.push(price); chartTimes.push(tick.epoch);
        if (chartData.length > 300) { chartData.shift(); chartTimes.shift(); }
        updateChart(); updatePnL();
      }
      lastPrices[symbol] = price;
    }
  }

  function authorize(token) { ws.send(JSON.stringify({ authorize: token })); }
  function getBalance() { ws.send(JSON.stringify({ balance: 1, subscribe: 1 })); }
  function subscribeTicks(symbol) { if (!ws || ws.readyState !== WebSocket.OPEN) return; ws.send(JSON.stringify({ ticks: symbol, subscribe: 1 })); }
  function logHistory(txt) { const div = document.createElement("div"); div.textContent = `${new Date().toLocaleTimeString()} — ${txt}`; historyList.prepend(div); }
  function setStatus(txt) { statusSpan.textContent = txt; }

  setStatus("Ready. Connect and select a symbol.");
  initSymbols();
});
