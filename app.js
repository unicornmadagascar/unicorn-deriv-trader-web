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

  let ws = null;
  let currentSymbol = null;
  let chartData = [];
  let chartTimes = [];
  let trades = [];
  let lastPrices = {};
  let canvas, ctx;

  const volatilitySymbols = ["BOOM1000", "CRASH1000", "BOOM900", "CRASH900", "BOOM600", "CRASH600", "BOOM500", "CRASH500"];
  
  // log history
  function logHistory(txt) {
    const d = document.createElement("div");
    d.textContent = `${new Date().toLocaleTimeString()} — ${txt}`;
    historyList.prepend(d);
  }
  function setStatus(txt){ statusSpan.textContent = txt; }
  function formatNum(n){ return Number(n).toFixed(2); }

  // init symbols list
  function initSymbols(){
    symbolList.innerHTML = "";
    volatilitySymbols.forEach(sym=>{
      const el=document.createElement("div");
      el.className="symbolItem";
      el.id=`symbol-${sym}`;
      el.textContent=sym;
      el.onclick=()=>selectSymbol(sym);
      symbolList.appendChild(el);
    });
  }

  function selectSymbol(sym){
    currentSymbol = sym;
    document.querySelectorAll(".symbolItem").forEach(e=>e.classList.remove("active"));
    const el=document.getElementById(`symbol-${sym}`);
    if(el) el.classList.add("active");
    chartData=[]; chartTimes=[]; trades=[];
    initCanvas();
  }

  function initCanvas(){
    chartInner.innerHTML="";
    canvas=document.createElement("canvas");
    canvas.width=chartInner.clientWidth;
    canvas.height=chartInner.clientHeight;
    chartInner.appendChild(canvas);
    ctx=canvas.getContext("2d");
  }

  function drawChart(){
    if(!ctx || chartData.length===0) return;
    const padding=50;
    const w=canvas.width-padding*2;
    const h=canvas.height-padding*2;
    ctx.clearRect(0,0,canvas.width,canvas.height);

    const maxVal=Math.max(...chartData);
    const minVal=Math.min(...chartData);
    const range=maxVal-minVal||1;

    // area
    ctx.beginPath();
    chartData.forEach((v,i)=>{
      const x=padding + (i/(chartData.length-1))*w;
      const y=canvas.height-padding - ((v-minVal)/range)*h;
      if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    });
    ctx.lineTo(canvas.width-padding,canvas.height-padding);
    ctx.lineTo(padding,canvas.height-padding);
    ctx.closePath();
    const fillGrad=ctx.createLinearGradient(0,padding,0,canvas.height-padding);
    fillGrad.addColorStop(0,"rgba(0,123,255,0.35)");
    fillGrad.addColorStop(1,"rgba(0,123,255,0.08)");
    ctx.fillStyle=fillGrad;
    ctx.fill();

    // line
    ctx.beginPath();
    chartData.forEach((v,i)=>{
      const x=padding + (i/(chartData.length-1))*w;
      const y=canvas.height-padding - ((v-minVal)/range)*h;
      if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    });
    ctx.strokeStyle="#007bff";
    ctx.lineWidth=2;
    ctx.stroke();

    // trades markers
    trades.forEach(tr=>{
      const x=padding + ((chartData.length-1)/(chartData.length-1))*w;
      const y=canvas.height-padding - ((tr.entry-minVal)/range)*h;
      ctx.setLineDash([6,4]);
      ctx.strokeStyle="rgba(220,38,38,0.9)";
      ctx.beginPath();
      ctx.moveTo(padding,y);
      ctx.lineTo(canvas.width-padding,y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle=tr.type==="BUY"?"green":"red";
      ctx.beginPath();
      if(tr.type==="BUY"){ ctx.moveTo(x,y-10); ctx.lineTo(x-8,y); ctx.lineTo(x+8,y); } 
      else { ctx.moveTo(x,y+10); ctx.lineTo(x-8,y); ctx.lineTo(x+8,y); }
      ctx.closePath(); ctx.fill();
    });

    // current price
    const lastPrice=chartData[chartData.length-1];
    const yCur=canvas.height-padding - ((lastPrice-minVal)/range)*h;
    ctx.strokeStyle="#16a34a"; ctx.lineWidth=1.2;
    ctx.beginPath(); ctx.moveTo(padding,yCur); ctx.lineTo(canvas.width-padding,yCur); ctx.stroke();
    ctx.fillStyle="#16a34a"; ctx.beginPath(); ctx.arc(canvas.width-padding,yCur,4,0,Math.PI*2); ctx.fill();
  }

  function executeTrade(type){
    if(!currentSymbol || chartData.length===0) return;
    const stake=parseFloat(stakeInput.value)||1;
    const multiplier=parseInt(multiplierInput.value)||100;
    const entry=chartData[chartData.length-1];
    const trade={ symbol: currentSymbol, type, stake, multiplier, entry, id:`sim-${Date.now()}` };
    trades.push(trade);
    logHistory(`${type} ${currentSymbol} @ ${formatNum(entry)} stake:${stake} mult:${multiplier}`);
    drawChart();
    updatePnL();
  }

  buyBtn.onclick=()=>executeTrade("BUY");
  sellBtn.onclick=()=>executeTrade("SELL");
  closeBtn.onclick=()=>{
    trades=[];
    updatePnL();
    drawChart();
    logHistory("Toutes les positions fermées (local)");
  };

  function updatePnL(){
    if(chartData.length===0 || trades.length===0){ pnlDisplay.textContent="PnL: 0"; return; }
    const lastPrice=chartData[chartData.length-1];
    let pnl=0;
    trades.forEach(tr=>{
      const diff=tr.type==="BUY"?lastPrice-tr.entry:tr.entry-lastPrice;
      pnl+=diff*tr.stake*tr.multiplier;
    });
    pnlDisplay.textContent=pnl.toFixed(2);
  }

  function handleTick(tick){
    const p=Number(tick.quote);
    const symbol=tick.symbol;
    lastPrices[symbol]=p;
    if(symbol===currentSymbol){
      chartData.push(p); chartTimes.push(tick.epoch);
      if(chartData.length>600){ chartData.shift(); chartTimes.shift(); }
      drawChart(); updatePnL();
    }
    const symbolEl=document.getElementById(`symbol-${symbol}`);
    if(symbolEl){
      let span=symbolEl.querySelector(".lastPrice");
      if(!span){ span=document.createElement("span"); span.className="lastPrice"; span.style.float="right"; span.style.opacity="0.8"; symbolEl.appendChild(span);}
      span.textContent=formatNum(p);
    }
  }

  connectBtn.onclick=()=>{
    if(ws && ws.readyState===WebSocket.OPEN){ ws.close(); ws=null; setStatus("Déconnecté"); connectBtn.textContent="Connecter"; return; }

    const token=tokenInput.value.trim();
    if(!token){ setStatus("Simulation Mode"); logHistory("Exécution sans token (simulation)"); return; }

    ws=new WebSocket(WS_URL);
    setStatus("Connexion...");
    ws.onopen=()=>{ setStatus("Connecté, autorisation en cours..."); ws.send(JSON.stringify({ authorize: token })); };
    ws.onclose=()=>{ setStatus("Déconnecté"); logHistory("WS fermé"); };
    ws.onerror=e=>{ logHistory("WS error "+JSON.stringify(e)); };
    ws.onmessage=msg=>{
      const data=JSON.parse(msg.data);
      if(data.msg_type==="authorize"){
        if(data.error || !data.authorize?.loginid){ setStatus("Simulation Mode (token non autorisé)"); logHistory("Token invalide"); return; }
        setStatus(`Connecté: ${data.authorize.loginid} (Live ticks Demo)`); 
        logHistory("Autorisation réussie: "+data.authorize.loginid);
        // demander solde après autorisation
        ws.send(JSON.stringify({ balance:1, subscribe:1 }));
      }
      if(data.msg_type==="balance" && data.balance){
        const bal=parseFloat(data.balance.balance||0).toFixed(2);
        const cur=data.balance.currency||"USD";
        userBalance.textContent=`Balance: ${bal} ${cur}`;
        logHistory(`Solde mis à jour: ${bal} ${cur}`);
      }
      if(data.msg_type==="tick" && data.tick) handleTick(data.tick);
    };
    connectBtn.textContent="Déconnecter";
  };

  initSymbols();
  selectSymbol(volatilitySymbols[0]);
});
