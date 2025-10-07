// app.js
const app_id = 105747; // You can change this to your Deriv app_id
const token = "fLFhz9DGrADtpyg"; // Replace with your Deriv token
const connection = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${app_id}`);

// Chart container
const chartContainer = document.getElementById("chart");
let chart, series;

// Synthetic indices to display
const symbolsList = [
  "BOOM1000",
  "BOOM900",
  "BOOM600",
  "BOOM500",
  "BOOM300",
  "CRASH1000",
  "CRASH900",
  "CRASH600",
  "CRASH500",
  "CRASH300",
];

const symbolListEl = document.getElementById("symbols");
const pnlEl = document.getElementById("pnl");
const accountEl = document.getElementById("account");
let currentSymbol = null;
let tickStreamId = null;

// Initialize chart
function initChart() {
  chart = LightweightCharts.createChart(chartContainer, {
    width: chartContainer.clientWidth,
    height: 400,
    layout: {
      background: { color: "#111" },
      textColor: "#DDD",
    },
    grid: { vertLines: { color: "#333" }, horzLines: { color: "#333" } },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
  });

  series = chart.addLineSeries({ color: "#00bcd4", lineWidth: 2 });
}

window.addEventListener("resize", () => {
  chart.applyOptions({ width: chartContainer.clientWidth });
});

// Subscribe to ticks for selected symbol
function subscribeTicks(symbol) {
  if (tickStreamId) {
    connection.send(JSON.stringify({ forget: tickStreamId }));
  }

  connection.send(JSON.stringify({ ticks: symbol, subscribe: 1 }));
  currentSymbol = symbol;
  series.setData([]);
}

// Handle Deriv messages
connection.onmessage = function (msg) {
  const data = JSON.parse(msg.data);

  // Handle tick updates
  if (data.tick) {
    const tick = data.tick;
    series.update({ time: tick.epoch, value: tick.quote });
  }

  // Handle authorization confirmation
  if (data.authorize) {
    accountEl.textContent = `Account: ${data.authorize.loginid}`;
    pnlEl.textContent = `Balance: ${data.authorize.balance.toFixed(2)} USD`;
  }

  // Handle active_symbols (only once)
  if (data.active_symbols) {
    const symbols = data.active_symbols.filter((s) =>
      symbolsList.includes(s.symbol)
    );

    symbolListEl.innerHTML = "";
    symbols.forEach((s) => {
      const li = document.createElement("li");
      li.textContent = `${s.display_name}`;
      li.style.cursor = "pointer";
      li.onclick = () => {
        subscribeTicks(s.symbol);
        highlightSelected(li);
      };
      symbolListEl.appendChild(li);
    });
  }

  // Handle tick stream id
  if (data.subscription && data.subscription.id) {
    tickStreamId = data.subscription.id;
  }
};

// Highlight selected symbol
function highlightSelected(selectedLi) {
  document.querySelectorAll("#symbols li").forEach((li) => {
    li.style.background = "transparent";
  });
  selectedLi.style.background = "#333";
}

// When connected, authorize and request symbols
connection.onopen = function () {
  connection.send(JSON.stringify({ authorize: token }));

  connection.send(
    JSON.stringify({
      active_symbols: "full",
      product_type: "basic",
    })
  );
};

// Init chart on load
initChart();
