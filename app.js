// app.js - Unicorn Madagascar (modernisé)

import { createChart } from 'lightweight-charts';

document.addEventListener("DOMContentLoaded", () => {
  const APP_ID = 105747;
  const WS_URL = `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;

  // UI elements
  const tokenInput = document.getElementById("tokenInput");
  const connectBtn = document.getElementById("connectBtn");
  const statusSpan = document.getElementById("status");
  const userBalance = document.getElementById("userBalance");
  const symbolList = document.getElementById("symbolList");
  const chartContainer = document.getElementById("chartInner");

  // global state
  let ws = null;
  let authorized = false;
  let currentSymbol = null;
  let lastPrices = {};
  let chartData = [];
  let chartTimes = [];
  let chart = null;
  let areaSeries = null;

  const volatilitySymbols = ["BOOM1000","CRASH1000","BOOM900","CRASH900","BOOM600","CRASH600","BOOM500","CRASH500",
                             "R_100","R_75","R_50","R_25","R_10"];

  // helpers
  const formatNum = n => Number(n).toFixed(2);
  const setStatus = txt => { statusSpan.textContent = txt; };
  const logHistory = txt => console.log(`[History] ${txt}`);

  // ----------------------------
  // Symbol List Initialization
  // ----------------------------
  function initSymbols() {
    symbolList.innerHTML = "";
    volatilitySymbols.forEach(sym => {
      const el = document.createElement("div");
      el.className = "symbolItem";
      el.id = `symbol-${sym}`;
      el.style.cursor = "pointer";
      el.style.padding = "6px 12px";
      el.style.borderBottom = "1px solid #ddd";
      el.style.display = "flex";
      el.style.justifyContent = "space-between";
      el.style.backgroundColor = "#fff";
      el.textContent = sym;
      const quoteSpan = document.createElement("span");
      quoteSpan.className = "lastPrice";
      quoteSpan.textContent = "-";
      el.appendChild(quoteSpan);

      el.onclick = () => selectSymbol(sym);
      symbolList.appendChild(el);
    });
  }

  function selectSymbol(sym) {
    currentSymbol = sym;
    chartData = [];
    chartTimes = [];

    document.querySelectorAll(".symbolItem").forEach(e => e.style.backgroundColor = "#fff");
    const el = document.getElementById(`symbol-${sym}`);
    if(el) el.style.backgroundColor = "#f0f0f0";

    initChart();
    if(ws && ws.readyState === WebSocket.OPEN) subscribeTicks(sym);
  }

  // ----------------------------
  // Chart Initialization
  // ----------------------------
  function initChart() {
    if(!chart) {
      chart = createChart(chartContainer, {
        width: chartContainer.clientWidth,
        height: chartContainer.clientHeight,
        layout: { backgroundColor: "#ffffff", textColor: "#000" },
        grid: { vertLines: { color: '#eee' }, horzLines: { color: '#eee' } },
        rightPriceScale: { borderColor: '#ccc' },
        timeScale: { borderColor: '#ccc' }
      });
      areaSeries = chart.addAreaSeries({
        lineColor: '#3b82f6',
        topColor: 'rgba(59,130,246,0.4)',
        bottomColor: 'rgba(59,130,246,0.1)'
      });
    } else {
      areaSeries.setData([]);
    }
  }

  function drawChart() {
    if(!areaSeries || chartData.length === 0) return;
    const data = chartData.map((p,i) => ({ time: chartTimes[i], value: p }));
    areaSeries.setData(data);
  }

  // ----------------------------
  // WebSocket / Tick Handling
  // ----------------------------
  function subscribeTicks(symbol) {
    if(!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ ticks: symbol, subscribe: 1 }));
    logHistory(`Subscribed to ticks: ${symbol}`);
  }

  function handleTick(tick) {
    const p = Number(tick.quote);
    const sym = tick.symbol;
    lastPrices[sym] = p;

    const symbolEl = document.getElementById(`symbol-${sym}`);
    if(symbolEl) symbolEl.querySelector(".lastPrice").textContent = formatNum(p);

    if(sym === currentSymbol) {
      chartData.push(p);
      chartTimes.push(tick.epoch);
      if(chartData.length > 600){ chartData.shift(); chartTimes.shift(); }
      drawChart();
    }
  }

  // ----------------------------
  // Connect / Disconnect
  // ----------------------------
  connectBtn.onclick = () => {
    if(ws && ws.readyState === WebSocket.OPEN) {
      ws.close();
      ws = null;
      setStatus("Disconnected");
      connectBtn.textContent = "Connect";
      return;
    }

    const token = tokenInput.value.trim();
    if(!token) {
      setStatus("Simulation Mode");
      logHistory("Running in simulation (no token)");
      return;
    }

    ws = new WebSocket(WS_URL);
    setStatus("Connecting...");

    ws.onopen = () => {
      setStatus("Connected, authorizing...");
      ws.send(JSON.stringify({ authorize: token }));
    };

    ws.onclose = () => setStatus("Disconnected");
    ws.onerror = e => logHistory("WS error " + JSON.stringify(e));

    ws.onmessage = msg => {
      const data = JSON.parse(msg.data);

      // authorized
      if(data.msg_type === "authorize" && data.authorize?.loginid) {
        authorized = true;
        setStatus(`Connected: ${data.authorize.loginid}`);
        volatilitySymbols.forEach(sym => subscribeTicks(sym));
        ws.send(JSON.stringify({ balance: 1, subscribe: 1 }));
      }

      // balance
      if(data.msg_type === "balance" && data.balance) {
        const bal = parseFloat(data.balance.balance||0).toFixed(2);
        const cur = data.balance.currency||"USD";
        userBalance.textContent = `Balance: ${bal} ${cur}`;
      }

      // tick
      if(data.msg_type === "tick" && data.tick) handleTick(data.tick);
    };

    connectBtn.textContent = "Disconnect";
  };

  // ----------------------------
  // Init
  // ----------------------------
  initSymbols();
  selectSymbol(volatilitySymbols[0]);
});
