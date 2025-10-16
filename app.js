// app.js - Unicorn Madagascar (Connect rectifié / simulation fallback)
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

  // state
  let ws = null;
  let authorized = false;
  let simulationMode = false;
  let currentSymbol = null;
  const lastPrices = {};
  let chartData = [];
  let chartTimes = [];
  let trades = [];
  let canvas, ctx;
  let gaugeSmoothers = { volatility: 0, rsi: 0, emaProb: 0 };
  const SMA_WINDOW = 20;
  const volatilitySymbols = ["BOOM1000","CRASH1000","BOOM900","CRASH900","BOOM600","CRASH600","BOOM500","CRASH500"];

  // simulation interval
  let simInterval = null;

  // tooltip
  const tooltip = document.createElement("div");
  tooltip.style.cssText = "position:fixed;padding:6px 10px;background:rgba(0,0,0,0.85);color:#fff;font-size:12px;border-radius:6px;pointer-events:none;display:none;z-index:9999;";
  document.body.appendChild(tooltip);

  // log helper
  function logHistory(txt){
    const d = document.createElement("div");
    d.textContent = `${new Date().toLocaleTimeString()} — ${txt}`;
    historyList.prepend(d);
  }
  function setStatus(txt){ statusSpan.textContent = txt; }
  function formatNum(n){ return Number(n).toFixed(2); }

  // initialize symbols
  function initSymbols(){
    symbolList.innerHTML = "";
    volatilitySymbols.forEach(sym=>{
      const el = document.createElement("div");
      el.className = "symbolItem";
      el.id = `symbol-${sym}`;
      el.textContent = sym;
      el.onclick = () => selectSymbol(sym);
      symbolList.appendChild(el);
    });
  }

  // select symbol
  function selectSymbol(sym){
    currentSymbol = sym;
    document.querySelectorAll(".symbolItem").forEach(e=>e.classList.remove("active"));
    const el = document.getElementById(`symbol-${sym}`);
    if(el) el.classList.add("active");
    chartData = [];
    chartTimes = [];
    trades = [];
    initCanvas();
    initGauges();
    drawGauges();
    if(!simulationMode) subscribeTicks(sym);
    logHistory(`Selected ${sym}`);
  }

  // canvas init
  function initCanvas(){
    chartInner.innerHTML = "";
    canvas = document.createElement("canvas");
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.width = chartInner.clientWidth;
    canvas.height = chartInner.clientHeight;
    chartInner.appendChild(canvas);
    ctx = canvas.getContext("2d");
    canvas.addEventListener("mousemove", canvasMouseMove);
    canvas.addEventListener("mouseleave", ()=>{ tooltip.style.display="none"; });
  }

  // gauges init
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
      let value = 0;
      if(c.dataset.gaugeName==="Volatility") value=computeVolatility();
      else if(c.dataset.gaugeName==="RSI") value=computeRSI();
      else if(c.dataset.gaugeName==="EMA") value=computeEMAProb();
      const key = (c.dataset.gaugeName==="Volatility")?"volatility":(c.dataset.gaugeName==="RSI"?"rsi":"emaProb");
      gaugeSmoothers[key] = gaugeSmoothers[key]*0.6 + value*0.4;
      renderGauge(c,gaugeSmoothers[key]);
    });
  }

  function renderGauge(canvas,value){
    const gctx = canvas.getContext("2d");
    const w=canvas.width,h=canvas.height,radius=Math.min(w,h)/2-10;
    gctx.clearRect(0,0,w,h);

    gctx.beginPath();
    gctx.arc(w/2,h/2,radius,0,2*Math.PI);
    gctx.strokeStyle="#eee";
    gctx.lineWidth=12;
    gctx.stroke();

    const end=(-Math.PI/2)+(Math.max(0,Math.min(100,value))/100)*2*Math.PI;
    gctx.beginPath();
    gctx.arc(w/2,h/2,radius,-Math.PI/2,end);
    gctx.strokeStyle="#2563eb";
    gctx.lineWidth=12;
    gctx.stroke();

    gctx.fillStyle="#222";
    gctx.font="12px Inter, Arial";
    gctx.textAlign="center";
    gctx.textBaseline="middle";
    gctx.fillText(canvas.dataset.gaugeName,w/2,h/2-12);
    gctx.fillText(value.toFixed(1)+"%",w/2,h/2+12);
  }

  // compute indicators
  function computeVolatility(){
    if(chartData.length<2) return 0;
    const lastN = chartData.slice(-SMA_WINDOW);
    const mean = lastN.reduce((a,b)=>a+b,0)/lastN.length;
    const variance = lastN.reduce((a,b)=>a+Math.pow(b-mean,2),0)/lastN.length;
    const relative = (Math.sqrt(variance)/(chartData[chartData.length-1]||1))*100;
    return Math.min(100,relative*2.5);
  }

  function computeRSI(period=14){
    if(chartData.length<period+1) return 50;
    const closes = chartData.slice(-period-1);
    let gains=0,losses=0;
    for(let i=1;i<closes.length;i++){
      const diff=closes[i]-closes[i-1];
      if(diff>0) gains+=diff; else losses+=Math.abs(diff);
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

  function emaArray(arr,period){
    const k=2/(period+1);
    const res=[];
    let ema=arr[0]; res.push(ema);
    for(let i=1;i<arr.length;i++){
      ema=arr[i]*k+ema*(1-k);
      res.push(ema);
    }
    return res;
  }

  // draw chart
  function drawChart(){
    if(!ctx||chartData.length===0) return;
    const padding=50,w=canvas.width-padding*2,h=canvas.height-padding*2;
    ctx.clearRect(0,0,canvas.width,canvas.height);

    const maxVal=Math.max(...chartData);
    const minVal=Math.min(...chartData);
    const range=maxVal-minVal||1;

    // background
    const bg=ctx.createLinearGradient(0,0,0,canvas.height);
    bg.addColorStop(0,"#f9fbff");
    bg.addColorStop(1,"#e9f2ff");
    ctx.fillStyle=bg;
    ctx.fillRect(0,0,canvas.width,canvas.height);

    // axes
    ctx.strokeStyle="#666"; ctx.lineWidth=1;
    ctx.beginPath();
    ctx.moveTo(padding,padding);
    ctx.lineTo(padding,canvas.height-padding);
    ctx.lineTo(canvas.width-padding,canvas.height-padding);
    ctx.stroke();

    // y grid + labels
    ctx.strokeStyle="#e6eef9";
    ctx.fillStyle="#2b3a4a";
    ctx.font="12px Inter, Arial";
    ctx.textAlign="right"; ctx.textBaseline="middle";
    for(let i=0;i<=5;i++){
      const y=canvas.height-padding-(i/5)*h;
      ctx.beginPath(); ctx.moveTo(padding,y); ctx.lineTo(canvas.width-padding,y); ctx.stroke();
      const v=minVal+(i/5)*range;
      ctx.fillText(v.toFixed(2),padding-10,y);
    }

    // x labels
    ctx.textAlign="center"; ctx.textBaseline="top";
    const len=chartData.length,step=Math.max(1,Math.ceil(len/6));
    for(let i=0;i<len;i+=step){
      const x=padding+(i/(len-1))*w;
      const t=chartTimes[i]?new Date(chartTimes[i]*1000).toLocaleTimeString().slice(0,8):"";
      ctx.fillText(t,x,canvas.height-padding+5);
    }

    // area
    ctx.beginPath();
    for(let i=0;i<len;i++){
      const x=padding+(i/(len-1))*w;
      const y=canvas.height-padding-((chartData[i]-minVal)/range)*h;
      if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    }
    ctx.lineTo(canvas.width-padding,canvas.height-padding);
    ctx.lineTo(padding,canvas.height-padding);
    ctx.closePath();
    const fillGrad=ctx.createLinearGradient(0,padding,0,canvas.height-padding);
    fillGrad.addColorStop(0,"rgba(0,123,255,0.35)");
    fillGrad.addColorStop(1,"rgba(0,123,255,0.08)");
    ctx.fillStyle=fillGrad; ctx.fill();

    // line
    ctx.beginPath();
    for(let i=0;i<len;i++){
      const x=padding+(i/(len-1))*w;
      const y=canvas.height-padding-((chartData[i]-minVal)/range)*h;
      if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    }
    ctx.strokeStyle="#007bff"; ctx.lineWidth=2; ctx.stroke();

    // trades markers
    trades.forEach(tr=>{
      if(tr.symbol!==currentSymbol) return;
      const tradeIdx=chartData.findIndex(p=>p===tr.entry);
      const x=padding+(tradeIdx/(len-1))*w;
      const y=canvas.height-padding-((tr.entry-minVal)/range)*h;

      ctx.setLineDash([6,4]);
      ctx.strokeStyle=tr.type==="BUY"?"rgba(16,185,129,0.9)":"rgba(220,38,38,0.9)";
      ctx.lineWidth=1.2;
      ctx.beginPath();
      ctx.moveTo(padding,y);
      ctx.lineTo(canvas.width-padding,y);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle=tr.type==="BUY"?"green":"red";
      ctx.beginPath();
      if(tr.type==="BUY"){
        ctx.moveTo(x,y-10); ctx.lineTo(x-8,y); ctx.lineTo(x+8,y);
      } else {
        ctx.moveTo(x,y+10); ctx.lineTo(x-8,y); ctx.lineTo(x+8,y);
      }
      ctx.closePath(); ctx.fill();

      ctx.fillStyle=tr.type==="BUY"?"green":"red";
      ctx.font="12px Inter, Arial";
      ctx.textAlign="left"; ctx.textBaseline="middle";
      ctx.fillText(formatNum(tr.entry),x+12,y);
    });

    // current tick line
    const lastPrice=chartData[len-1];
    const yCur=canvas.height-padding-((lastPrice-minVal)/range)*h;
    ctx.strokeStyle="#16a34a"; ctx.lineWidth=1.2;
    ctx.beginPath(); ctx.moveTo(padding,yCur); ctx.lineTo(canvas.width-padding,yCur); ctx.stroke();

    ctx.fillStyle="#16a34a"; ctx.beginPath(); ctx.arc(canvas.width-padding,yCur,4,0,Math.PI*2); ctx.fill();
    ctx.fillStyle="#064e3b"; ctx.font="13px Inter, Arial";
    ctx.textAlign="right"; ctx.textBaseline="bottom";
    ctx.fillText(formatNum(lastPrice),canvas.width-padding-6,yCur-6);
  }

  function canvasMouseMove(e){
    if(!canvas||chartData.length===0) return;
    const rect=canvas.getBoundingClientRect();
    const mouseX=e.clientX-rect.left;
    const padding=50,w=canvas.width-padding*2;
    const len=chartData.length;
    let idx=Math.round((mouseX-padding)/w*(len-1));
    idx=Math.max(0,Math.min(idx,len-1));
    const price=chartData[idx];
    const time=chartTimes[idx]?new Date(chartTimes[idx]*1000).toLocaleTimeString().slice(0,8):"";
    let tradesHtml="";
    trades.forEach(tr=>{
      if(tr.symbol!==currentSymbol) return;
      tradesHtml+=`<div style="color:${tr.type==="BUY"?"#0ea5a4":"#ef4444"}">${tr.type} @ ${formatNum(tr.entry)} stake:${tr.stake} mult:${tr.multiplier}</div>`;
    });
    tooltip.style.display="block";
    tooltip.style.left=(e.clientX+12)+"px";
    tooltip.style.top=(e.clientY-36)+"px";
    tooltip.innerHTML=`<div><strong>${currentSymbol}</strong></div><div>Price: ${formatNum(price)}</div><div>Time: ${time}</div>${tradesHtml}`;
  }

  // trades
  const pendingProposals=new Map();

  function executeTrade(type){
    if(!currentSymbol||chartData.length===0) return;
    const stake=parseFloat(stakeInput.value)||1;
    const multiplier=parseInt(multiplierInput.value)||100;
    const mode=simulationMode?"simulation":modeSelect.value;
    const entry=chartData[chartData.length-1];

    const trade={
      symbol:currentSymbol,type,stake,multiplier,entry,
      timestamp:Date.now(),
      id:`sim-${Date.now()}-${Math.random().toString(36).slice(2,8)}`
    };
    trades.push(trade);
    logHistory(`${type} ${currentSymbol} @ ${formatNum(entry)} stake:${stake} mult:${multiplier}`);
    if(mode==="simulation"){ updatePnL(); return; }

    if(!ws||ws.readyState!==WebSocket.OPEN||!authorized){
      logHistory("WebSocket not ready or not authorized — can't execute live trade");
      return;
    }

    const orderType=(type==="BUY")?"MULTUP":"MULTDOWN";
    const req_id=Math.floor(Math.random()*1000000);
    const proposalRequest={
      proposal:1,amount:stake,basis:"stake",contract_type:orderType,
      currency:"USD",symbol:currentSymbol,duration:60,duration_unit:"s",
      multiplier:multiplier,subscribe:1,req_id
    };
    pendingProposals.set(req_id,{trade,type,stake,multiplier});
    ws.send(JSON.stringify(proposalRequest));
    logHistory(`Sent proposal request req_id=${req_id} for ${type} ${currentSymbol}`);
  }

  function handleProposalResponse(data){
    const req_id=data.echo_req?.req_id;
    const proposalId=data.proposal?.id || data.id;
    if(!req_id||!proposalId||!pendingProposals.has(req_id)) return;
    const ctx=pendingProposals.get(req_id);
    ws.send(JSON.stringify({buy:proposalId,subscribe:1}));
    logHistory(`Sent BUY for ${ctx.trade.symbol} proposal id=${proposalId}`);
    pendingProposals.delete(req_id);
  }

  function handleBuyResponse(data){
    if(data.buy) logHistory(`Buy response: ${JSON.stringify(data.buy).slice(0,120)}`);
    if(data.proposal_open_contract){
      const poc=data.proposal_open_contract;
      logHistory(`Opened contract id=${poc.contract_id||poc.id||'unknown'} payout:${poc.payout||poc.amount||'n/a'}`);
    }
  }

  function updatePnL(){
    if(chartData.length===0){ pnlDisplay.textContent="PnL: --"; return; }
    const priceNow=chartData[chartData.length-1];
    let pnl=0;
    trades.forEach(tr=>{
      const delta=tr.type==="BUY"?(priceNow-tr.entry):(tr.entry-priceNow);
      pnl+=delta*(tr.stake||1);
    });
    pnlDisplay.textContent="PnL: "+pnl.toFixed(2);
  }

  // websocket
  connectBtn.onclick=()=>{
    if(ws&&ws.readyState===WebSocket.OPEN){
      ws.close(); ws=null; setStatus("Disconnected"); return;
    }
    const token=tokenInput.value.trim();
    if(!token){ 
      simulationMode=true; 
      setStatus("Simulation Mode (no token)");
      startSimTicks();
      connectBtn.textContent="Disconnect Simulation"; 
      logHistory("Running in simulation mode (no token)"); 
      return; 
    }

    ws=new WebSocket(WS_URL);
    setStatus("Connecting...");
    ws.onopen=()=>{
      setStatus("Connected");
      ws.send(JSON.stringify({authorize:token}));
    };
    ws.onclose=()=>{
      setStatus("Disconnected"); logHistory("WS closed"); stopSimTicks();
    };
    ws.onerror=(e)=>{ logHistory("WS error "+JSON.stringify(e)); stopSimTicks(); };
    ws.onmessage=(msg)=>{
      const data=JSON.parse(msg.data);
      if(data.msg_type==="authorize"){
        authorized=data.authorize?.client_id?true:false;
        if(!authorized){
          logHistory("Token not authorized — switching to simulation mode");
          simulationMode=true;
          setStatus("Simulation Mode");
          startSimTicks();
        } else {
          logHistory("Authorized: "+authorized);
        }
      }
      if(data.msg_type==="balance") userBalance.textContent=formatNum(data.balance?.balance||0);
      if(data.msg_type==="tick") handleTick(data.tick);
      if(data.msg_type==="proposal") handleProposalResponse(data);
      if(data.msg_type==="buy") handleBuyResponse(data);
    };
    connectBtn.textContent="Disconnect";
  };

  function subscribeTicks(symbol){
    if(simulationMode) return;
    if(!ws||ws.readyState!==WebSocket.OPEN) return;
    ws.send(JSON.stringify({ticks:symbol,subscribe:1}));
  }

  function handleTick(tick){
    const p=tick.quote;
    lastPrices[tick.symbol]=p;
    chartData.push(p);
    chartTimes.push(tick.epoch);
    if(chartData.length>500){ chartData.shift(); chartTimes.shift(); }
    drawChart();
    drawGauges();
    updatePnL();
  }

  function startSimTicks(){
    if(simInterval) clearInterval(simInterval);
    simInterval=setInterval(()=>{
      if(!currentSymbol) return;
      let last=chartData[chartData.length-1]||1000;
      const change=(Math.random()-0.5)*20;
      const tick={symbol:currentSymbol,quote:last+change,epoch:Math.floor(Date.now()/1000)};
      handleTick(tick);
    },1000);
  }
  function stopSimTicks(){ if(simInterval) clearInterval(simInterval); simInterval=null; }

  buyBtn.onclick=()=>executeTrade("BUY");
  sellBtn.onclick=()=>executeTrade("SELL");

  window.addEventListener("resize",()=>{ 
    if(canvas){ canvas.width=chartInner.clientWidth; canvas.height=chartInner.clientHeight; drawChart(); } 
  });

  initSymbols();
  initCanvas();
  initGauges();
  drawGauges();
});
