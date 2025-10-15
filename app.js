document.addEventListener("DOMContentLoaded", () => {
  const APP_ID = 105747;
  const WS_URL = `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;

  const tokenInput = document.getElementById("tokenInput");
  const connectBtn = document.getElementById("connectBtn");
  const statusSpan = document.getElementById("status");
  const userBalance = document.getElementById("userBalance");
  const symbolList = document.getElementById("symbolList");
  const historyList = document.getElementById("historyList");
  const buyBtn = document.getElementById("buyBtn");
  const sellBtn = document.getElementById("sellBtn");
  const closeBtn = document.getElementById("closeBtn");
  const chartInner = document.getElementById("chartSection");

  let ws = null;
  let currentSymbol = null;
  let lastPrices = {};
  let chartData = [];
  let chartTimes = [];
  let canvas, ctx;
  let gaugeDashboard;
  let authorized = false;

  const volatilitySymbols = [
    "BOOM1000","BOOM900","BOOM600","BOOM500","BOOM300",
    "CRASH1000","CRASH900","CRASH600","CRASH500"
  ];

  // === Tooltip for chart ===
  let tooltip = document.createElement("div");
  tooltip.style.position = "absolute";
  tooltip.style.padding = "4px 8px";
  tooltip.style.background = "rgba(0,0,0,0.7)";
  tooltip.style.color = "#fff";
  tooltip.style.fontSize = "12px";
  tooltip.style.borderRadius = "4px";
  tooltip.style.pointerEvents = "none";
  tooltip.style.display = "none";
  chartInner.appendChild(tooltip);

  // === Symbol list ===
  function initSymbols() {
    symbolList.innerHTML = "";
    volatilitySymbols.forEach(sym => {
      const div = document.createElement("div");
      div.className = "symbolItem";
      div.id = `symbol-${sym}`;
      div.innerHTML = `<span class="symbolName">${sym}</span> — <span class="symbolValue">➡</span>`;
      div.onclick = () => selectSymbol(sym);
      symbolList.appendChild(div);
    });
  }

  function selectSymbol(symbol) {
    currentSymbol = symbol;
    document.querySelectorAll(".symbolItem").forEach(el => el.classList.remove("active"));
    const selected = document.getElementById(`symbol-${symbol}`);
    if (selected) selected.classList.add("active");
    logHistory(`Selected symbol: ${symbol}`);
    initCanvas();
    initGaugeDashboard();
    subscribeTicks(symbol);
    loadHistoricalTicks(symbol);
  }

  // === Chart ===
  function initCanvas() {
    // canvas chart
    const chartArea = document.createElement("div");
    chartArea.style.position = "relative";
    chartArea.style.flex = "1";
    chartInner.innerHTML = "";
    chartInner.appendChild(chartArea);

    canvas = document.createElement("canvas");
    canvas.width = chartInner.clientWidth - 200; // leave space for gauges
    canvas.height = chartInner.clientHeight;
    canvas.style.display = "block";
    chartArea.appendChild(canvas);
    ctx = canvas.getContext("2d");
    chartData = [];
    chartTimes = [];

    canvas.addEventListener("mousemove", handleMouseMove);
    canvas.addEventListener("mouseleave", () => tooltip.style.display = "none");
  }

  function drawChart() {
    if (!ctx || chartData.length === 0) return;
    const padding = 50;
    const w = canvas.width - padding*2;
    const h = canvas.height - padding*2;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Background gradient
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, "#f9faff");
    gradient.addColorStop(1, "#e6f0ff");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const maxVal = Math.max(...chartData);
    const minVal = Math.min(...chartData);
    const range = maxVal - minVal || 1;

    // Axes
    ctx.strokeStyle = "#444";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding, padding);
    ctx.lineTo(padding, canvas.height-padding);
    ctx.lineTo(canvas.width-padding, canvas.height-padding);
    ctx.stroke();

    // Grid lines & Y-axis labels
    ctx.strokeStyle = "#ddd";
    ctx.lineWidth = 0.8;
    ctx.fillStyle="#555";
    ctx.font="12px Arial";
    ctx.textAlign="right";
    ctx.textBaseline="middle";
    for(let i=0;i<=5;i++){
      const y = canvas.height-padding - (i/5)*h;
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(canvas.width-padding, y);
      ctx.stroke();
      ctx.fillText((minVal + (i/5)*range).toFixed(2), padding-10, y);
    }

    // X-axis labels
    const len = chartData.length;
    const stepX = Math.ceil(len/5);
    ctx.textAlign="center";
    ctx.textBaseline="top";
    for(let i=0;i<len;i+=stepX){
      const x = padding + (i/(len-1))*w;
      ctx.beginPath();
      ctx.moveTo(x, padding);
      ctx.lineTo(x, canvas.height-padding);
      ctx.stroke();
      ctx.fillText(chartTimes[i] ? new Date(chartTimes[i]*1000).toLocaleTimeString().slice(0,8) : "", x, canvas.height-padding+5);
    }

    // Line chart
    ctx.beginPath();
    chartData.forEach((val,i)=>{
      const x = padding + (i/(len-1))*w;
      const y = canvas.height-padding - ((val-minVal)/range)*h;
      if(i===0) ctx.moveTo(x,y);
      else ctx.lineTo(x,y);
    });
    ctx.strokeStyle="#007bff";
    ctx.lineWidth=2;
    ctx.stroke();

    // Current price line
    const lastPrice = chartData[chartData.length-1];
    const yPrice = canvas.height-padding - ((lastPrice-minVal)/range)*h;
    ctx.strokeStyle="red";
    ctx.lineWidth=1.5;
    ctx.beginPath();
    ctx.moveTo(padding, yPrice);
    ctx.lineTo(canvas.width-padding, yPrice);
    ctx.stroke();

    // Circle & price label
    ctx.fillStyle="red";
    ctx.beginPath();
    const xLast = padding + ((len-1)/(len-1))*w;
    ctx.arc(xLast, yPrice, 5, 0, 2*Math.PI);
    ctx.fill();

    ctx.font="14px Arial";
    ctx.textAlign="left";
    ctx.textBaseline="middle";
    const priceOffsetX = -50;
    let textX = canvas.width-padding+priceOffsetX;
    const textWidth = ctx.measureText(lastPrice.toFixed(2)).width;
    if(textX-textWidth < padding) textX = padding+5;
    ctx.fillText(lastPrice.toFixed(2), textX, yPrice-5);
  }

  function handleMouseMove(e){
    if(!canvas || chartData.length===0) return;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const padding = 50;
    const w = canvas.width - padding*2;
    const len = chartData.length;
    let nearestIndex = Math.round((mouseX-padding)/(w)*(len-1));
    nearestIndex = Math.max(0, Math.min(nearestIndex,len-1));
    const price = chartData[nearestIndex];
    const time = chartTimes[nearestIndex] ? new Date(chartTimes[nearestIndex]*1000).toLocaleTimeString().slice(0,8) : "";
    tooltip.style.display="block";
    tooltip.style.left = (e.clientX+15)+"px";
    tooltip.style.top = (e.clientY-30)+"px";
    tooltip.innerHTML = `${currentSymbol}<br>${price.toFixed(2)}<br>${time}`;
  }

  // === Gauge Dashboard ===
  function initGaugeDashboard(){
    gaugeDashboard = document.createElement("div");
    gaugeDashboard.style.position="absolute";
    gaugeDashboard.style.right="10px";
    gaugeDashboard.style.top="50px";
    gaugeDashboard.style.width="180px";
    gaugeDashboard.style.display="flex";
    gaugeDashboard.style.flexDirection="column";
    gaugeDashboard.style.gap="15px";
    chartInner.appendChild(gaugeDashboard);

    ["Volatility","ATR","EMA"].forEach(name=>{
      const c = document.createElement("canvas");
      c.width=150;
      c.height=150;
      c.dataset.gaugeName=name;
      gaugeDashboard.appendChild(c);
    });
  }

  function drawGauge(canvas,value){
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;
    const radius = Math.min(w,h)/2 - 10;

    ctx.clearRect(0,0,w,h);

    // Background
    ctx.beginPath();
    ctx.arc(w/2,h/2,radius,0,2*Math.PI);
    ctx.strokeStyle="#ddd";
    ctx.lineWidth=15;
    ctx.stroke();

    // Foreground
    ctx.beginPath();
    const endAngle = (value/100)*2*Math.PI;
    ctx.arc(w/2,h/2,radius,-Math.PI/2,-Math.PI/2 + endAngle);
    ctx.strokeStyle="#2563eb";
    ctx.lineWidth=15;
    ctx.stroke();

    // Text
    ctx.fillStyle="#333";
    ctx.font="14px Arial";
    ctx.textAlign="center";
    ctx.textBaseline="middle";
    ctx.fillText(canvas.dataset.gaugeName, w/2, h/2 - 10);
    ctx.fillText(`${value.toFixed(1)}%`, w/2, h/2 + 15);
  }

  function calculateVolatility() {
    const windowSize = 20;
    if(chartData.length < 2) return 0;
    const lastN = chartData.slice(-windowSize);
    const mean = lastN.reduce((a,b)=>a+b,0)/lastN.length;
    const max = Math.max(...lastN);
    const min = Math.min(...lastN);
    const vol = ((max-min)/mean)*100;
    return Math.min(vol,100);
  }

  function calculateATR() {
    const windowSize = 14;
    if(chartData.length < 2) return 0;
    let atr = 0;
    for(let i=Math.max(1,chartData.length-windowSize);i<chartData.length;i++){
      atr += Math.abs(chartData[i]-chartData[i-1]);
    }
    atr = atr/Math.min(windowSize, chartData.length-1);
    const lastPrice = chartData[chartData.length-1];
    return Math.min((atr/lastPrice)*100,100);
  }

  function calculateEMA(period=14){
    if(chartData.length<period) return 0;
    let k = 2/(period+1);
    let ema = chartData[chartData.length-period];
    for(let i=chartData.length-period+1;i<chartData.length;i++){
      ema = chartData[i]*k + ema*(1-k);
    }
    const lastPrice = chartData[chartData.length-1];
    return Math.min(Math.abs((ema-lastPrice)/lastPrice)*100,100);
  }

  function drawGauges(){
    if(!gaugeDashboard) return;
    gaugeDashboard.querySelectorAll("canvas").forEach(c=>{
      let value=0;
      if(c.dataset.gaugeName==="Volatility") value=calculateVolatility();
      else if(c.dataset.gaugeName==="ATR") value=calculateATR();
      else if(c.dataset.gaugeName==="EMA") value=calculateEMA();
      drawGauge(c,value);
    });
  }

  setInterval(drawGauges,500);

  // === WebSocket ===
  connectBtn.onclick = () => {
    const token = tokenInput.value.trim() || null;
    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      setStatus("Connected to Deriv WebSocket");
      logHistory("WebSocket connected");
      if(token) authorize(token);
      else initSymbols();
    };

    ws.onmessage = msg => handleMessage(JSON.parse(msg.data));
    ws.onclose = () => setStatus("WebSocket disconnected");
    ws.onerror = () => setStatus("WebSocket error");
  };

  function handleMessage(data){
    if(data.msg_type==="authorize"){
      if(data.error){
        logHistory("❌ Invalid token");
        setStatus("Simulation mode");
        return;
      }
      authorized=true;
      setStatus(`Authorized: ${data.authorize.loginid}`);
      getBalance();
    }

    if(data.msg_type==="balance" && data.balance?.balance!=null){
      userBalance.textContent = `Balance: ${parseFloat(data.balance.balance).toFixed(2)} USD`;
    }

    if(data.msg_type==="tick" && data.tick?.symbol){
      const tick = data.tick;
      const symbol = tick.symbol;
      const price = Number(tick.quote);

      if(symbol===currentSymbol){
        chartData.push(price);
        chartTimes.push(tick.epoch);
        if(chartData.length>300){ chartData.shift(); chartTimes.shift(); }
        drawChart();
      }

      const el = document.getElementById(`symbol-${symbol}`);
      if(el){
        const span = el.querySelector(".symbolValue");
        let direction="➡";
        let color="#666";
        if(lastPrices[symbol]!==undefined){
          if(price>lastPrices[symbol]){ direction="🔼"; color="green"; }
          else if(price<lastPrices[symbol]){ direction="🔽"; color="red"; }
        }
        span.textContent=direction;
        span.style.color=color;
        lastPrices[symbol]=price;
      }
    }
  }

  function authorize(token){ ws.send(JSON.stringify({authorize:token})); }
  function getBalance(){ ws.send(JSON.stringify({balance:1,subscribe:1})); }
  function subscribeTicks(symbol){ if(!ws||ws.readyState!==WebSocket.OPEN)return; ws.send(JSON.stringify({ticks:symbol,subscribe:1})); }
  function loadHistoricalTicks(symbol){ if(!ws||ws.readyState!==WebSocket.OPEN)return; ws.send(JSON.stringify({ticks_history:symbol,end:"latest",count:300,style:"ticks",subscribe:1})); }

  // === Trades ===
  function logHistory(txt) {
    const div = document.createElement("div");
    div.textContent = `${new Date().toLocaleTimeString()} — ${txt}`;
    historyList.prepend(div);
  }

  buyBtn.onclick=()=>logTrade("BUY");
  sellBtn.onclick=()=>logTrade("SELL");
  closeBtn.onclick=()=>logTrade("CLOSE");
  function logTrade(type){ if(!currentSymbol) return; logHistory(`${type} ${currentSymbol}`); }

  // === Status & init ===
  function setStatus(txt) { statusSpan.textContent = txt; }
  setStatus("Ready. Connect and select a symbol.");
  initSymbols();
});
