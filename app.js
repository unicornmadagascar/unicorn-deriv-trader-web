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

  // Symbols
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

  // Canvas chart
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

    // Background
    const bgGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
    bgGrad.addColorStop(0, "#f9faff");
    bgGrad.addColorStop(1, "#e6f0ff");
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

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

    // Grid Y labels
    ctx.strokeStyle = "#ddd";
    ctx.lineWidth = 0.8;
    ctx.fillStyle = "#555";
    ctx.font = "12px Arial";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let i = 0; i <= 5; i++) {
      const y = canvas.height - padding - (i / 5) * h;
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(canvas.width - padding, y);
      ctx.stroke();
      ctx.fillText((minVal + (i / 5) * range).toFixed(2), padding - 10, y);
    }

    // X labels
    const len = chartData.length;
    const stepX = Math.ceil(len / 5);
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (let i = 0; i < len; i += stepX) {
      const x = padding + (i / (len - 1)) * w;
      ctx.beginPath();
      ctx.moveTo(x, padding);
      ctx.lineTo(x, canvas.height - padding);
      ctx.stroke();
      ctx.fillText(chartTimes[i] ? new Date(chartTimes[i] * 1000).toLocaleTimeString().slice(0, 8) : "", x, canvas.height - padding + 5);
    }

    // Area chart
    ctx.beginPath();
    chartData.forEach((val, i) => {
      const x = padding + (i / (len - 1)) * w;
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
      const x = padding + (i / (len - 1)) * w;
      const y = canvas.height - padding - ((val - minVal) / range) * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = "#007bff";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Current price
    const lastPrice = chartData[len - 1];
    const yPrice = canvas.height - padding - ((lastPrice - minVal) / range) * h;
    ctx.strokeStyle = "red";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(padding, yPrice);
    ctx.lineTo(canvas.width - padding, yPrice);
    ctx.stroke();
    ctx.fillStyle = "red";
    ctx.beginPath();
    ctx.arc(canvas.width - padding, yPrice, 5, 0, 2 * Math.PI);
    ctx.fill();
    ctx.font = "14px Arial";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    let textX = canvas.width - padding - 50;
    const textWidth = ctx.measureText(lastPrice.toFixed(2)).width;
    if (textX - textWidth < padding) textX = padding + 5;
    ctx.fillText(lastPrice.toFixed(2), textX, yPrice - 5);

    // Draw trades
    trades.forEach(tr => {
      if (tr.symbol !== currentSymbol) return;
      const x = padding + ((chartData.length - 1) / (len - 1)) * w;
      const y = canvas.height - padding - ((tr.entry - minVal) / range) * h;
      ctx.fillStyle = tr.type === "BUY" ? "green" : "red";
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, 2 * Math.PI);
      ctx.fill();
    });
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
    tooltip.innerHTML = `<strong>${currentSymbol}</strong><br>Price: ${price.toFixed(2)}<br>Time: ${time}`;
  }

  // Gauges
  function initGauges() {
    gaugeDashboard.innerHTML = "";
    ["Volatility","ATR","EMA"].forEach(name => {
      const c = document.createElement("canvas");
      c.width = 120; c.height = 120;
      c.dataset.gaugeName=name;
      gaugeDashboard.appendChild(c);
    });
  }

  function drawGauges() {
    gaugeDashboard.querySelectorAll("canvas").forEach(c => {
      let value=0;
      if(c.dataset.gaugeName==="Volatility") value=calculateVolatility();
      else if(c.dataset.gaugeName==="ATR") value=calculateATR();
      else if(c.dataset.gaugeName==="EMA") value=calculateEMA();
      drawGauge(c,value);
    });
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

    // Axes et grille
    ctx.strokeStyle = "#444";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding, padding);
    ctx.lineTo(padding, canvas.height - padding);
    ctx.lineTo(canvas.width - padding, canvas.height - padding);
    ctx.stroke();

    // Grid Y
    ctx.strokeStyle = "#ddd";
    ctx.lineWidth = 0.8;
    ctx.fillStyle = "#555";
    ctx.font = "12px Arial";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let i = 0; i <= 5; i++) {
        const y = canvas.height - padding - (i / 5) * h;
        ctx.beginPath();
        ctx.moveTo(padding, y);
        ctx.lineTo(canvas.width - padding, y);
        ctx.stroke();
        ctx.fillText((minVal + (i / 5) * range).toFixed(2), padding - 10, y);
    }

    // Grid X
    const len = chartData.length;
    const stepX = Math.ceil(len / 5);
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (let i = 0; i < len; i += stepX) {
        const x = padding + (i / (len - 1)) * w;
        ctx.beginPath();
        ctx.moveTo(x, padding);
        ctx.lineTo(x, canvas.height - padding);
        ctx.stroke();
        ctx.fillText(chartTimes[i] ? new Date(chartTimes[i] * 1000).toLocaleTimeString().slice(0, 8) : "", x, canvas.height - padding + 5);
    }

    // Area chart
    ctx.beginPath();
    chartData.forEach((val, i) => {
        const x = padding + (i / (len - 1)) * w;
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

    // Line chart
    ctx.beginPath();
    chartData.forEach((val, i) => {
        const x = padding + (i / (len - 1)) * w;
        const y = canvas.height - padding - ((val - minVal) / range) * h;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = "#007bff";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Draw trades with arrow + dotted line + price label
    trades.forEach(tr => {
        if (tr.symbol !== currentSymbol) return;
        const lastX = padding + ((chartData.length - 1) / (len - 1)) * w;
        const y = canvas.height - padding - ((tr.entry - minVal) / range) * h;

        // Dotted line
        ctx.setLineDash([5, 5]);
        ctx.strokeStyle = "red";
        ctx.beginPath();
        ctx.moveTo(padding, y);
        ctx.lineTo(canvas.width - padding, y);
        ctx.stroke();
        ctx.setLineDash([]);

        // Arrow for trade entry
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

        // Price label
        ctx.fillStyle = "red";
        ctx.font = "12px Arial";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(tr.entry.toFixed(2), lastX + 10, y);
    });
}


  function calculateVolatility(){ if(chartData.length<2)return 0; const lastN=chartData.slice(-20); const max=Math.max(...lastN); const min=Math.min(...lastN); return ((max-min)/chartData[chartData.length-1])*100; }
  function calculateATR(){ if(chartData.length<2)return 0; let sum=0; for(let i=1;i<chartData.length;i++) sum+=Math.abs(chartData[i]-chartData[i-1]); return (sum/(chartData.length-1))/Math.max(...chartData)*100; }
  function calculateEMA(period=20){ if(chartData.length<2)return 0; let k=2/(period+1); let ema=chartData[chartData.length-period]||chartData[0]; for(let i=chartData.length-period+1;i<chartData.length;i++) ema=chartData[i]*k+ema*(1-k); return (ema/Math.max(...chartData))*100; }

  // Trades
  function executeTrade(type){
    if(!currentSymbol) return;
    const stake=parseFloat(stakeInput.value)||1;
    const multiplier=parseInt(multiplierInput.value)||100;
    const mode=modeSelect.value;

    if(mode==="simulation"){
      const trade={symbol:currentSymbol,type,stake,multiplier,entry:chartData[chartData.length-1],timestamp:Date.now()};
      trades.push(trade);
      balance-=stake;
      userBalance.textContent=`Balance: ${balance.toFixed(2)} USD`;
      logHistory(`${type} ${currentSymbol} @ ${trade.entry.toFixed(2)} stake:${stake} mult:${multiplier}`);
      updatePnL();
    } else if(mode==="live" && ws && authorized){
      const order={
        buy: type==="BUY"?1:0,
        amount: stake,
        symbol: currentSymbol,
        contract_type: type==="BUY"?"MULTUP":"MULTDOWN",
        basis:"stake",
        currency:"USD",
        multiplier: multiplier,
        subscribe:1
      };
      ws.send(JSON.stringify(order));
      logHistory(`Sent LIVE order: ${type} ${currentSymbol} stake:${stake} mult:${multiplier}`);
    }
  }

  function updatePnL(){
    let pnl=0;
    trades.forEach(tr=>{
      const priceNow=chartData[chartData.length-1];
      pnl+=tr.type==="BUY"? (priceNow-tr.entry)*tr.stake : (tr.entry-priceNow)*tr.stake;
    });
    document.getElementById("pnl").textContent="PnL: "+pnl.toFixed(2);
  }

  buyBtn.onclick=()=>executeTrade("BUY");
  sellBtn.onclick=()=>executeTrade("SELL");
  closeBtn.onclick=()=>{
    trades=[];
    updatePnL();
    logHistory("Closed all trades");
  }

  // WebSocket
  connectBtn.onclick=()=>{
    const token=tokenInput.value.trim()||null;
    ws=new WebSocket(WS_URL);
    ws.onopen=()=>{
      setStatus("Connected to Deriv WebSocket");
      if(token) authorize(token); else initSymbols();
    };
    ws.onmessage=msg=>handleMessage(JSON.parse(msg.data));
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
        drawChart(); drawGauges(); updatePnL();
      }
      lastPrices[symbol]=price;
    }
  }

  function authorize(token){ ws.send(JSON.stringify({ authorize: token })); }
  function getBalance(){ ws.send(JSON.stringify({ balance:1, subscribe:1 })); }
  function subscribeTicks(symbol){ if(!ws||ws.readyState!==WebSocket.OPEN) return; ws.send(JSON.stringify({ ticks:symbol, subscribe:1 })); }

  function logHistory(txt){ 
    const div=document.createElement("div");
    div.textContent=`${new Date().toLocaleTimeString()} — ${txt}`;
    historyList.prepend(div);
  }

  function setStatus(txt){ statusSpan.textContent=txt; }
  setStatus("Ready. Connect and select a symbol."); initSymbols();

  setInterval(()=>{ if(chartData.length>0){ drawChart(); drawGauges(); updatePnL(); } },500);
});
