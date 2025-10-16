// app.js - Unicorn Madagascar (demo live ticks + Multiplier contracts Deriv)

document.addEventListener("DOMContentLoaded", () => {
  const APP_ID = 105747;
  const WS_URL = `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;

  // --- UI ---
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
  const tpInput = document.getElementById("tp");
  const slInput = document.getElementById("sl");
  const pnlDisplay = document.getElementById("pnl");

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
  const volatilitySymbols = [
    "BOOM1000","CRASH1000","BOOM900","CRASH900","BOOM600","CRASH600","BOOM500","CRASH500"
  ];

  // --- UI Helper functions ---
  const tooltip = document.createElement("div");
  tooltip.style.cssText = "position:fixed;padding:6px 10px;background:rgba(0,0,0,0.85);color:#fff;font-size:12px;border-radius:6px;pointer-events:none;display:none;z-index:9999";
  document.body.appendChild(tooltip);

  function logHistory(txt){
    const d = document.createElement("div");
    d.textContent = `${new Date().toLocaleTimeString()} — ${txt}`;
    historyList.prepend(d);
  }
  function setStatus(txt){ statusSpan.textContent = txt; }
  function formatNum(n){ return Number(n).toFixed(2); }

  // --- Symbol management ---
  function initSymbols(){
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

  function selectSymbol(sym){
    currentSymbol = sym;
    document.querySelectorAll(".symbolItem").forEach(e => e.classList.remove("active"));
    const el = document.getElementById(`symbol-${sym}`);
    if(el) el.classList.add("active");
    chartData = []; chartTimes = []; trades = [];
    initCanvas(); initGauges();
    subscribeTicks(sym);
    logHistory(`Selected ${sym}`);
  }

  // --- Canvas setup ---
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

  // --- Chart Drawing ---
  function drawChart(){
    if(!ctx||chartData.length===0) return;
    const padding=50;
    const w=canvas.width-padding*2;
    const h=canvas.height-padding*2;
    ctx.clearRect(0,0,canvas.width,canvas.height);

    const allValues = [...chartData, ...trades.flatMap(t => [t.entry, t.tp, t.sl].filter(v=>v!==null))];
    const maxVal=Math.max(...allValues);
    const minVal=Math.min(...allValues);
    const range=maxVal-minVal||1;

    // axes
    ctx.strokeStyle="#666"; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(padding,padding); ctx.lineTo(padding,canvas.height-padding); ctx.lineTo(canvas.width-padding,canvas.height-padding); ctx.stroke();

    // y labels
    ctx.strokeStyle="#e6eef9"; ctx.fillStyle="#2b3a4a"; ctx.font="12px Inter, Arial"; ctx.textAlign="right"; ctx.textBaseline="middle";
    for(let i=0;i<=5;i++){
      const y=canvas.height-padding-(i/5)*h;
      ctx.beginPath(); ctx.moveTo(padding,y); ctx.lineTo(canvas.width-padding,y); ctx.stroke();
      const v=minVal+(i/5)*range; ctx.fillText(v.toFixed(2), padding-10, y);
    }

    // price line
    ctx.beginPath();
    for(let i=0;i<chartData.length;i++){
      const x=padding+(i/(chartData.length-1))*w;
      const y=canvas.height-padding-((chartData[i]-minVal)/range)*h;
      if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    }
    ctx.strokeStyle="#007bff"; ctx.lineWidth=2; ctx.stroke();

    // --- Draw trades (after confirmed buy) ---
    trades.forEach(tr => {
      if(tr.symbol !== currentSymbol) return;
      const yEntry = canvas.height - padding - ((tr.entry - minVal)/range)*h;
      const yTP = tr.tp!==null ? canvas.height - padding - ((tr.tp - minVal)/range)*h : null;
      const ySL = tr.sl!==null ? canvas.height - padding - ((tr.sl - minVal)/range)*h : null;

      // Entry
      ctx.setLineDash([6,4]);
      ctx.strokeStyle="rgba(220,38,38,0.9)";
      ctx.beginPath(); ctx.moveTo(padding,yEntry); ctx.lineTo(canvas.width-padding,yEntry); ctx.stroke();
      ctx.setLineDash([]);

      // Triangle arrow
      ctx.fillStyle = tr.type==="BUY"?"green":"red";
      ctx.beginPath();
      if(tr.type==="BUY"){ ctx.moveTo(canvas.width-55,yEntry-10); ctx.lineTo(canvas.width-63,yEntry); ctx.lineTo(canvas.width-47,yEntry); }
      else { ctx.moveTo(canvas.width-55,yEntry+10); ctx.lineTo(canvas.width-63,yEntry); ctx.lineTo(canvas.width-47,yEntry); }
      ctx.closePath(); ctx.fill();

      // TP / SL
      if(yTP!==null){
        ctx.setLineDash([4,4]);
        ctx.strokeStyle="rgba(16,185,129,0.9)";
        ctx.beginPath(); ctx.moveTo(padding,yTP); ctx.lineTo(canvas.width-padding,yTP); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle="rgba(16,185,129,0.9)";
        ctx.fillText("TP "+tr.tp.toFixed(2), canvas.width-padding-4, tr.type==="BUY"?yTP-2:yTP+14);
      }
      if(ySL!==null){
        ctx.setLineDash([4,4]);
        ctx.strokeStyle="rgba(239,68,68,0.9)";
        ctx.beginPath(); ctx.moveTo(padding,ySL); ctx.lineTo(canvas.width-padding,ySL); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle="rgba(239,68,68,0.9)";
        ctx.fillText("SL "+tr.sl.toFixed(2), canvas.width-padding-4, tr.type==="BUY"?ySL+14:ySL-2);
      }
    });
  }

  // --- Tick + Gauges ---
  function handleTick(tick){
    const p=Number(tick.quote);
    const symbol=tick.symbol;
    lastPrices[symbol]=p;
    if(symbol===currentSymbol){
      chartData.push(p);
      chartTimes.push(tick.epoch);
      if(chartData.length>600){ chartData.shift(); chartTimes.shift(); }
      drawChart(); updatePnL();
    }
  }

  // --- Execute real Multiplier trade ---
  function executeTrade(type){
    if(!authorized || !ws || ws.readyState!==WebSocket.OPEN) {
      logHistory("❌ Connect and authorize first");
      return;
    }
    if(!currentSymbol){ logHistory("❌ Select a symbol"); return; }

    const stake = parseFloat(stakeInput.value)||1;
    const multiplier = parseInt(multiplierInput.value)||100;
    const tp = parseFloat(tpInput.value)||1;
    const sl = parseFloat(slInput.value)||1;

    const contractType = type === "BUY" ? "MULTUP" : "MULTDOWN";
    const req = {
      buy: 1,
      price: "1.00",
      parameters: {
        contract_type: contractType,
        symbol: currentSymbol.toLowerCase(),
        currency: "USD",
        basis: "stake",
        amount: stake.toString(),
        multiplier: multiplier,
        limit_order: { take_profit: tp, stop_loss: sl }
      }
    };

    ws.send(JSON.stringify(req));
    logHistory(`📤 Sent ${contractType} request for ${currentSymbol}`);
  }

  // --- Handle WebSocket Messages ---
  connectBtn.onclick=()=>{
    if(ws&&ws.readyState===WebSocket.OPEN){ ws.close(); ws=null; setStatus("Disconnected"); connectBtn.textContent="Connect"; return; }
    const token=tokenInput.value.trim();
    if(!token){ setStatus("Simulation Mode"); logHistory("Running without token (simulation)"); return; }
    ws=new WebSocket(WS_URL);
    setStatus("Connecting...");
    ws.onopen=()=>{ ws.send(JSON.stringify({ authorize: token })); };
    ws.onclose=()=>{ setStatus("Disconnected"); };
    ws.onmessage=(msg)=>{
      const data=JSON.parse(msg.data);

      if(data.msg_type==="authorize"){
        if(!data.authorize?.loginid){ setStatus("Token invalid"); return; }
        authorized=true;
        setStatus(`Connected: ${data.authorize.loginid}`);
        ws.send(JSON.stringify({ balance:1, subscribe:1 }));
        volatilitySymbols.forEach(sym=>subscribeTicks(sym));
      }

      if(data.msg_type==="balance"&&data.balance){
        const bal=parseFloat(data.balance.balance||0).toFixed(2);
        userBalance.textContent=`Balance: ${bal} ${data.balance.currency}`;
      }

      if(data.msg_type==="tick"&&data.tick) handleTick(data.tick);

      // ✅ BUY confirmation → add trade to chart
      if(data.msg_type==="buy"&&data.buy){
        const t={
          id:data.buy.contract_id,
          symbol:currentSymbol,
          type:data.buy.longcode.includes("MULTUP")?"BUY":"SELL",
          stake:parseFloat(stakeInput.value),
          multiplier:parseInt(multiplierInput.value),
          entry:parseFloat(data.buy.buy_price),
          tp:parseFloat(tpInput.value),
          sl:parseFloat(slInput.value),
          timestamp:Date.now()
        };
        trades.push(t);
        logHistory(`✅ Trade confirmed: ${t.type} @ ${t.entry}`);
        drawChart(); updatePnL();
      }

      // Real-time updates of open contract
      if(data.msg_type==="proposal_open_contract"&&data.proposal_open_contract){
        updatePnL();
      }

      if(data.error) logHistory("⚠️ "+data.error.message);
    };
    connectBtn.textContent="Disconnect";
  };

  buyBtn.onclick=()=>executeTrade("BUY");
  sellBtn.onclick=()=>executeTrade("SELL");

  closeBtn.onclick=()=>{
    trades=[]; updatePnL(); drawChart(); logHistory("Toutes les positions fermées");
  };

  function subscribeTicks(symbol){
    if(!ws||ws.readyState!==WebSocket.OPEN) return;
    ws.send(JSON.stringify({ ticks: symbol, subscribe:1 }));
  }

  function updatePnL(){
    if(chartData.length===0||trades.length===0){ pnlDisplay.textContent="0"; return; }
    const lastPrice=chartData[chartData.length-1];
    let pnl=0;
    trades.forEach(tr=>{
      const diff=tr.type==="BUY"?lastPrice-tr.entry:tr.entry-lastPrice;
      pnl+=diff*tr.multiplier*tr.stake;
    });
    pnlDisplay.textContent=pnl.toFixed(2);
  }

  initSymbols();
  selectSymbol(volatilitySymbols[0]);
});
