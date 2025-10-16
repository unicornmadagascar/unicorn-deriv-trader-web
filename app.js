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
  const lotInput = document.getElementById("lot");
  const stakeInput = document.getElementById("stake");
  const modeSelect = document.getElementById("modeSelect");

  let ws = null, currentSymbol = null, lastPrices = {}, chartData = [], chartTimes = [];
  let canvas, ctx, authorized = false;
  let trades = [], balance = 1000; // simulation balance

  const volatilitySymbols = ["BOOM1000","BOOM900","BOOM600","BOOM500","BOOM300","CRASH1000","CRASH900","CRASH600","CRASH500"];

  // Tooltip
  const tooltip = document.createElement("div");
  tooltip.style.position = "absolute";
  tooltip.style.padding = "4px 8px";
  tooltip.style.background = "rgba(0,0,0,0.7)";
  tooltip.style.color = "#fff";
  tooltip.style.fontSize = "12px";
  tooltip.style.borderRadius = "4px";
  tooltip.style.pointerEvents = "none";
  tooltip.style.display = "none";
  chartInner.appendChild(tooltip);

  // === Symbols ===
  function initSymbols() {
    symbolList.innerHTML = "";
    volatilitySymbols.forEach(sym => {
      const div = document.createElement("div");
      div.className = "symbolItem";
      div.id = `symbol-${sym}`;
      div.textContent = sym; // remove arrows
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
    canvas.addEventListener("mousemove", handleMouseMove);
    canvas.addEventListener("mouseleave", () => tooltip.style.display = "none");
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

    // Background
    const bgGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
    bgGrad.addColorStop(0, "#f9faff");
    bgGrad.addColorStop(1, "#e6f0ff");
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Area chart (gradient)
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
    fillGrad.addColorStop(0, "rgba(0,123,255,0.4)");
    fillGrad.addColorStop(1, "rgba(0,123,255,0.1)");
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
    ctx.strokeStyle = "#007bff";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  function handleMouseMove(e) {
    if (!canvas || chartData.length === 0) return;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const padding = 50;
    const w = canvas.width - padding * 2;
    const len = chartData.length;
    let nearestIndex = Math.round((mouseX - padding) / w * (len - 1));
    nearestIndex = Math.max(0, Math.min(nearestIndex, len - 1));
    const price = chartData[nearestIndex];
    const time = chartTimes[nearestIndex] ? new Date(chartTimes[nearestIndex] * 1000).toLocaleTimeString().slice(0, 8) : "";
    tooltip.style.display = "block";
    tooltip.style.left = (e.clientX + 15) + "px";
    tooltip.style.top = (e.clientY - 30) + "px";
    tooltip.innerHTML = `${currentSymbol}<br>${price.toFixed(2)}<br>${time}`;
  }

  // === Gauges ===
  function initGauges() {
    gaugeDashboard.innerHTML = "";
    ["Volatility", "ATR", "EMA"].forEach(name => {
      const c = document.createElement("canvas");
      c.width = 120;
      c.height = 120;
      c.dataset.gaugeName = name;
      c.style.marginRight = "10px";
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
    ctx.arc(w / 2, h / 2, radius, -Math.PI/2, -Math.PI/2 + endAngle);
    ctx.strokeStyle = "#2563eb";
    ctx.lineWidth = 12;
    ctx.stroke();
    ctx.fillStyle = "#333";
    ctx.font = "12px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(canvas.dataset.gaugeName, w/2, h/2 - 10);
    ctx.fillText(value.toFixed(1) + "%", w/2, h/2 + 10);
  }

  function calculateVolatility() {
    if(chartData.length<2)return 0;
    const lastN=chartData.slice(-20);
    const max=Math.max(...lastN), min=Math.min(...lastN);
    return ((max-min)/chartData[chartData.length-1])*100;
  }

  function calculateATR() {
    if(chartData.length<2)return 0;
    let trSum=0;
    for(let i=1;i<chartData.length;i++) trSum+=Math.abs(chartData[i]-chartData[i-1]);
    return (trSum/(chartData.length-1))/Math.max(...chartData)*100;
  }

  function calculateEMA(period=20){
    if(chartData.length<2)return 0;
    let k=2/(period+1), ema=chartData[chartData.length-period]||chartData[0];
    for(let i=chartData.length-period+1;i<chartData.length;i++) ema=chartData[i]*k+ema*(1-k);
    return (ema/Math.max(...chartData))*100;
  }

  // === Trades Simulation & Live with API update ===
  function executeTrade(type){
    if(!currentSymbol) return;
    const lot=parseFloat(lotInput.value)||1;
    const stake=parseFloat(stakeInput.value)||1;
    const mode=modeSelect.value;

    const trade={symbol:currentSymbol,type,lot,stake,entry:chartData[chartData.length-1],timestamp:Date.now()};
    trades.push(trade);
    logHistory(`${type} ${currentSymbol} @ ${trade.entry.toFixed(2)} (lot:${lot}, stake:${stake})`);

    if(mode==="simulation"){
      balance -= stake; // decrease simulated balance
      updatePnL();
      updateBalanceUI();
    }else if(mode==="live" && ws && authorized){
      // buy proposal for Multiplier
      const proposal = {
        buy: type==="BUY",
        amount: stake,
        basis: "stake",
        contract_type: type==="BUY"?"CALL":"PUT",
        currency: "USD",
        symbol: currentSymbol,
        duration: 1,
        duration_unit: "ticks",
        subscribe: 1
      };
      ws.send(JSON.stringify({ buy: proposal }));
    }
  }

  function updatePnL(){
    let pnl=0;
    trades.forEach(tr=>{
      const priceNow=chartData[chartData.length-1];
      pnl+=tr.type==="BUY"? (priceNow-tr.entry)*tr.lot : (tr.entry-priceNow)*tr.lot;
    });
    document.getElementById("pnl").textContent="PnL: "+pnl.toFixed(2);
  }

  function updateBalanceUI(){
    userBalance.textContent="Balance: "+balance.toFixed(2)+" USD";
  }

  buyBtn.onclick=()=>executeTrade("BUY");
  sellBtn.onclick=()=>executeTrade("SELL");
  closeBtn.onclick=()=>{
    trades=[];
    updatePnL();
    logHistory("Closed all trades");
  }

  // === WebSocket ===
  connectBtn.onclick=()=>{
    const token=tokenInput.value.trim()||null;
    ws=new WebSocket(WS_URL);
    ws.onopen=()=>{
      setStatus("Connected to Deriv WebSocket"); 
      if(token) authorize(token); else initSymbols();
    };
    ws.onmessage=msg=>{
      const data=JSON.parse(msg.data);
      handleMessage(data);

      // update balance if live order confirmed
      if(data.msg_type==="proposal_open_contract" && data.proposal_open_contract?.contract_id){
        balance = parseFloat(data.proposal_open_contract.buy_price) || balance;
        updateBalanceUI();
      }
    };
    ws.onclose=()=>setStatus("WebSocket disconnected");
    ws.onerror=()=>setStatus("WebSocket error");
  };

  function handleMessage(data){
    if(data.msg_type==="authorize"){
      if(data.error){ logHistory("❌ Invalid token"); setStatus("Simulation mode"); return; }
      authorized=true; setStatus(`Authorized: ${data.authorize.loginid}`); getBalance();
    }
    if(data.msg_type==="balance" && data.balance?.balance!=null)
      userBalance.textContent=`Balance: ${parseFloat(data.balance.balance).toFixed(2)} USD`;
    if(data.msg_type==="tick" && data.tick?.symbol){
      const tick=data.tick, symbol=tick.symbol, price=Number(tick.quote);
      if(symbol===currentSymbol){
        chartData.push(price); chartTimes.push(tick.epoch);
        if(chartData.length>300){ chartData.shift(); chartTimes.shift(); }
      }
    }
  }

  function authorize(token){ ws.send(JSON.stringify({ authorize: token })); }
  function getBalance(){ ws.send(JSON.stringify({ balance:1, subscribe:1 })); }
  function subscribeTicks(symbol){ if(!ws||ws.readyState!==WebSocket.OPEN) return; ws.send(JSON.stringify({ ticks:symbol, subscribe:1 })); }

  // === History logging ===
  function logHistory(txt){ 
    const div=document.createElement("div");
    div.textContent=`${new Date().toLocaleTimeString()} — ${txt}`;
    historyList.prepend(div);
  }

  function setStatus(txt){ statusSpan.textContent=txt; }
  setStatus("Ready. Connect and select a symbol."); initSymbols();

  setInterval(()=>{
    if(chartData.length>0){ drawChart(); drawGauges(); updatePnL(); }
  },500);

});
