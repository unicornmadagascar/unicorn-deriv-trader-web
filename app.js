// app.js - Unicorn Madagascar (complete)
// Requires the index.html you provided (gaugeDashboard, chartInner, etc.)

document.addEventListener("DOMContentLoaded", () => {
  const APP_ID = 105747; // public/test app_id (works for demo). You can replace with your own if desired.
  const WS_URL = `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;

  // UI elements
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
  const pnlDisplay = document.getElementById("pnl");

  // state
  let ws = null;
  let authorized = false;
  let currentSymbol = null;
  const lastPrices = {};
  let chartData = [];   // array of prices (raw ticks)
  let chartTimes = [];  // corresponding epoch seconds
  let trades = [];      // open simulated trades
  let canvas, ctx;
  let gaugeSmoothers = { volatility: 0, rsi: 0, emaProb: 0 };
  const SMA_WINDOW = 20;

  // default symbols (you confirmed)
  const volatilitySymbols = ["BOOM1000", "CRASH1000", "BOOM500", "CRASH500"];

  // Tooltip
  const tooltip = document.createElement("div");
  tooltip.style.position = "fixed";
  tooltip.style.padding = "6px 10px";
  tooltip.style.background = "rgba(0,0,0,0.85)";
  tooltip.style.color = "#fff";
  tooltip.style.fontSize = "12px";
  tooltip.style.borderRadius = "6px";
  tooltip.style.pointerEvents = "none";
  tooltip.style.display = "none";
  tooltip.style.zIndex = 9999;
  document.body.appendChild(tooltip);

  // helpers
  function logHistory(txt) {
    const d = document.createElement("div");
    d.textContent = `${new Date().toLocaleTimeString()} — ${txt}`;
    historyList.prepend(d);
  }
  function setStatus(txt) { statusSpan.textContent = txt; }
  function formatNum(n) { return Number(n).toFixed(2); }

  // init symbols list
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

  // select symbol
  function selectSymbol(sym) {
    currentSymbol = sym;
    document.querySelectorAll(".symbolItem").forEach(e => e.classList.remove("active"));
    const el = document.getElementById(`symbol-${sym}`);
    if (el) el.classList.add("active");
    chartData = [];
    chartTimes = [];
    trades = []; // reset simulated open trades on symbol change
    initCanvas();
    initGauges();
    subscribeTicks(sym);
    logHistory(`Selected ${sym}`);
  }

  // canvas init
  function initCanvas() {
    chartInner.innerHTML = "";
    canvas = document.createElement("canvas");
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    // set pixel width/height to match computed size for crispness
    canvas.width = chartInner.clientWidth;
    canvas.height = chartInner.clientHeight;
    chartInner.appendChild(canvas);
    ctx = canvas.getContext("2d");
    canvas.addEventListener("mousemove", canvasMouseMove);
    canvas.addEventListener("mouseleave", () => { tooltip.style.display = "none"; });
    // ensure gauge dashboard is above canvas (exists in DOM)
  }

  // gauges init
  function initGauges() {
    gaugeDashboard.innerHTML = "";
    ["Volatility", "RSI", "EMA"].forEach(name => {
      const c = document.createElement("canvas");
      c.width = 120;
      c.height = 120;
      c.dataset.gaugeName = name;
      c.style.width = "120px";
      c.style.height = "120px";
      gaugeDashboard.appendChild(c);
    });
  }

  // draw gauges (with smoothing)
  function drawGauges() {
    const canvases = gaugeDashboard.querySelectorAll("canvas");
    canvases.forEach(c => {
      let value = 0;
      if (c.dataset.gaugeName === "Volatility") value = computeVolatility();
      else if (c.dataset.gaugeName === "RSI") value = computeRSI();
      else if (c.dataset.gaugeName === "EMA") value = computeEMAProb();
      // smoothing (exponential) to avoid heavy flicker
      const key = (c.dataset.gaugeName === "Volatility") ? "volatility" : (c.dataset.gaugeName === "RSI" ? "rsi" : "emaProb");
      gaugeSmoothers[key] = gaugeSmoothers[key] * 0.85 + value * 0.15;
      renderGauge(c, gaugeSmoothers[key]);
    });
  }

  function renderGauge(canvas, value) {
    const gctx = canvas.getContext("2d");
    const w = canvas.width, h = canvas.height;
    const radius = Math.min(w, h) / 2 - 10;
    gctx.clearRect(0, 0, w, h);

    // background ring
    gctx.beginPath();
    gctx.arc(w/2, h/2, radius, 0, 2 * Math.PI);
    gctx.strokeStyle = "#eee";
    gctx.lineWidth = 12;
    gctx.stroke();

    // colored arc
    const end = (-Math.PI/2) + (Math.max(0, Math.min(100, value)) / 100) * 2 * Math.PI;
    gctx.beginPath();
    gctx.arc(w/2, h/2, radius, -Math.PI/2, end);
    gctx.strokeStyle = "#2563eb";
    gctx.lineWidth = 12;
    gctx.stroke();

    // label
    gctx.fillStyle = "#222";
    gctx.font = "12px Inter, Arial";
    gctx.textAlign = "center";
    gctx.textBaseline = "middle";
    gctx.fillText(canvas.dataset.gaugeName, w/2, h/2 - 12);
    gctx.fillText(value.toFixed(1) + "%", w/2, h/2 + 12);
  }

  // computations based on tick history (chartData)
  function computeVolatility() {
    if (chartData.length < 2) return 0;
    const lastN = chartData.slice(-SMA_WINDOW);
    const mean = lastN.reduce((a,b)=>a+b,0)/lastN.length;
    const variance = lastN.reduce((a,b)=>a + Math.pow(b-mean,2),0)/lastN.length;
    // map variance relatively to last price to convert to percent
    const relative = (Math.sqrt(variance) / (chartData[chartData.length-1] || 1)) * 100;
    // clamp
    return Math.min(100, relative*1.5);
  }

  // RSI-like speed measure (we map RSI 0..100)
  function computeRSI(period = 14) {
    if (chartData.length < period + 1) return 0;
    const closes = chartData.slice(- (period + 1));
    let gains = 0, losses = 0;
    for (let i = 1; i < closes.length; i++) {
      const diff = closes[i] - closes[i-1];
      if (diff > 0) gains += diff; else losses += Math.abs(diff);
    }
    if (gains + losses === 0) return 50;
    const rs = gains / Math.max(1, losses);
    const rsi = 100 - (100 / (1 + rs));
    return rsi; // 0..100
  }

  // EMA trend probability -> compute slope of EMA and map to 0-100
  function computeEMAProb(short = 10, long = 50) {
    if (chartData.length < long) return 50;
    // compute EMA short & long
    const shortEma = emaArray(chartData, short).slice(-1)[0];
    const longEma = emaArray(chartData, long).slice(-1)[0];
    const diff = shortEma - longEma;
    // normalize by price range
    const px = chartData[chartData.length-1] || 1;
    const prob = 50 + (diff / px) * 500; // scaling factor
    return Math.max(0, Math.min(100, prob));
  }

  function emaArray(arr, period) {
    const k = 2 / (period + 1);
    const res = [];
    let ema = arr[0];
    res.push(ema);
    for (let i = 1; i < arr.length; i++) {
      ema = arr[i]*k + ema*(1-k);
      res.push(ema);
    }
    return res;
  }

  // draw chart (area + line + current tick + trades markers)
  function drawChart() {
    if (!ctx || chartData.length === 0) return;
    const padding = 50;
    const w = canvas.width - padding*2;
    const h = canvas.height - padding*2;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // background gradient
    const bg = ctx.createLinearGradient(0, 0, 0, canvas.height);
    bg.addColorStop(0, "#f9fbff");
    bg.addColorStop(1, "#e9f2ff");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // min/max
    const maxVal = Math.max(...chartData);
    const minVal = Math.min(...chartData);
    const range = maxVal - minVal || 1;

    // axes
    ctx.strokeStyle = "#666";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding, padding);
    ctx.lineTo(padding, canvas.height - padding);
    ctx.lineTo(canvas.width - padding, canvas.height - padding);
    ctx.stroke();

    // y grid + labels
    ctx.strokeStyle = "#e6eef9";
    ctx.fillStyle = "#2b3a4a";
    ctx.font = "12px Inter, Arial";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let i=0;i<=5;i++){
      const y = canvas.height - padding - (i/5)*h;
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(canvas.width - padding, y);
      ctx.stroke();
      const v = minVal + (i/5)*range;
      ctx.fillText(v.toFixed(2), padding - 10, y);
    }

    // x labels (sparse)
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const len = chartData.length;
    const step = Math.max(1, Math.ceil(len/6));
    for (let i=0;i<len;i+=step){
      const x = padding + (i/(len-1))*w;
      const t = chartTimes[i] ? new Date(chartTimes[i]*1000).toLocaleTimeString().slice(0,8) : "";
      ctx.fillText(t, x, canvas.height - padding + 5);
    }

    // area (no smoothing)
    ctx.beginPath();
    for (let i=0;i<len;i++){
      const x = padding + (i/(len-1))*w;
      const y = canvas.height - padding - ((chartData[i]-minVal)/range)*h;
      if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    }
    ctx.lineTo(canvas.width - padding, canvas.height - padding);
    ctx.lineTo(padding, canvas.height - padding);
    ctx.closePath();
    const fillGrad = ctx.createLinearGradient(0, padding, 0, canvas.height - padding);
    fillGrad.addColorStop(0, "rgba(0,123,255,0.35)");
    fillGrad.addColorStop(1, "rgba(0,123,255,0.08)");
    ctx.fillStyle = fillGrad;
    ctx.fill();

    // line
    ctx.beginPath();
    for (let i=0;i<len;i++){
      const x = padding + (i/(len-1))*w;
      const y = canvas.height - padding - ((chartData[i]-minVal)/range)*h;
      if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    }
    ctx.strokeStyle = "#007bff";
    ctx.lineWidth = 2;
    ctx.stroke();

    // draw trades markers (arrow + dashed line + price label)
    trades.forEach(tr => {
      if (tr.symbol !== currentSymbol) return;
      // find index nearest to entry time/price: if we have stored epoch, match index by closest price/time.
      // We'll approximate marker x as the last x (current) to show entry on rightmost column
      const x = padding + ((len-1)/(len-1))*w;
      const y = canvas.height - padding - ((tr.entry - minVal)/range)*h;

      // dotted line
      ctx.setLineDash([6,4]);
      ctx.strokeStyle = "rgba(220,38,38,0.9)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(canvas.width - padding, y);
      ctx.stroke();
      ctx.setLineDash([]);

      // arrow (triangle)
      ctx.fillStyle = tr.type === "BUY" ? "green" : "red";
      ctx.beginPath();
      if (tr.type === "BUY") {
        ctx.moveTo(x, y - 10);
        ctx.lineTo(x - 8, y);
        ctx.lineTo(x + 8, y);
      } else {
        ctx.moveTo(x, y + 10);
        ctx.lineTo(x - 8, y);
        ctx.lineTo(x + 8, y);
      }
      ctx.closePath();
      ctx.fill();

      // price label
      ctx.fillStyle = tr.type === "BUY" ? "green" : "red";
      ctx.font = "12px Inter, Arial";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(formatNum(tr.entry), x + 12, y);
    });

    // current tick line & label
    const lastPrice = chartData[len-1];
    const yCur = canvas.height - padding - ((lastPrice - minVal)/range)*h;
    ctx.strokeStyle = "#16a34a"; // green
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(padding, yCur);
    ctx.lineTo(canvas.width - padding, yCur);
    ctx.stroke();

    // dot at right
    ctx.fillStyle = "#16a34a";
    ctx.beginPath();
    ctx.arc(canvas.width - padding, yCur, 4, 0, Math.PI*2);
    ctx.fill();

    // label of last price (slightly left)
    ctx.fillStyle = "#064e3b";
    ctx.font = "13px Inter, Arial";
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.fillText(formatNum(lastPrice), canvas.width - padding - 6, yCur - 6);
  }

  // canvas mouse move -> tooltip
  function canvasMouseMove(e) {
    if (!canvas || chartData.length === 0) return;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const padding = 50;
    const w = canvas.width - padding*2;
    const len = chartData.length;
    let idx = Math.round((mouseX - padding) / w * (len - 1));
    idx = Math.max(0, Math.min(idx, len - 1));
    const price = chartData[idx];
    const time = chartTimes[idx] ? new Date(chartTimes[idx]*1000).toLocaleTimeString().slice(0,8) : "";
    // list trades for this symbol
    let tradesHtml = "";
    trades.forEach(tr => {
      if (tr.symbol !== currentSymbol) return;
      tradesHtml += `<div style="color:${tr.type==="BUY"?"#0ea5a4":"#ef4444"}">${tr.type} @ ${formatNum(tr.entry)} stake:${tr.stake} mult:${tr.multiplier}</div>`;
    });
    tooltip.style.display = "block";
    tooltip.style.left = (e.clientX + 12) + "px";
    tooltip.style.top = (e.clientY - 36) + "px";
    tooltip.innerHTML = `<div><strong>${currentSymbol}</strong></div>
                         <div>Price: ${formatNum(price)}</div>
                         <div>Time: ${time}</div>
                         ${tradesHtml}`;
  }

  // ---- Trades: simulation + live (proposal -> buy) ----
  // We'll implement proposal -> buy flow:
  // 1) send proposal request (proposal:1...)
  // 2) server returns 'proposal' message containing 'proposal' object with 'id'
  // 3) we send buy using that proposal id: { buy: <proposal.id>, subscribe: 1 }
  // For demo tokens this usually works; if Deriv API differs for you, paste the server response and I adapt.

  const pendingProposals = new Map(); // req_id -> tradeContext

  function executeTrade(type) {
    if (!currentSymbol || chartData.length === 0) return;
    const stake = parseFloat(stakeInput.value) || 1;
    const multiplier = parseInt(multiplierInput.value) || 100;
    const mode = modeSelect.value;
    const entry = chartData[chartData.length - 1];

    const trade = {
      symbol: currentSymbol,
      type,
      stake,
      multiplier,
      entry,
      timestamp: Date.now(),
      id: `sim-${Date.now()}-${Math.random().toString(36).slice(2,8)}`
    };

    trades.push(trade);
    logHistory(`${type} ${currentSymbol} @ ${formatNum(entry)} stake:${stake} mult:${multiplier}`);

    if (mode === "simulation") {
      // no server call, local PnL updated on ticks
      updatePnL();
      return;
    }

    // live mode -> send proposal
    if (!ws || ws.readyState !== WebSocket.OPEN || !authorized) {
      logHistory("WebSocket not ready or not authorized — can't execute live trade");
      return;
    }

    const orderType = (type === "BUY") ? "MULTUP" : "MULTDOWN";

    // generate unique req_id
    const req_id = Math.floor(Math.random() * 1000000);

    const proposalRequest = {
      proposal: 1,
      amount: stake,
      basis: "stake",
      contract_type: orderType,
      currency: "USD",
      symbol: currentSymbol,
      duration: 60,
      duration_unit: "s",
      multiplier: multiplier,
      subscribe: 1,
      req_id
    };

    pendingProposals.set(req_id, { trade, stake, multiplier, type });
    ws.send(JSON.stringify(proposalRequest));
    logHistory(`Sent proposal request req_id=${req_id} for ${type} ${currentSymbol}`);
  }

  // handle buy using proposal id (server returns 'proposal' object)
  function handleProposalResponse(proposal) {
    // proposal should have `id` or `proposal.id` or `proposal.request_id` depending on API
    // Many times Deriv returns field 'proposal' containing { id: <id>, ask_price:..., ... } and echo_req contains req_id.
    // We'll try to extract proposal.id and echo_req.req_id
    const echo = (proposal.echo_req || {});
    const req_id = echo.req_id || echo.request_id || null;
    const proposalId = proposal.proposal && (proposal.proposal.id || proposal.proposal_id) ? (proposal.proposal.id || proposal.proposal_id) : (proposal.id || null);

    // If the server returns directly with 'proposal' top-level:
    const prop = proposal.proposal || proposal;

    // Prefer to find id
    const id = prop.id || prop.proposal_id || proposal.id || null;

    if (req_id && pendingProposals.has(req_id)) {
      const ctx = pendingProposals.get(req_id);
      // send buy using id if present
      if (id) {
        const buyReq = {
          buy: id,
          subscribe: 1
        };
        ws.send(JSON.stringify(buyReq));
        logHistory(`Sent buy for proposal id=${id}`);
        pendingProposals.delete(req_id);
      } else {
        logHistory("Proposal response received but no id found; check server response");
      }
    } else {
      // if no pending proposal, ignore or log
      // Some servers return proposal without echo_req, try buy if id exists and user expects it.
      if (id) {
        logHistory(`Received proposal id=${id} (no matching req_id). Not auto-buying.`);
      }
    }
  }

  // on buy contract response (server might return 'buy' or 'contract' messages)
  function handleBuyResponse(data) {
    // Deriv may send 'buy' / 'contract' / 'proposal_open_contract' messages.
    // We'll log and if contains 'contract_id' or 'proposal_open_contract' we'll display in history.
    if (data.buy) {
      logHistory(`Buy response: ${JSON.stringify(data.buy).slice(0,120)}`);
    }
    if (data.proposal_open_contract) {
      // contains details of opened contract (id, entry, current_spot, payout, etc.)
      const poc = data.proposal_open_contract;
      logHistory(`Opened contract id=${poc.contract_id || poc.id || 'unknown'} payout:${poc.payout || poc.amount || 'n/a'}`);
    }
  }

  // update PnL display
  function updatePnL() {
    if (chartData.length === 0) {
      pnlDisplay.textContent = "PnL: --";
      return;
    }
    const priceNow = chartData[chartData.length - 1];
    let pnl = 0;
    trades.forEach(tr => {
      const delta = tr.type === "BUY" ? (priceNow - tr.entry) : (tr.entry - priceNow);
      pnl += delta * (tr.stake || 1);
    });
    pnlDisplay.textContent = "PnL: " + pnl.toFixed(2);
  }

  // websocket connect
  connectBtn.onclick = () => {
    const token = tokenInput.value.trim() || null;
    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      setStatus("Connected to Deriv WebSocket");
      logHistory("WS open");
      if (token) {
        // send authorize
        ws.send(JSON.stringify({ authorize: token }));
      } else {
        // show symbols (still can subscribe without authorize for public ticks)
        initSymbols();
        logHistory("No token provided — using public tick subscription (simulation/live limited)");
      }
    };

    ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        // handle different msg types
        if (data.msg_type === "authorize") {
          if (data.error) {
            logHistory("Authorize error: invalid token");
            setStatus("Simulation mode (invalid token)");
            authorized = false;
            initSymbols();
            return;
          }
          authorized = true;
          setStatus(`Authorized: ${data.authorize && data.authorize.loginid ? data.authorize.loginid : 'user'}`);
          logHistory("Authorized");
          // ask balance
          ws.send(JSON.stringify({ balance: 1, subscribe: 1 }));
          initSymbols();
        } else if (data.msg_type === "balance") {
          if (data.balance && data.balance.balance != null) {
            userBalance.textContent = `Balance: ${parseFloat(data.balance.balance).toFixed(2)} ${data.balance.currency || 'USD'}`;
          }
        } else if (data.msg_type === "tick" && data.tick) {
          const tick = data.tick;
          const symbol = tick.symbol;
          const price = Number(tick.quote);
          lastPrices[symbol] = price;
          // if symbol matches currentSymbol, push to chart
          if (symbol === currentSymbol) {
            chartData.push(price);
            chartTimes.push(tick.epoch);
            if (chartData.length > 600) {
              chartData.shift();
              chartTimes.shift();
            }
            drawChart();
            drawGauges();
            updatePnL();
          }
          // update symbol list display (last price) if present
          const symbolEl = document.getElementById(`symbol-${symbol}`);
          if (symbolEl) {
            // show last price as subtle text (append span if not exists)
            let span = symbolEl.querySelector(".lastPrice");
            if (!span) {
              span = document.createElement("span");
              span.className = "lastPrice";
              span.style.float = "right";
              span.style.opacity = "0.8";
              symbolEl.appendChild(span);
            }
            span.textContent = formatNum(price);
          }
        } else if (data.msg_type === "proposal") {
          // proposal response (may include echo_req.req_id)
          handleProposalResponse(data);
        } else if (data.msg_type === "buy" || data.msg_type === "proposal_open_contract" || data.msg_type === "contract") {
          handleBuyResponse(data);
        } else {
          // other messages: optionally log for debug (comment out if verbose)
          // console.debug("WS:", data.msg_type || data);
        }
      } catch (err) {
        console.error("WS parse error", err);
      }
    };

    ws.onclose = () => {
      setStatus("WebSocket disconnected");
      logHistory("WS closed");
      authorized = false;
    };

    ws.onerror = (err) => {
      console.error("WS error", err);
      setStatus("WebSocket error");
    };
  };

  // subscribe to ticks
  function subscribeTicks(symbol) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      // still allow: try to open WS automatically
      logHistory("WS not open — can't subscribe yet. Connect first.");
      return;
    }
    try {
      ws.send(JSON.stringify({ ticks: symbol, subscribe: 1 }));
      logHistory(`Subscribed to ticks: ${symbol}`);
    } catch (e) {
      console.error("subscribeTicks error", e);
    }
  }

  // utility: log to history
  function logHistory(txt) {
    const d = document.createElement("div");
    d.textContent = `${new Date().toLocaleTimeString()} — ${txt}`;
    historyList.prepend(d);
  }

  // hook buttons
  buyBtn.onclick = () => executeTrade("BUY");
  sellBtn.onclick = () => executeTrade("SELL");
  closeBtn.onclick = () => {
    trades = [];
    updatePnL();
    logHistory("Closed all trades (local)");
  };

  // auto redraw/gauge update interval (keeps gauges smoother)
  setInterval(() => {
    if (canvas && chartData.length > 0) {
      drawChart();
      drawGauges();
    }
  }, 600);

  // initialize UI
  setStatus("Ready. Connect and select a symbol.");
  initSymbols();
  initCanvas();
  initGauges();
});
