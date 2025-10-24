document.addEventListener("DOMContentLoaded", () => {
    const WS_URL = `wss://ws.derivws.com/websockets/v3?app_id=105747`;
    const API_TOKEN = "VOTRE_API_TOKEN_ICI";
    const connectBtn = document.getElementById("connectBtn");
    const statusSpan = document.getElementById("status");
    const userBalance = document.getElementById("userBalance");
    const symbolList = document.getElementById("symbolList");
    const chartContainer = document.getElementById("chartInner");

    // === Nouveaux éléments ===
    const gaugesContainer = document.createElement("div");
    gaugesContainer.id = "gaugesContainer";
    chartContainer.parentElement.insertBefore(gaugesContainer, chartContainer);

    gaugesContainer.innerHTML = `
        <div class="gauge" id="volGauge"><span class="label">Volatilité</span><span class="value">0%</span></div>
        <div class="gauge" id="trendGauge"><span class="label">Force</span><span class="value">0%</span></div>
        <div class="gauge" id="probGauge"><span class="label">Probabilité</span><span class="value">0%</span></div>
    `;

    let ws = null;
    let authorized = false;
    let currentSymbol = "BOOM1000";
    let chart = null;
    let areaSeries = null;
    let chartData = [];
    let lastPrices = {};
    let barTargets = {};
    let barSmooth = {};

    const volatilitySymbols = [
        "BOOM1000", "CRASH1000", "BOOM900", "CRASH900", "BOOM600", "CRASH600",
        "BOOM500", "CRASH500", "R_100", "R_75", "R_50", "R_25", "R_10"
    ];

    const formatNum = n => Number(n).toFixed(2);
    const setStatus = txt => statusSpan.textContent = txt;

    // Gauges state
    let volGauge = document.getElementById("volGauge");
    let trendGauge = document.getElementById("trendGauge");
    let probGauge = document.getElementById("probGauge");
    let recentChanges = [];

    // === Chart ===
    function initChart() {
        chartContainer.innerHTML = "";
        chart = LightweightCharts.createChart(chartContainer, {
            width: chartContainer.clientWidth,
            height: chartContainer.clientHeight,
            layout: { background: { type: 'solid', color: '#fff' }, textColor: '#000' },
            grid: { vertLines:{color:"#eee"}, horzLines:{color:"#eee"} },
        });
        areaSeries = chart.addSeries(LightweightCharts.AreaSeries, {
            lineColor: '#2962FF',
            topColor: 'rgba(41,98,255,0.4)',
            bottomColor: 'rgba(41,98,255,0.05)',
            lineWidth: 2,
            lineType: LightweightCharts.LineType.Smooth
        });
    }

    // === Symboles ===
    function initSymbols() {
        symbolList.innerHTML = "";
        volatilitySymbols.forEach(sym => {
            const el = document.createElement("div");
            el.className = "symbolItem";
            el.id = `symbol-${sym}`;
            el.innerHTML = `
                <div class="symbolRow">
                    <span class="symName">${sym}</span>
                    <span class="lastPrice">0</span>
                </div>
                <div class="progressBar"><div class="progressFill"></div></div>
            `;
            el.onclick = () => selectSymbol(sym);
            symbolList.appendChild(el);
            barTargets[sym] = 50;
            barSmooth[sym] = 50;
        });
        selectSymbol(currentSymbol);
    }

    function selectSymbol(sym) {
        currentSymbol = sym;
        document.querySelectorAll(".symbolItem").forEach(e => e.classList.remove("selected"));
        const el = document.getElementById(`symbol-${sym}`);
        if(el) el.classList.add("selected");
        chartData = [];
        recentChanges = [];
        initChart();
        subscribeTicks(sym);
    }

    // === WebSocket ===
    function connectDeriv(token) {
        if(ws) ws.close();

        ws = new WebSocket(WS_URL);
        ws.onopen = () => {
            setStatus("Connecting...");
            ws.send(JSON.stringify({ authorize: token }));
        };

        ws.onmessage = msg => {
            const data = JSON.parse(msg.data);

            if(data.msg_type === "authorize" && data.authorize?.loginid){
                setStatus(`Connected: ${data.authorize.loginid}`);
                authorized = true;
                volatilitySymbols.forEach(sym => subscribeTicks(sym));
            }

            if(data.msg_type === "balance" && data.balance){
                const bal = parseFloat(data.balance.balance).toFixed(2);
                const cur = data.balance.currency;
                userBalance.textContent = `Balance: ${bal} ${cur}`;
            }

            if(data.msg_type === "tick" && data.tick){
                handleTick(data.tick);
            }
        };

        ws.onclose = () => setStatus("Disconnected");
        ws.onerror = e => console.error("WS Error:", e);
    }

    function subscribeTicks(symbol) {
        if(ws && ws.readyState === WebSocket.OPEN){
            ws.send(JSON.stringify({ ticks: symbol, subscribe: 1 }));
        }
    }

    // === Tick Update ===
    function handleTick(tick) {
        const p = Number(tick.quote);
        const symbol = tick.symbol;
        const prev = lastPrices[symbol] ?? p;
        const change = p - prev;
        lastPrices[symbol] = p;

        // Liste symboles
        const el = document.getElementById(`symbol-${symbol}`);
        if(el){
            const priceSpan = el.querySelector(".lastPrice");
            const progress = el.querySelector(".progressFill");
            priceSpan.textContent = formatNum(p);

            const intensity = Math.min(50 + Math.abs(change) * 300, 100);
            if(change > 0){
                barTargets[symbol] = 50 + (intensity / 2);
                progress.dataset.color = "green";
            } else if(change < 0){
                barTargets[symbol] = 50 - (intensity / 2);
                progress.dataset.color = "red";
            } else {
                progress.dataset.color = "neutral";
            }
        }

        // === Chart et Gauges ===
        if(symbol === currentSymbol){
            const localTime = Math.floor(Date.now() / 1000);
            const point = { time: localTime, value: p };
            chartData.push(point);
            if(chartData.length > 600) chartData.shift();
            if(chartData.length === 1) areaSeries.setData(chartData);
            else areaSeries.update(point);
            chart.timeScale().fitContent();

            updateGauges(change);
        }
    }

    // === Calcul des gauges ===
    function updateGauges(change) {
        recentChanges.push(change);
        if(recentChanges.length > 50) recentChanges.shift();

        // Volatilité : moyenne des amplitudes absolues
        const volatility = Math.min(100, (recentChanges.reduce((a,b)=>a+Math.abs(b),0)/recentChanges.length)*10000);

        // Force de tendance : pente moyenne (EMA simplifiée)
        const trendStrength = Math.min(100, Math.abs(recentChanges.reduce((a,b)=>a+b,0))*10000);

        // Probabilité de tendance : % de ticks du même signe
        const positives = recentChanges.filter(c => c > 0).length;
        const negatives = recentChanges.filter(c => c < 0).length;
        const prob = (positives > negatives ? positives : negatives) / recentChanges.length * 100;

        setGauge(volGauge, volatility, "#FF9800");
        setGauge(trendGauge, trendStrength, "#2962FF");
        setGauge(probGauge, prob, "#4CAF50");
    }

    function setGauge(el, val, color) {
        const v = Math.round(val);
        el.querySelector(".value").textContent = `${v}%`;
        el.style.background = `conic-gradient(${color} ${v*3.6}deg, #ddd ${v*3.6}deg)`;
    }

    // === Lissage progress bars ===
    function animateBars() {
        for(const sym of volatilitySymbols){
            const el = document.getElementById(`symbol-${sym}`);
            if(!el) continue;
            const progress = el.querySelector(".progressFill");
            if(!progress) continue;

            barSmooth[sym] += (barTargets[sym] - barSmooth[sym]) * 0.1;
            const width = Math.max(10, Math.min(100, barSmooth[sym]));
            progress.style.width = `${width}%`;

            let color = "#999";
            if(progress.dataset.color === "green") color = "#4CAF50";
            else if(progress.dataset.color === "red") color = "#F44336";
            progress.style.background = color;
        }
        requestAnimationFrame(animateBars);
    }

    // === Connect ===
    connectBtn.onclick = () => connectDeriv(API_TOKEN);

    // === Init ===
    initSymbols();
    initChart();
    animateBars();

    window.addEventListener("resize", () => {
        chart.resize(chartContainer.clientWidth, chartContainer.clientHeight);
    });
});
