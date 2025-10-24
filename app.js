// app.js - Unicorn Madagascar (ES Module version)
import { createChart, AreaSeries } from 'https://unpkg.com/lightweight-charts@8.5.0/dist/lightweight-charts.esm.browser.js';

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
            width: chartContainer.clientWidth,
            height: chartContainer.clientHeight,
            layout: { backgroundColor: "#fff", textColor: "#333" },
            grid: { vertLines:{color:"#eee"}, horzLines:{color:"#eee"} },
        });
        areaSeries = chart.addSeries(AreaSeries, {
            topColor: "rgba(59,130,246,0.3)",
            bottomColor: "rgba(59,130,246,0.05)",
            lineColor: "#3b82f6",
            lineWidth: 2,
        });
    }

    // ------------------ Symbols List ------------------
    function initSymbols() {
        symbolList.innerHTML = "";
        volatilitySymbols.forEach(sym => {
            const el = document.createElement("div");
            el.className = "symbolItem";
            el.style.cursor = "pointer";
            el.style.padding = "8px 12px";
            el.style.marginBottom = "4px";
            el.style.backgroundColor = "#fff";
            el.style.display = "flex";
            el.style.justifyContent = "space-between";
            el.style.alignItems = "center";
            el.style.borderRadius = "6px";
            el.style.transition = "all 0.2s ease";
            el.id = `symbol-${sym}`;

            const label = sym.startsWith("BOOM") ? `BOOM ${sym.slice(4)}` :
                        sym.startsWith("CRASH") ? `CRASH ${sym.slice(5)}` :
                        `VIX ${sym.split("_")[1]}`;
            el.innerHTML = `<span>${label}</span><span class="lastPrice">0</span>`;

            el.onmouseenter = () => el.style.backgroundColor = "#e5f1ff";
            el.onmouseleave = () => el.style.backgroundColor = el.dataset.selected === "true" ? "#d0e8ff" : "#fff";

            el.onclick = () => selectSymbol(sym);

            symbolList.appendChild(el);
        });
    }

    function selectSymbol(sym) {
        currentSymbol = sym;
        document.querySelectorAll(".symbolItem").forEach(e => {
            e.style.fontWeight = "normal";
            e.dataset.selected = "false";
            e.style.backgroundColor = "#fff";
        });
        const el = document.getElementById(`symbol-${sym}`);
        if(el){
            el.style.fontWeight = "bold";
            el.dataset.selected = "true";
            el.style.backgroundColor = "#d0e8ff";
        }

        chartData = [];
        initChart();
        subscribeTicks(sym);
    }

    // ------------------ WebSocket Connect ------------------
    function connectDeriv(token) {
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
                // Subscribe all symbols ticks
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

    // ------------------ Subscribe Ticks ------------------
    function subscribeTicks(symbol) {
        if(ws && ws.readyState === WebSocket.OPEN){
            ws.send(JSON.stringify({ ticks: symbol, subscribe:1 }));
        }
    }

    function handleTick(tick) {
        const p = Number(tick.quote);
        lastPrices[tick.symbol] = p;

        // Update symbol list
        const el = document.getElementById(`symbol-${tick.symbol}`);
        if(el) el.querySelector(".lastPrice").textContent = formatNum(p);

        // Update chart if current symbol
        if(tick.symbol === currentSymbol && areaSeries){
            const time = Math.floor(tick.epoch);
            chartData.push({ time, value: p });
            if(chartData.length > 600) chartData.shift();
            areaSeries.setData(chartData);
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
    window.addEventListener("resize", ()=> {
        if(chart) chart.resize(chartContainer.clientWidth, chartContainer.clientHeight);
    });
});
