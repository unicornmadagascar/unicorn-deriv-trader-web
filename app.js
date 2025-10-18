document.addEventListener("DOMContentLoaded", () => {
    const APP_ID = 105747;
    const WS_URL = `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;

    // UI elements
    const tokenInput = document.getElementById("tokenInput");
    const connectBtn = document.getElementById("connectBtn");
    const statusSpan = document.getElementById("status");
    const userBalance = document.getElementById("userBalance");
    const chartInner = document.getElementById("chartInner");
    const buyBtn = document.getElementById("buyBtn");
    const sellBtn = document.getElementById("sellBtn");
    const stakeInput = document.getElementById("stake");
    const multiplierInput = document.getElementById("multiplier");
    const pnlDisplay = document.getElementById("pnl");

    let ws = null;
    let authorized = false;
    let currentSymbol = "BOOM1000";
    let chartData = [];
    let chartTimes = [];
    let trades = [];
    let canvas, ctx;

    // Canvas init
    function initCanvas() {
        chartInner.innerHTML = "";
        canvas = document.createElement("canvas");
        canvas.width = chartInner.clientWidth;
        canvas.height = chartInner.clientHeight;
        chartInner.appendChild(canvas);
        ctx = canvas.getContext("2d");
    }
    initCanvas();

    // --- Draw chart + trades ---
    function drawChart() {
        if (!ctx || chartData.length === 0) return;

        const padding = 50;
        const w = canvas.width - padding * 2;
        const h = canvas.height - padding * 2;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const maxVal = Math.max(...chartData, ...trades.map(t => t.entry || 0));
        const minVal = Math.min(...chartData, ...trades.map(t => t.entry || chartData[0]));
        const range = maxVal - minVal || 1;

        // Line chart
        ctx.beginPath();
        for (let i = 0; i < chartData.length; i++) {
            const x = padding + (i / (chartData.length - 1)) * w;
            const y = canvas.height - padding - ((chartData[i] - minVal) / range) * h;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = "#007bff";
        ctx.lineWidth = 2;
        ctx.stroke();

        // Trades
        trades.forEach(tr => {
            if (!tr.entry) return;
            const x = w + padding;
            const y = canvas.height - padding - ((tr.entry - minVal) / range) * h;

            ctx.setLineDash([6, 4]);
            ctx.strokeStyle = "red";
            ctx.beginPath();
            ctx.moveTo(padding, y);
            ctx.lineTo(canvas.width - padding, y);
            ctx.stroke();
            ctx.setLineDash([]);

            ctx.fillStyle = tr.type === "BUY" ? "green" : "red";
            ctx.beginPath();
            if (tr.type === "BUY") { ctx.moveTo(x, y - 10); ctx.lineTo(x - 8, y); ctx.lineTo(x + 8, y); }
            else { ctx.moveTo(x, y + 10); ctx.lineTo(x - 8, y); ctx.lineTo(x + 8, y); }
            ctx.closePath();
            ctx.fill();

            ctx.fillStyle = "red";
            ctx.font = "12px Arial";
            ctx.textAlign = "right";
            ctx.textBaseline = "bottom";
            ctx.fillText(tr.entry.toFixed(2), canvas.width - padding - 4, y - 2);
        });

        // PNL
        if (chartData.length > 0) {
            const lastPrice = chartData[chartData.length - 1];
            let pnl = 0;
            trades.forEach(tr => {
                if (!tr.entry) return;
                const diff = tr.type === "BUY" ? lastPrice - tr.entry : tr.entry - lastPrice;
                pnl += diff * tr.multiplier * tr.stake;
            });
            pnlDisplay.textContent = pnl.toFixed(2);
        }
    }

    // --- Fetch contract entry from Deriv ---
    function fetchContractEntry(trade) {
        if (!authorized || !ws || ws.readyState !== WebSocket.OPEN) return;

        ws.send(JSON.stringify({ proposal_open_contract: 1, contract_id: trade.contract_id }));

        const listener = (msg) => {
            const data = JSON.parse(msg.data);
            if (data.msg_type === "proposal_open_contract" && data.proposal_open_contract) {
                const poc = data.proposal_open_contract;
                if (poc.contract_id === trade.contract_id) {
                    trade.entry = poc.entry_spot;
                    trade.profit = poc.profit;
                    drawChart();
                    ws.removeEventListener("message", listener);
                }
            }
        };
        ws.addEventListener("message", listener);
    }

    // --- Place trade ---
    function executeTrade(type) {
        if (!authorized || !ws || ws.readyState !== WebSocket.OPEN) return;
        const stake = parseFloat(stakeInput.value) || 1;
        const multiplier = parseInt(multiplierInput.value) || 300;

        const payload = {
            buy: 1,
            price: stake.toFixed(2),
            parameters: {
                contract_type: type === "BUY" ? "MULTUP" : "MULTDOWN",
                symbol: currentSymbol,
                currency: "USD",
                basis: "stake",
                amount: stake.toFixed(2),
                multiplier: multiplier
            }
        };
        ws.send(JSON.stringify(payload));
        console.log("Payload sent", payload);

        // Add dummy trade object, will be updated when server confirms
        const trade = { symbol: currentSymbol, type, stake, multiplier, contract_id: null, entry: null };
        trades.push(trade);
    }

    buyBtn.onclick = () => executeTrade("BUY");
    sellBtn.onclick = () => executeTrade("SELL");

    // --- Connect WebSocket ---
    connectBtn.onclick = () => {
        if (ws && ws.readyState === WebSocket.OPEN) { ws.close(); return; }
        const token = tokenInput.value.trim();
        ws = new WebSocket(WS_URL);
        ws.onopen = () => ws.send(JSON.stringify({ authorize: token }));
        ws.onmessage = (msg) => {
            const data = JSON.parse(msg.data);

            if (data.msg_type === "authorize") {
                if (!data.authorize?.loginid) { statusSpan.textContent = "Token invalid"; return; }
                authorized = true;
                statusSpan.textContent = `Connected: ${data.authorize.loginid}`;
                ws.send(JSON.stringify({ ticks: currentSymbol, subscribe: 1 }));
            }

            if (data.msg_type === "balance" && data.balance) {
                userBalance.textContent = `Balance: ${parseFloat(data.balance.balance).toFixed(2)} ${data.balance.currency}`;
            }

            if (data.msg_type === "tick" && data.tick) {
                chartData.push(Number(data.tick.quote));
                chartTimes.push(data.tick.epoch);
                if (chartData.length > 600) { chartData.shift(); chartTimes.shift(); }
                drawChart();
            }

            if (data.msg_type === "proposal_open_contract" && data.proposal_open_contract) {
                const poc = data.proposal_open_contract;
                // Find trade by contract_id if exists
                const tr = trades.find(t => t.contract_id === poc.contract_id);
                if (tr) {
                    tr.entry = poc.entry_spot;
                    tr.profit = poc.profit;
                    drawChart();
                }
            }

            // After placing trade, Deriv returns "buy" confirmation with contract_id
            if (data.msg_type === "buy" && data.buy?.contract_id) {
                const lastTrade = trades[trades.length - 1];
                if (lastTrade) {
                    lastTrade.contract_id = data.buy.contract_id;
                    fetchContractEntry(lastTrade);
                }
            }
        };
    };
});
