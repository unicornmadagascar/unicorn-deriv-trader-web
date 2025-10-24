import { createChart, AreaSeries } from 'lightweight-charts';

document.addEventListener("DOMContentLoaded", () => {
  const APP_ID = 105747;
  const WS_URL = `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;

  // UI Elements
  const tokenInput = document.getElementById("tokenInput");
  const connectBtn = document.getElementById("connectBtn");
  const statusSpan = document.getElementById("status");
  const userBalance = document.getElementById("userBalance");
  const symbolList = document.getElementById("symbolList");
  const chartContainer = document.getElementById("chartInner");

  let ws = null;
  let authorized = false;
  let currentSymbol = "BOOM1000";
  let chart = null;
  let areaSeries = null;
  let chartData = [];
  let lastPrices = {};

  const volatilitySymbols = [
    "BOOM1000","CRASH1000","BOOM900","CRASH900","BOOM600","CRASH600",
    "BOOM500","CRASH500","R_100","R_75","R_50","R_25","R_10"
  ];

  // ------------------ Helpers ------------------
  const formatNum = n => Number(n).toFixed(2);
  const setStatus = txt => statusSpan.textContent = txt;

  // ------------------ Init Chart ------------------
  function initChart() {
    chartContainer.innerHTML = "";
    chart = createChart(chartContainer, {
      layout: {
        textColor: 'black',
        background: { type: 'solid', color: 'white' }
      },
      grid: { vertLines:{color:"#eee"}, horzLines:{color:"#eee"} }
    });
    areaSeries = chart.addSeries(AreaSeries, {
      lineColor: '#2962FF',
      topColor: '#2962FF',
      bottomColor: 'rgba(41, 98, 255, 0.28)',
    });
  }

  // ------------------ Symbols List ------------------
  function initSymbols() {
    symbolList.innerHTML = "";
    volatilitySymbols.forEach(sym => {
      const el = document.createElement("div");
      el.className = "symbolItem";
      el.id = `symbol-${sym}`;

      let label = sym.startsWith("BOOM") ? `BOOM ${sym.slice(4)}` :
                  sym.startsWith("CRASH") ? `CRASH ${sym.slice(5)}` :
                  `VIX ${sym.split("_")[1]}`;
      el.innerHTML = `<span>${label}</span><span class="lastPrice">0</span>`;

      el.onclick = () => selectSymbol(sym);
      symbolList.appendChild(el);
    });
    highlightSelected();
  }

  function highlightSelected() {
    document.querySelectorAll(".symbolItem").forEach(el => {
      el.classList.toggle("selected", el.id === `symbol-${currentSymbol}`);
    });
  }

  function selectSymbol(sym) {
    currentSymbol = sym;
    chartData = [];
    initChart();
    highlightSelected();
    subscribeTicks(sym);
  }

  // ------------------ WebSocket ------------------
  function connectDeriv(token){
    if(ws) ws.close();

    ws = new WebSocket(WS_URL);
    ws.onopen = () => {
      setStatus("Connecting...");
      ws.send(JSON.stringify({ authorize: token }));
    };

    ws.onmessage = msg => {
      const data = JSON.parse(msg.data);

      // Authorization
      if(data.msg_type === "authorize" && data.authorize?.loginid){
        setStatus(`Connected: ${data.authorize.loginid}`);
        authorized = true;
        volatilitySymbols.forEach(sym => subscribeTicks(sym));
      }

      // Balance update
      if(data.msg_type === "balance" && data.balance){
        const bal = parseFloat(data.balance.balance).toFixed(2);
        const cur = data.balance.currency;
        userBalance.textContent = `Balance: ${bal} ${cur}`;
      }

      // Tick update
      if(data.msg_type === "tick" && data.tick){
        handleTick(data.tick);
      }
    };

    ws.onclose = () => setStatus("Disconnected");
    ws.onerror = e => console.error("WS Error:", e);
  }

  function subscribeTicks(symbol){
    if(ws && ws.readyState === WebSocket.OPEN){
      ws.send(JSON.stringify({ ticks: symbol, subscribe: 1 }));
    }
  }

  function handleTick(tick){
    const p = Number(tick.quote);
    lastPrices[tick.symbol] = p;

    // Update symbol list
    const el = document.getElementById(`symbol-${tick.symbol}`);
    if(el) el.querySelector(".lastPrice").textContent = formatNum(p);

    // Update chart if current symbol
    if(tick.symbol === currentSymbol && areaSeries){
      chartData.push({ time: Math.floor(tick.epoch), value: p });
      if(chartData.length > 600) chartData.shift();
      areaSeries.setData(chartData);
      chart.timeScale().fitContent();
    }
  }

  // ------------------ Connect Button ------------------
  connectBtn.onclick = () => {
    const token = tokenInput.value.trim();
    if(!token){ alert("Please enter your API token"); return; }
    connectDeriv(token);
  };

  // ------------------ Init ------------------
  initSymbols();
  initChart();
  selectSymbol(currentSymbol);

  // ------------------ Resize ------------------
  window.addEventListener("resize", ()=>{
    chart.resize(chartContainer.clientWidth, chartContainer.clientHeight);
  });
});
