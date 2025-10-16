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
  const tp = document.getElementById("tp");
  const sl = document.getElementById("sl");
  const stake = document.getElementById("stake");
  const multiplierInput = document.getElementById("multiplier");
  const pnlDisplay = document.getElementById("pnl");

  let ws = null, authorized = false;
  let currentSymbol = "BOOM1000";
  let lastPrices = {}, chartData = [], chartTimes = [], trades = [];
  let canvas, ctx;
  let gaugeSmoothers = { volatility:0, rsi:0, emaProb:0 };
  const SMA_WINDOW = 20;
  const volatilitySymbols = ["BOOM1000","CRASH1000","BOOM900","CRASH900","BOOM600","CRASH600","BOOM500","CRASH500"];

  // tooltip
  const tooltip = document.createElement("div");
  tooltip.style.cssText = "position:fixed;padding:6px 10px;background:rgba(0,0,0,0.85);color:#fff;font-size:12px;border-radius:6px;pointer-events:none;display:none;z-index:9999";
  document.body.appendChild(tooltip);

  function logHistory(txt){
    const d=document.createElement("div");
    d.textContent = `${new Date().toLocaleTimeString()} — ${txt}`;
    historyList.prepend(d);
  }
  function setStatus(txt){ statusSpan.textContent = txt; }
  function formatNum(n){ return Number(n).toFixed(2); }

  // Symbols
  function initSymbols(){
    symbolList.innerHTML = "";
    volatilitySymbols.forEach(sym=>{
      const el = document.createElement("div");
      el.className="symbolItem"; el.id=`symbol-${sym}`; el.textContent=sym;
      el.onclick = ()=>selectSymbol(sym);
      symbolList.appendChild(el);
    });
  }
  function selectSymbol(sym){
    currentSymbol=sym;
    document.querySelectorAll(".symbolItem").forEach(e=>e.classList.remove("active"));
    const el = document.getElementById(`symbol-${sym}`);
    if(el) el.classList.add("active");
    chartData=[]; chartTimes=[]; trades=[];
    initCanvas(); initGauges(); subscribeTicks(sym);
    logHistory(`Selected ${sym}`);
  }

  // Canvas & Chart
  function initCanvas(){
    chartInner.innerHTML="";
    canvas=document.createElement("canvas");
    canvas.width=chartInner.clientWidth; canvas.height=chartInner.clientHeight;
    canvas.style.width="100%"; canvas.style.height="100%";
    chartInner.appendChild(canvas); ctx=canvas.getContext("2d");
    canvas.addEventListener("mousemove", canvasMouseMove);
    canvas.addEventListener("mouseleave",()=>{ tooltip.style.display="none"; });
  }

  function initGauges(){
    gaugeDashboard.innerHTML="";
    ["Volatility","RSI","EMA"].forEach(name=>{
      const c=document.createElement("canvas");
      c.width=c.height=120; c.dataset.gaugeName=name;
      c.style.width=c.style.height="120px";
      gaugeDashboard.appendChild(c);
    });
  }

  function drawGauges(){
    const canvases=gaugeDashboard.querySelectorAll("canvas");
    canvases.forEach(c=>{
      let value=0;
      if(c.dataset.gaugeName==="Volatility") value=computeVolatility();
      else if(c.dataset.gaugeName==="RSI") value=computeRSI();
      else value=computeEMAProb();
      const key=c.dataset.gaugeName==="Volatility"?"volatility":c.dataset.gaugeName==="RSI"?"rsi":"emaProb";
      gaugeSmoothers[key]=gaugeSmoothers[key]*0.7+value*0.3;
      renderGauge(c, gaugeSmoothers[key]);
    });
  }

  function renderGauge(canvas, value){
    const gctx=canvas.getContext("2d");
    const w=canvas.width,h=canvas.height;
    const radius=Math.min(w,h)/2-10;
    gctx.clearRect(0,0,w,h);
    gctx.beginPath(); gctx.arc(w/2,h/2,radius,0,2*Math.PI);
    gctx.strokeStyle="#eee"; gctx.lineWidth=12; gctx.stroke();
    const end=(-Math.PI/2)+(Math.max(0,Math.min(100,value))/100)*2*Math.PI;
    gctx.beginPath(); gctx.arc(w/2,h/2,radius,-Math.PI/2,end);
    gctx.strokeStyle="#2563eb"; gctx.lineWidth=12; gctx.stroke();
    gctx.fillStyle="#222"; gctx.font="12px Inter, Arial"; gctx.textAlign="center"; gctx.textBaseline="middle";
    gctx.fillText(canvas.dataset.gaugeName,w/2,h/2-12);
    gctx.fillText(value.toFixed(1)+"%",w/2,h/2+12);
  }

  function computeVolatility(){
    if(chartData.length<2) return 0;
    const lastN=chartData.slice(-SMA_WINDOW);
    const mean=lastN.reduce((a,b)=>a+b,0)/lastN.length;
    const variance=lastN.reduce((a,b)=>a+Math.pow(b-mean,2),0)/lastN.length;
    const relative=(Math.sqrt(variance)/(chartData[chartData.length-1]||1))*100;
    return Math.min(100,relative*2);
  }

  function computeRSI(period=14){
    if(chartData.length<period+1) return 0;
    const closes=chartData.slice(-(period+1));
    let gains=0, losses=0;
    for(let i=1;i<closes.length;i++){ const d=closes[i]-closes[i-1]; if(d>0) gains+=d; else losses+=Math.abs(d);}
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
    const k=2/(period+1); let ema=arr[0],res=[ema];
    for(let i=1;i<arr.length;i++){ ema=arr[i]*k+ema*(1-k); res.push(ema);}
    return res;
  }

  // Chart drawing (sans TP/SL manuel)
  function drawChart(){
    if(!ctx||chartData.length===0) return;
    const padding=50; const w=canvas.width-padding*2; const h=canvas.height-padding*2;
    ctx.clearRect(0,0,canvas.width,canvas.height);
    const allValues=[...chartData,...trades.flatMap(t=>[t.entry,t.tp,t.sl].filter(v=>v!==null))];
    const maxVal=Math.max(...allValues), minVal=Math.min(...allValues), range=maxVal-minVal||1;

    // axes
    ctx.strokeStyle="#666"; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(padding,padding); ctx.lineTo(padding,canvas.height-padding); ctx.lineTo(canvas.width-padding,canvas.height-padding); ctx.stroke();

    // y labels
    ctx.strokeStyle="#e6eef9"; ctx.fillStyle="#2b3a4a"; ctx.font="12px Inter, Arial"; ctx.textAlign="right"; ctx.textBaseline="middle";
    for(let i=0;i<=5;i++){
      const y=canvas.height-padding-(i/5)*h;
      ctx.beginPath(); ctx.moveTo(padding,y); ctx.lineTo(canvas.width-padding,y); ctx.stroke();
      const v=minVal+(i/5)*range; ctx.fillText(v.toFixed(2),padding-10,y);
    }

    // x labels
    ctx.textAlign="center"; ctx.textBaseline="top";
    const len=chartData.length; const step=Math.max(1,Math.ceil(len/6));
    for(let i=0;i<len;i+=step){
      const x=padding+(i/(len-1))*w;
      const t=chartTimes[i]?new Date(chartTimes[i]*1000).toLocaleTimeString().slice(0,8):"";
      ctx.fillText(t,x,canvas.height-padding+5);
    }

    // line chart
    ctx.beginPath();
    for(let i=0;i<len;i++){
      const x=padding+(i/(len-1))*w;
      const y=canvas.height-padding-((chartData[i]-minVal)/range)*h;
      if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    }
    ctx.strokeStyle="#007bff"; ctx.lineWidth=2; ctx.stroke();

    // trades
    trades.forEach(tr=>{
      if(tr.symbol!==currentSymbol) return;
      const x=padding+((len-1)/(len-1))*w;
      const yEntry=canvas.height-padding-((tr.entry-minVal)/range)*h;

      ctx.setLineDash([6,4]); ctx.strokeStyle="rgba(220,38,38,0.9)"; ctx.lineWidth=1.2;
      ctx.beginPath(); ctx.moveTo(padding,yEntry); ctx.lineTo(canvas.width-padding,yEntry); ctx.stroke(); ctx.setLineDash([]);

      ctx.fillStyle=tr.type==="BUY"?"green":"red"; ctx.beginPath();
      if(tr.type==="BUY"){ ctx.moveTo(x,yEntry-10); ctx.lineTo(x-8,yEntry); ctx.lineTo(x+8,yEntry);}
      else { ctx.moveTo(x,yEntry+10); ctx.lineTo(x-8,yEntry); ctx.lineTo(x+8,yEntry);}
      ctx.closePath(); ctx.fill();
    });

    updatePnL();
  }

  function canvasMouseMove(e){
    if(!canvas||chartData.length===0) return;
    const rect=canvas.getBoundingClientRect();
    const mouseX=e.clientX-rect.left;
    const padding=50; const w=canvas.width-padding*2; const len=chartData.length;
    let idx=Math.round((mouseX-padding)/w*(len-1)); idx=Math.max(0,Math.min(idx,len-1));
    const price=chartData[idx]; const time=chartTimes[idx]?new Date(chartTimes[idx]*1000).toLocaleTimeString().slice(0,8):"";
    let tradesHtml=""; trades.forEach(tr=>{ if(tr.symbol!==currentSymbol) return; tradesHtml+=`<div style="color:${tr.type==="BUY"?"#0ea5a4":"#ef4444"}">${tr.type} @ ${formatNum(tr.entry)} stake:${tr.stake} mult:${tr.multiplier}</div>`; });
    tooltip.style.display="block"; tooltip.style.left=(e.clientX+12)+"px"; tooltip.style.top=(e.clientY-36)+"px"; tooltip.innerHTML=`<div><strong>${currentSymbol}</strong></div><div>Price: ${formatNum(price)}</div><div>Time: ${time}</div>${tradesHtml}`;
  }

  function executeTrade(type){
    const stake=parseFloat(stakeInput.value)||1;
    const multiplier=parseInt(multiplierInput.value)||300;
    const tp = 150;
    const sl = 130;

    const trade={ symbol:currentSymbol,type,stake,multiplier,entry:null,tp:null,sl:null,timestamp:Date.now(),id:`sim-${Date.now()}-${Math.random().toString(36).slice(2,8)}` };
    trades.push(trade);
    logHistory(`${type} ${currentSymbol} sent (awaiting server response)`);

    if(authorized && ws && ws.readyState===WebSocket.OPEN){
      const payload = {
        buy:1,
        price: stake.toFixed(2),
        parameters:{
          contract_type: type==="BUY"?"MULTUP":"MULTDOWN",
          symbol: currentSymbol,
          currency: "USD",
          basis: "stake",
          amount: stake.toFixed(2),
          multiplier: multiplier,
          limit_order: { "stop_loss": sl.toFixed(2), "take_profit": tp.ToFixed(2) } 
        }
      };
      ws.send(JSON.stringify(payload));
      logHistory(`Payload sent: ${JSON.stringify(payload)}`);
    }

    drawChart();
  }

  buyBtn.onclick=()=>executeTrade("BUY");
  sellBtn.onclick=()=>executeTrade("SELL");
  closeBtn.onclick=()=>{ trades=[]; drawChart(); logHistory("All trades closed (local)"); }

  function updatePnL(){
    if(chartData.length===0||trades.length===0){ pnlDisplay.textContent="0"; return; }
    const lastPrice=chartData[chartData.length-1];
    let pnl=0; trades.forEach(tr=>{ if(tr.entry!==null){ const diff=tr.type==="BUY"?lastPrice-tr.entry:tr.entry-lastPrice; pnl+=diff*tr.multiplier*tr.stake; }});
    pnlDisplay.textContent=pnl.toFixed(2);
  }

  function subscribeTicks(symbol){
    if(!ws||ws.readyState!==WebSocket.OPEN) return;
    ws.send(JSON.stringify({ ticks:symbol, subscribe:1 }));
    logHistory(`Subscribed to ticks: ${symbol}`);
  }

  function handleTick(tick){
    const p=Number(tick.quote); const symbol=tick.symbol; lastPrices[symbol]=p;
    if(symbol===currentSymbol){ chartData.push(p); chartTimes.push(tick.epoch); if(chartData.length>600){ chartData.shift(); chartTimes.shift(); } drawChart(); drawGauges(); updatePnL(); }
  }

  connectBtn.onclick=()=>{
    if(ws&&ws.readyState===WebSocket.OPEN){ ws.close(); ws=null; setStatus("Disconnected"); connectBtn.textContent="Connect"; return; }
    const token=tokenInput.value.trim();
    if(!token){ setStatus("Simulation Mode"); logHistory("Running in simulation (no token)"); return; }
    ws=new WebSocket(WS_URL);
    setStatus("Connecting...");
    ws.onopen=()=>{ setStatus("Connected, authorizing..."); ws.send(JSON.stringify({ authorize: token })); };
    ws.onclose=()=>{ setStatus("Disconnected"); logHistory("WS closed"); };
    ws.onerror=e=>{ logHistory("WS error "+JSON.stringify(e)); };
    ws.onmessage=msg=>{
      const data=JSON.parse(msg.data);
      if(data.msg_type==="authorize"){
        if(!data.authorize?.loginid){ setStatus("Simulation Mode (Token invalid)"); logHistory("Token not authorized"); return; }
        authorized=true; setStatus(`Connected: ${data.authorize.loginid}`); logHistory("Authorized: "+data.authorize.loginid);
        ws.send(JSON.stringify({ balance:1, subscribe:1 }));
        volatilitySymbols.forEach(sym=>subscribeTicks(sym));
      }

      // update balance
      if(data.msg_type==="balance"&&data.balance){ const bal=parseFloat(data.balance.balance||0).toFixed(2); const cur=data.balance.currency||"USD"; userBalance.textContent=`Balance: ${bal} ${cur}`; logHistory(`Balance updated: ${bal} ${cur}`); }

      // tick update
      if(data.msg_type==="tick"&&data.tick) handleTick(data.tick);

      // check for trade confirmation (server returns entry, tp, sl)
      if(data.msg_type==="proposal_open_contract" && data.proposal_open_contract){
        const poc=data.proposal_open_contract;
        const trade=trades.find(t=>t.id.startsWith("sim") && t.entry===null);
        if(trade){
          trade.entry=poc.entry_tick;
          trade.tp=poc.take_profit || null;
          trade.sl=poc.stop_loss || null;
          logHistory(`Trade confirmed: Entry=${trade.entry}, TP=${trade.tp}, SL=${trade.sl}`);
          drawChart();
        }
      }
    };
    connectBtn.textContent="Disconnect";
  };

  initSymbols(); selectSymbol(currentSymbol);
});
