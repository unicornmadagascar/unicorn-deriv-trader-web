// app.js - Unicorn Madagascar (demo live ticks) + Real Multiplier Request (Deriv API)
document.addEventListener("DOMContentLoaded", () => {
  const APP_ID = 105747;
  const WS_URL = `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;

  // UI
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
  const tpInput = document.getElementById("tp");
  const slInput = document.getElementById("sl");
  const modeSelect = document.getElementById("modeSelect");
  const pnlDisplay = document.getElementById("pnl");

  let ws = null;
  let authorized = false;
  let currentSymbol = null;
  let lastPrices = {};
  let chartData = [];
  let chartTimes = [];
  let trades = [];
  let canvas, ctx;
  let gaugeSmoothers = { volatility: 0, rsi: 0, emaProb: 0 };
  const SMA_WINDOW = 20;
  const volatilitySymbols = [
    "BOOM1000", "CRASH1000", "BOOM900", "CRASH900",
    "BOOM600", "CRASH600", "BOOM500", "CRASH500"
  ];

  // Helpers
  function logHistory(txt) {
    const d = document.createElement("div");
    d.textContent = `${new Date().toLocaleTimeString()} — ${txt}`;
    historyList.prepend(d);
  }
  function setStatus(txt) { statusSpan.textContent = txt; }
  function formatNum(n) { return Number(n).toFixed(2); }

  // === Symbol List ===
  function initSymbols() {
    symbolList.innerHTML = "";
    volatilitySymbols.forEach(sym => {
      const el = document.createElement("div");
      el.className = "symbolItem";
      el.id = `symbol-${sym}`;
      el.textContent = sym;
      el.onclick = () => selectSymbol(sym);
      symbolList.appendChild(el);
    });
  }

  function selectSymbol(sym) {
    currentSymbol = sym;
    document.querySelectorAll(".symbolItem").forEach(e => e.classList.remove("active"));
    const el = document.getElementById(`symbol-${sym}`);
    if (el) el.classList.add("active");
    chartData = [];
    chartTimes = [];
    trades = [];
    initCanvas();
    initGauges();
    subscribeTicks(sym);
    logHistory(`Selected ${sym}`);
  }

  // === Canvas ===
  function initCanvas() {
    chartInner.innerHTML = "";
    canvas = document.createElement("canvas");
    canvas.width = chartInner.clientWidth;
    canvas.height = chartInner.clientHeight;
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    chartInner.appendChild(canvas);
    ctx = canvas.getContext("2d");
  }

  // === Gauges ===
  function initGauges() {
    gaugeDashboard.innerHTML = "";
    ["Volatility", "RSI", "EMA"].forEach(name => {
      const c = document.createElement("canvas");
      c.width = c.height = 120;
      c.dataset.gaugeName = name;
      gaugeDashboard.appendChild(c);
    });
  }

  // === Tick Handling ===
  function subscribeTicks(symbol) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ ticks: symbol, subscribe: 1 }));
    logHistory(`Subscribed to ticks: ${symbol}`);
  }

  function handleTick(tick) {
    const p = Number(tick.quote);
    const symbol = tick.symbol;
    lastPrices[symbol] = p;
    if (symbol === currentSymbol) {
      chartData.push(p);
      chartTimes.push(tick.epoch);
      if (chartData.length > 600) {
        chartData.shift();
        chartTimes.shift();
      }
      drawChart();
      updatePnL();
    }
  }

  // === Trade Execution ===
  function executeTrade(type) {
    if (!authorized) {
      logHistory("❌ Connect your account first");
      return;
    }
    if (!currentSymbol || !chartData.length) {
      logHistory("⚠️ No active symbol selected");
      return;
    }

    const stake = parseFloat(stakeInput.value) || 1;
    const multiplier = parseInt(multiplierInput.value) || 100;
    const tp = parseFloat(tpInput.value) || 1.0;
    const sl = parseFloat(slInput.value) || 1.0;
    const contractType = type === "BUY" ? "MULTUP" : "MULTDOWN";

    const req = {
      buy: 1,
      price: "1.00",
      parameters: {
        contract_type: contractType,
        symbol: currentSymbol.toLowerCase(),
        currency: "USD",
        basis: "stake",
        amount: stake.toFixed(2),
        multiplier: multiplier,
        limit_order: {
          take_profit: tp,
          stop_loss: sl
        }
      }
    };

    ws.send(JSON.stringify(req));
    logHistory(`📤 Sent ${contractType} request for ${currentSymbol} (Stake ${stake}, Mult ${multiplier})`);
  }

  // === WebSocket ===
  connectBtn.onclick = () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close();
      ws = null;
      setStatus("Disconnected");
      connectBtn.textContent = "Connect";
      return;
    }

    const token = tokenInput.value.trim();
    if (!token) {
      setStatus("Simulation Mode");
      logHistory("Running without token (simulation)");
      return;
    }

    ws = new WebSocket(WS_URL);
    setStatus("Connecting...");

    ws.onopen = () => {
      ws.send(JSON.stringify({ authorize: token }));
    };

    ws.onmessage = (msg) => {
      const data = JSON.parse(msg.data);

      if (data.msg_type === "authorize") {
        if (!data.authorize?.loginid) {
          setStatus("Token not authorized");
          return;
        }
        authorized = true;
        setStatus(`Connected: ${data.authorize.loginid}`);
        ws.send(JSON.stringify({ balance: 1, subscribe: 1 }));
        volatilitySymbols.forEach(sym => subscribeTicks(sym));
      }

      if (data.msg_type === "balance" && data.balance) {
        const bal = parseFloat(data.balance.balance || 0).toFixed(2);
        const cur = data.balance.currency || "USD";
        userBalance.textContent = `Balance: ${bal} ${cur}`;
      }

      if (data.msg_type === "tick" && data.tick) handleTick(data.tick);

      // 🟢 When the BUY response is received → Add trade to chart
      if (data.msg_type === "buy" && data.buy) {
        const tr = {
          symbol: currentSymbol,
          type: data.buy.longcode.includes("MULTUP") ? "BUY" : "SELL",
          entry: parseFloat(data.buy.buy_price),
          stake: parseFloat(stakeInput.value),
          multiplier: parseInt(multiplierInput.value),
          tp: parseFloat(tpInput.value),
          sl: parseFloat(slInput.value),
          timestamp: Date.now(),
          id: data.buy.contract_id
        };
        trades.push(tr);
        drawChart();
        updatePnL();
        logHistory(`✅ ${tr.type} confirmed for ${currentSymbol} @ ${tr.entry.toFixed(2)}`);
      }

      if (data.error) {
        logHistory(`⚠️ Error: ${data.error.message}`);
      }
    };

    ws.onclose = () => setStatus("Disconnected");
    ws.onerror = (e) => logHistory("WebSocket error: " + JSON.stringify(e));

    connectBtn.textContent = "Disconnect";
  };

  // === Chart Drawing (reuse your original drawChart & updatePnL) ===
  function drawChart() {
    // (ton code complet de drawChart ici, inchangé)
  }

  function updatePnL() {
    if (!chartData.length || !trades.length) {
      pnlDisplay.textContent = "0";
      return;
    }
    const lastPrice = chartData[chartData.length - 1];
    let pnl = 0;
    trades.forEach(tr => {
      const diff = tr.type === "BUY" ? lastPrice - tr.entry : tr.entry - lastPrice;
      pnl += diff * tr.multiplier * tr.stake;
    });
    pnlDisplay.textContent = pnl.toFixed(2);
  }

  // === Buttons ===
  buyBtn.onclick = () => executeTrade("BUY");
  sellBtn.onclick = () => executeTrade("SELL");
  closeBtn.onclick = () => { trades = []; drawChart(); updatePnL(); };

  initSymbols();
  selectSymbol(volatilitySymbols[0]);
});
