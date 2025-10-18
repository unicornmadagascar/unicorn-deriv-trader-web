// app.js - Unicorn Madagascar (demo live ticks) - Version corrigée complète

document.addEventListener("DOMContentLoaded", () => {
  const APP_ID = 105747;
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
  const tp = document.getElementById("tp");
  const sl = document.getElementById("sl");
  const buynumb = document.getElementById("buyNumber");
  const sellnumb = document.getElementById("sellNumber");
  const toggleBtn = document.getElementById("themeToggle");

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
  let numb_;
  const isOn = false;

  const volatilitySymbols = ["BOOM1000","CRASH1000","BOOM900","CRASH900","BOOM600","CRASH600","BOOM500","CRASH500",
                             "R_100","R_75","R_50","R_25"];

  // Tooltip
  const tooltip = document.createElement("div");
  tooltip.style.cssText = "position:fixed;padding:6px 10px;background:rgba(0,0,0,0.85);color:#fff;font-size:12px;border-radius:6px;pointer-events:none;display:none;z-index:9999";
  document.body.appendChild(tooltip);

  // Helper functions
  function logHistory(txt){
    const d = document.createElement("div");
    d.textContent = `${new Date().toLocaleTimeString()} — ${txt}`;
    historyList.prepend(d);
  }
  function setStatus(txt){ statusSpan.textContent = txt; }
  function formatNum(n){ return Number(n).toFixed(2); }

  // Init symbols list
  function initSymbols(){
    symbolList.innerHTML = "";
    volatilitySymbols.forEach(sym => {
      const el = document.createElement("div");
      el.className = "symbolItem";
      el.id = `symbol-${sym}`;
      switch(sym){
        case "BOOM1000": el.textContent="BOOM 1000"; break;
        case "BOOM900": el.textContent="BOOM 900"; break;
        case "BOOM600": el.textContent="BOOM 600"; break;
        case "BOOM500": el.textContent="BOOM 500"; break;
        case "CRASH1000": el.textContent="CRASH 1000"; break;
        case "CRASH900": el.textContent="CRASH 900"; break;
        case "CRASH600": el.textContent="CRASH 600"; break;
        case "CRASH500": el.textContent="CRASH 500"; break;
        case "R_100": el.textContent="VIX 100"; break;
        case "R_75": el.textContent="VIX 75"; break;
        case "R_50": el.textContent="VIX 50"; break;
        case "R_25": el.textContent="VIX 25"; break;
      }
      el.onclick = () => selectSymbol(sym);
      symbolList.appendChild(el);
    });
  }

  function selectSymbol(sym){
    currentSymbol = sym;
    document.querySelectorAll(".symbolItem").forEach(e => e.classList.remove("active"));
    const el = document.getElementById(`symbol-${sym}`);
    if(el) el.classList.add("active");
    chartData = [];
    chartTimes = [];
    trades = [];
    initCanvas();
    initGauges();
    subscribeTicks(sym);
    logHistory(`Selected ${sym}`);
  }

  // Canvas
  function initCanvas(){
    chartInner.innerHTML = "";
    canvas = document.createElement("canvas");
    canvas.width = chartInner.clientWidth;
    canvas.height = chartInner.clientHeight;
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    chartInner.appendChild(canvas);
    ctx = canvas.getContext("2d");
    canvas.addEventListener("mousemove", canvasMouseMove);
    canvas.addEventListener("mouseleave", ()=>{ tooltip.style.display="none"; });
  }

  // Gauges
  function initGauges(){
    gaugeDashboard.innerHTML = "";
    ["Volatility","RSI","EMA"].forEach(name=>{
      const c = document.createElement("canvas");
      c.width=c.height=120;
      c.dataset.gaugeName=name;
      c.style.width=c.style.height="120px";
      gaugeDashboard.appendChild(c);
    });
  }

  function drawGauges(){
    const canvases = gaugeDashboard.querySelectorAll("canvas");
    canvases.forEach(c=>{
      let value=0;
      if(c.dataset.gaugeName==="Volatility") value=computeVolatility();
      else if(c.dataset.gaugeName==="RSI") value=computeRSI();
      else if(c.dataset.gaugeName==="EMA") value=computeEMAProb();
      const key = c.dataset.gaugeName==="Volatility"?"volatility":c.dataset.gaugeName==="RSI"?"rsi":"emaProb";
      gaugeSmoothers[key] = gaugeSmoothers[key]*0.7 + value*0.3;
      renderGauge(c, gaugeSmoothers[key]);
    });
  }

  function renderGauge(canvas, value){
    const gctx = canvas.getContext("2d");
    const w = canvas.width, h = canvas.height;
    const radius = Math.min(w,h)/2-10;
    gctx.clearRect(0,0,w,h);
    gctx.beginPath();
    gctx.arc(w/2,h/2,radius,0,2*Math.PI);
    gctx.strokeStyle="#eee"; gctx.lineWidth=12; gctx.stroke();
    const end=(-Math.PI/2)+(Math.max(0,Math.min(100,value))/100)*2*Math.PI;
    gctx.beginPath();
    gctx.arc(w/2,h/2,radius,-Math.PI/2,end);
    gctx.strokeStyle="#2563eb"; gctx.lineWidth=12; gctx.stroke();
    gctx.fillStyle="#222";
    gctx.font="12px Inter, Arial"; gctx.textAlign="center"; gctx.textBaseline="middle";
    gctx.fillText(canvas.dataset.gaugeName, w/2, h/2-12);
    gctx.fillText(value.toFixed(1)+"%", w/2, h/2+12);
  }

  function computeVolatility(){
    if(chartData.length<2) return 0;
    const lastN = chartData.slice(-SMA_WINDOW);
    const mean = lastN.reduce((a,b)=>a+b,0)/lastN.length;
    const variance = lastN.reduce((a,b)=>a+Math.pow(b-mean,2),0)/lastN.length;
    const relative = (Math.sqrt(variance)/(chartData[chartData.length-1]||1))*100;
    return Math.min(100, relative*2);
  }

  function computeRSI(period=14){
    if(chartData.length<period+1) return 0;
    const closes = chartData.slice(-(period+1));
    let gains=0, losses=0;
    for(let i=1;i<closes.length;i++){
      const d=closes[i]-closes[i-1];
      if(d>0) gains+=d; else losses+=Math.abs(d);
    }
    if(gains+losses===0) return 50;
    const rs=gains/Math.max(1,losses);
    return 100-(100/(1+rs));
  }

  function computeEMAProb(short=10,long=50){
    if(chartData.length<long) return 50;
    const shortEma=emaArray(chartData,short).slice(-1)[0];
    const longEma=emaArray(chartData,long).slice(-1)[0];
    const diff=shortEma-longEma;
    const px=chartData[chartData.length-1]||1;
    const prob=50+(diff/px)*500;
    return Math.max(0,Math.min(100,prob));
  }

  function emaArray(arr, period){
    const k=2/(period+1);
    let ema=arr[0], res=[ema];
    for(let i=1;i<arr.length;i++){ ema=arr[i]*k + ema*(1-k); res.push(ema); }
    return res;
  }

  // Draw chart
  function drawChart() {
    if(!ctx||chartData.length===0) return;
    const padding=50;
    const w=canvas.width-padding*2;
    const h=canvas.height-padding*2;
    ctx.clearRect(0,0,canvas.width,canvas.height);

    const allValues=[...chartData, ...trades.map(t=>t.entry||0)];
    const maxVal=Math.max(...allValues);
    const minVal=Math.min(...allValues);
    const range=maxVal-minVal||1;
    const len=chartData.length;

    // axes
    ctx.strokeStyle="#666";
    ctx.lineWidth=1;
    ctx.beginPath();
    ctx.moveTo(padding,padding);
    ctx.lineTo(padding,canvas.height-padding);
    ctx.lineTo(canvas.width-padding,canvas.height-padding);
    ctx.stroke();

    // y-grid
    ctx.strokeStyle="rgba(150,150,150,0.2)";
    ctx.fillStyle="#000";
    ctx.font="12px Inter, Arial";
    ctx.textAlign="right"; ctx.textBaseline="middle";
    for(let i=0;i<=5;i++){
      const y=canvas.height-padding-(i/5)*h;
      ctx.beginPath();
      ctx.moveTo(padding,y);
      ctx.lineTo(canvas.width-padding,y);
      ctx.stroke();
      const v=minVal+(i/5)*range;
      ctx.fillText(v.toFixed(2), padding-10, y);
    }

    // x-axis labels
    ctx.textAlign="center"; ctx.textBaseline="top";
    const step = Math.floor(len/5)||1;
    for(let i=0;i<len;i+=step){
      const x=padding+(i/(len-1))*w;
      const t=chartTimes[i]?new Date(chartTimes[i]*1000).toLocaleTimeString().slice(0,8):"";
      ctx.fillText(t,x,canvas.height-padding+5);
    }

    // price line
    ctx.beginPath();
    for(let i=0;i<len;i++){
      const x=padding+(i/(len-1))*w;
      const y=canvas.height-padding-((chartData[i]-minVal)/range)*h;
      if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    }
    ctx.strokeStyle="#2563eb"; ctx.lineWidth=2; ctx.stroke();

    // trades
    trades.forEach(tr=>{
      if(tr.symbol!==currentSymbol||tr.entry==null) return;
      const y=canvas.height-padding-((tr.entry-minVal)/range)*h;
      const x=padding+(len-1)/(len-1)*w;

      ctx.setLineDash([5,4]);
      ctx.strokeStyle=tr.type==="BUY"?"rgba(34,197,94,0.9)":"rgba(239,68,68,0.9)";
      ctx.beginPath();
      ctx.moveTo(padding,y);
      ctx.lineTo(canvas.width-padding,y);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle=tr.type==="BUY"?"#22c55e":"#ef4444";
      ctx.beginPath();
      if(tr.type==="BUY"){
        ctx.moveTo(x-8,y); ctx.lineTo(x,y-8); ctx.lineTo(x,y+8);
      } else {
        ctx.moveTo(x+8,y); ctx.lineTo(x,y-8); ctx.lineTo(x,y+8);
      }
      ctx.closePath(); ctx.fill();

      ctx.fillStyle="#000"; ctx.font="12px Inter, Arial"; ctx.textAlign="left";
      ctx.fillText(`${tr.type} @ ${tr.entry.toFixed(2)}`, x+10, y-5);
    });

    // current price
    const lastPrice=chartData[len-1];
    const yCur=canvas.height-padding-((lastPrice-minVal)/range)*h;
    ctx.strokeStyle="#16a34a"; ctx.lineWidth=1.2;
    ctx.beginPath(); ctx.moveTo(padding,yCur); ctx.lineTo(canvas.width-padding,yCur); ctx.stroke();

    // total PnL
    let totalPnl=0;
    trades.forEach(tr=>{
      const diff=tr.type==="BUY"?lastPrice-tr.entry:tr.entry-lastPrice;
      totalPnl+=diff*tr.multiplier*tr.stake;
    });
    ctx.fillStyle=totalPnl>=0?"#16a34a":"#dc2626";
    ctx.font="bold 14px Inter, Arial"; ctx.textAlign="right";
    ctx.fillText("PnL: "+totalPnl.toFixed(2), canvas.width-padding-4,padding+16);
  }

  // Fetch contracts (no repeated listeners)
  function contractentry(){
    if(!authorized||!ws||ws.readyState!==WebSocket.OPEN) return;
    ws.send(JSON.stringify({ portfolio:1 }));
  }

  function canvasMouseMove(e){
    if(!canvas||chartData.length===0) return;
    const rect=canvas.getBoundingClientRect();
    const mouseX=e.clientX-rect.left;
    const padding=50; const w=canvas.width-padding*2;
    const len=chartData.length;
    let idx=Math.round((mouseX-padding)/w*(len-1));
    idx=Math.max(0,Math.min(idx,len-1));
    const price=chartData[idx];
    const time=chartTimes[idx]?new Date(chartTimes[idx]*1000).toLocaleTimeString().slice(0,8):"";
    let tradesHtml="";
    trades.forEach(tr=>{ if(tr.symbol!==currentSymbol) return; tradesHtml+=`<div style="color:${tr.type==="BUY"?"#0ea5a4":"#ef4444"}">${tr.type} @ ${formatNum(tr.entry)} stake:${tr.stake} mult:${tr.multiplier}</div>`; });
    tooltip.style.display="block"; tooltip.style.left=e.pageX+10+"px"; tooltip.style.top=e.pageY+10+"px";
    tooltip.innerHTML=`Time: ${time}<br>Price: ${formatNum(price)}<br>${tradesHtml}`;
  }

  // WebSocket
  connectBtn.onclick = ()=>{
    if(!tokenInput.value) return alert("Enter API Token");
    ws = new WebSocket(WS_URL);
    ws.onopen = ()=>{
      setStatus("Connected");
      ws.send(JSON.stringify({ authorize: tokenInput.value }));
      logHistory("WebSocket connected");
    };
    ws.onmessage = msg=>{
      const data=JSON.parse(msg.data);
      if(data.error) console.log("WS Error:",data.error);
      if(data.authorize) { authorized=true; userBalance.textContent=formatNum(data.authorize.balance); }
      if(data.balance) { userBalance.textContent=formatNum(data.balance.balance); }
      if(data.tick && data.tick.symbol===currentSymbol){
        chartData.push(data.tick.quote);
        chartTimes.push(data.tick.epoch);
        if(chartData.length>500){ chartData.shift(); chartTimes.shift(); }
        drawChart(); drawGauges();
      }
      if(data.proposal_open_contract){
        const c = data.proposal_open_contract;
        trades.push({ type:c.contract_type.includes("UP")?"BUY":"SELL", entry:c.buy_price, symbol:currentSymbol, stake:1, multiplier:1 });
        drawChart();
      }
    };
    ws.onclose = ()=>{ setStatus("Disconnected"); logHistory("WS closed"); };
  };

  // Tick subscription
  function subscribeTicks(sym){
    if(!authorized||!ws||ws.readyState!==WebSocket.OPEN) return;
    ws.send(JSON.stringify({ ticks:sym }));
  }

  // Symbol init
  initSymbols();
});
