(() => {
'use strict';

// Application Constants
const APP_ID = 105747;
const TOKEN = "wgf8TFDsJ8Ecvze"; 
const WS_URL = `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;

// Utility Functions
const utils = {
  safeNumber: (v, fixed = 2) => (isFinite(Number(v)) ? Number(v) : 0).toFixed(fixed),
  safeText: (v) => (v === null || v === undefined) ? "-" : String(v),
  formatTime: (epoch) => {
    const d = new Date(epoch * 1000);
    return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}:${d.getSeconds().toString().padStart(2, "0")}`;
  },
  formatPrice: (v) => Number(v).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }),
  ecartType: (values) => {
    if (values.length === 0) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.map(x => (x - mean) ** 2).reduce((a, b) => a + b, 0) / values.length;
    return Math.sqrt(variance);
  },
  sigmoid: (x) => 1 / (1 + Math.exp(-x))
};

// Event Emitter Class
class EventEmitter {
  constructor() {
    this.listeners = new Map();
  }
  
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);
    return this;
  }
  
  off(event, callback) {
    this.listeners.get(event)?.delete(callback);
    return this;
  }
  
  emit(event, ...args) {
    this.listeners.get(event)?.forEach(cb => {
      try { 
        cb(...args);
      } catch (e) {
        console.error(`Event listener error for ${event}:`, e);
      }
    });
    return this;
  }
}

// WebSocket Manager
class WSManager extends EventEmitter {
  constructor() {
    super();
    this.mainWS = null;
    this.contractsWS = null;
    this.plWS = null;
    this.authorized = false;
    this.connecting = false;
    this.pendingSubscribes = new Set();
  }

  async connect() {
    if (this.mainWS?.readyState === WebSocket.OPEN) return this.mainWS;
    if (this.connecting) return new Promise((r) => this.once('connected', r));
    
    this.connecting = true;
    
    try {
      if (this.mainWS) await this.disconnect();
      
      this.mainWS = new WebSocket(WS_URL);
      
      await new Promise((resolve, reject) => {
        this.mainWS.onopen = () => {
          this.mainWS.send(JSON.stringify({ authorize: TOKEN }));
        };
        
        this.mainWS.onmessage = (msg) => {
          const data = JSON.parse(msg.data);
          
          if (data.authorize) {
            this.authorized = true;
            this.emit('authorized', data.authorize);
            resolve(this.mainWS);
            this.pendingSubscribes.forEach(s => this.subscribe(s));
            this.pendingSubscribes.clear();
          } else if (data.tick) {
            this.emit('tick', data.tick);
          }
        };
        
        this.mainWS.onclose = () => {
          this.authorized = false;
          this.emit('disconnected');
          reject(new Error('Connection closed'));
        };
        
        this.mainWS.onerror = (err) => {
          this.authorized = false;
          reject(err);
        };
      });
      
      this.emit('connected', this.mainWS);
      return this.mainWS;
      
    } catch (err) {
      this.emit('error', err);
      throw err;
    } finally {
      this.connecting = false;
    }
  }
  
  async disconnect() {
    if (!this.mainWS) return;
    
    return new Promise(resolve => {
      this.mainWS.onclose = () => {
        this.mainWS = null;
        this.authorized = false;
        this.emit('disconnected');
        resolve();
      };
      this.mainWS.close();
    });
  }

  subscribe(symbol) {
    if (!this.mainWS || !this.authorized) {
      this.pendingSubscribes.add(symbol);
      this.connect();
      return;
    }
    
    try {
      // Unsubscribe from previous ticks first
      this.mainWS.send(JSON.stringify({ forget_all: "ticks" }));
      
      // Subscribe to new symbol
      this.mainWS.send(JSON.stringify({ 
        ticks: symbol,
        subscribe: 1
      }));
      
      this.emit('subscribed', symbol);
      
    } catch (e) {
      console.error('Subscribe failed:', e);
      this.pendingSubscribes.add(symbol);
      this.emit('error', e);
    }
  }
  
  send(data) {
    if (!this.mainWS || this.mainWS.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }
    this.mainWS.send(JSON.stringify(data));
  }
}

// Create singleton instance
const deriv = new WSManager();

// Expose Deriv instance and useful constants globally
window.deriv = deriv;
window.DerivConstants = {
  APP_ID,
  TOKEN,
  WS_URL,
  SYMBOLS: [
    { symbol: "BOOM1000", name: "Boom 1000" },
    { symbol: "CRASH1000", name: "Crash 1000" },
    { symbol: "BOOM500", name: "Boom 500" },
    { symbol: "CRASH500", name: "Crash 500" },
    { symbol: "BOOM900", name: "Boom 900" },
    { symbol: "CRASH900", name: "Crash 900" },
    { symbol: "BOOM600", name: "Boom 600" },
    { symbol: "CRASH600", name: "Crash 600" },
    { symbol: "R_100", name: "VIX 100" },
    { symbol: "R_75", name: "VIX 75" },
    { symbol: "R_50", name: "VIX 50" },
    { symbol: "R_25", name: "VIX 25" },
    { symbol: "R_10", name: "VIX 10" }
  ]
};

// UI Initialization and Event Handlers
async function initializeUI() {
  const ui = {
    connectBtn: document.getElementById("connectBtn"),
    symbolList: document.getElementById("symbolList"),
    chartInner: document.getElementById("chartInner"),
    // Add other UI elements here
  };

  if (!ui.connectBtn || !ui.symbolList || !ui.chartInner) {
    throw new Error("Required UI elements not found");
  }

  // Initialize WebSocket connection
  deriv.on('authorized', () => {
    ui.connectBtn.textContent = "Connected";
    ui.connectBtn.style.background = "#4caf50";
  });

  deriv.on('disconnected', () => {
    ui.connectBtn.textContent = "Disconnected";
    ui.connectBtn.style.background = "#f44336";
  });

  deriv.on('error', (err) => {
    console.error("Connection error:", err);
    ui.connectBtn.textContent = "Connection Failed";
    ui.connectBtn.style.background = "#f44336";
  });

  // Display available symbols
  window.DerivConstants.SYMBOLS.forEach(s => {
    const el = document.createElement("div");
    el.className = "symbol-item";
    el.textContent = s.name;
    el.dataset.symbol = s.symbol;
    el.addEventListener("click", () => selectSymbol(s.symbol, el));
    ui.symbolList.appendChild(el);
  });

  // Initialize chart and other components
  initChart(ui.chartInner);
  setupGauges();
  initializeTrading();
}

// Initialize when DOM is ready
document.addEventListener("DOMContentLoaded", () => {
  console.log("Starting Unicorn Deriv Trader...");
  
  initializeUI()
    .then(() => console.log("Application ready"))
    .catch(err => console.error("Startup error:", err));

});

// WebSocket Manager Class
class WSManager {
  constructor() {
    this.mainWS = null;
    this.contractsWS = null;
    this.plWS = null;
    this.tickHistory = [];
    this.callbacks = new Map();
  }

  connect() {
    if (this.mainWS?.readyState === WebSocket.OPEN) return this.mainWS;
    
    return new Promise((resolve, reject) => {
      try {
        if (this.mainWS) this.mainWS.close();
        
        this.mainWS = new WebSocket(WS_URL);
        
        this.mainWS.onopen = () => {
          console.log("WS opened, authorizing...");
          this.mainWS.send(JSON.stringify({ authorize: TOKEN }));
        };
        
        this.mainWS.onmessage = (msg) => {
          try {
            const data = JSON.parse(msg.data);
            
            if (data.authorize) {
              console.log("Authorization successful");
              resolve(this.mainWS);
            } else if (data.tick) {
              this.callbacks.get('tick')?.forEach(cb => cb(data.tick));
            }
          } catch (e) {
            console.error("Message handling error:", e);
            reject(e);
          }
        };
        
        this.mainWS.onclose = () => {
          console.log("WS closed");
          reject(new Error("WebSocket closed"));
        };
        
        this.mainWS.onerror = (err) => {
          console.error("WS error:", err);
          reject(err);
        };
        
      } catch (err) {
        console.error("Connection setup failed:", err);
        reject(err);
      }
    });
  }

  subscribe(type, callback) {
    if (!this.callbacks.has(type)) {
      this.callbacks.set(type, new Set());
    }
    this.callbacks.get(type).add(callback);
  }

  unsubscribe(type, callback) {
    this.callbacks.get(type)?.delete(callback);
  }

  send(data) {
    if (this.mainWS?.readyState === WebSocket.OPEN) {
      this.mainWS.send(JSON.stringify(data));
    }
  }
}

// Global instances
const wsManager = new WSManager();

// Global state
let authorized = false;
let currentSymbol = null;
let automationRunning = false;
let isSubscribed = false;
let subscribeOnOpen = false;
let tickSubscriptionId = null;
let chartData = [];
let recentChanges = [];
let activeContractsMap = {};
let lastPrices = {};
let chart = null;
let areaSeries = null;
let smoothVol = 0;
let smoothTrend = 0;
let totalPL = 0;
let signal = null;
let Dispersion = 0;
let wsContractsAuthorized = false;
let plCallback = null;
let contractsPageSize = 10;
let contractsCurrentPage = 1;
let contractsSortMode = 'newest';

// Available trading symbols
const SYMBOLS = [
  { symbol: "BOOM1000", name: "Boom 1000" },
  { symbol: "CRASH1000", name: "Crash 1000" },
  { symbol: "BOOM500", name: "Boom 500" },
  { symbol: "CRASH500", name: "Crash 500" },
  { symbol: "BOOM900", name: "Boom 900" },
  { symbol: "CRASH900", name: "Crash 900" },
  { symbol: "BOOM600", name: "Boom 600" },
  { symbol: "CRASH600", name: "Crash 600" },
  { symbol: "R_100", name: "VIX 100" },
  { symbol: "R_75", name: "VIX 75" },
  { symbol: "R_50", name: "VIX 50" },
  { symbol: "R_25", name: "VIX 25" },
  { symbol: "R_10", name: "VIX 10" }
];

// Use utility functions from utils object
const fmt = utils.formatPrice;
const safe = v => (typeof v === "number" && !isNaN(v)) ? v : 0;

// Initialize UI and start application
document.addEventListener("DOMContentLoaded", async () => {
  console.log("Starting Unicorn Deriv Trader...");
  
  try {
    // Initialize UI components
    await initUI();
    
    // Set up resize handling
    window.addEventListener("resize", () => {
      try { 
        positionGauges();
        if (chart) chart.resize(chartInner.clientWidth, chartInner.clientHeight);
      } catch (e) {
        console.error("Resize error:", e); 
      }
    });

    // Initialize P/L tracking
    contractentry(totalPL => updatePLGauge(totalPL));
    
    console.log("Application initialized successfully");
  } catch (err) {
    console.error("Fatal error:", err);
    alert("Failed to start the application. Please refresh and try again.");
  }
    

  // Main WebSocket connection manager
  async function connectDeriv() {
    if (ws?.readyState === WebSocket.OPEN) {
      console.log("WebSocket already connected");
      return ws;
    }

    try {
      console.log("Establishing new WebSocket connection...");
      
      // Close existing if any
      if (ws) {
        try {
          ws.close();
        } catch (e) {
          console.warn("Error closing existing WebSocket:", e);
        }
      }

      // Create new connection
      ws = new WebSocket(WS_URL);

      ws.onopen = () => {
        console.log("WebSocket opened - sending authorize");
        try {
          ws.send(JSON.stringify({ authorize: TOKEN }));
        } catch (e) {
          console.error("Send authorize failed:", e);
        }
      };

      ws.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data);
          
          if (data.authorize) {
            console.log("Authorization successful");
            authorized = true;
            
            // If we have a pending symbol subscription, send it now
            if (pendingSubscribe) {
              console.log("Sending pending subscription for:", pendingSubscribe);
              ws.send(JSON.stringify({ ticks: pendingSubscribe }));
              pendingSubscribe = null;
            }
          } else if (data.tick) {
            handleTick(data.tick);
          }
        } catch (e) {
          console.error("Message handling error:", e);
        }
      };

      ws.onclose = () => {
        console.log("WebSocket closed");
        authorized = false;
      };

      ws.onerror = (error) => {
        console.error("WebSocket error:", error);
        authorized = false;
      };

      return ws;
    } catch (err) {
      console.error("Connection setup failed:", err);
      throw err;
    }
  }

  // UI
  const connectBtn = document.getElementById("connectBtn");
  const symbolList = document.getElementById("symbolList");
  const chartInner = document.getElementById("chartInner");
  const volGauge = document.getElementById("volGauge");
  const trendGauge = document.getElementById("trendGauge");
  const probGauge = document.getElementById("probGauge");
  const controlFormPanel = document.getElementById("controlFormPanel");
  const controlPanelToggle = document.getElementById("controlPanelToggle");
  const accountInfo = document.getElementById("accountInfo");
  const plGauge = document.getElementById("plGauge");
  const multiplierInput = document.getElementById("multiplierSelect");
  const buyBtn = document.getElementById("buyBtn"); 
  const sellBtn = document.getElementById("sellBtn"); 
  const stakeInput = document.getElementById("stakeInput");
  const takeProfitInput = document.getElementById("tpInput");
  const stopLossInput = document.getElementById("slInput");
  const closewinning = document.getElementById("closeWinning");
  const closeAll = document.getElementById("closeAll");
  const buyNum = document.getElementById("buyNumberInput");
  const sellNum = document.getElementById("sellNumberInput");
  const contractsPanelToggle = document.getElementById("contractsPanelToggle");
  const contractsPanel = document.getElementById("contractsPanel");
  const autoHistoryList = document.getElementById("autoHistoryList");
 
  let totalPL = 0; // cumul des profits et pertes
  let automationRunning = false;
  let smoothVol = 0;
  let smoothTrend = 0;
  let isSubscribed = false;
  let ws = null;
  let wsContracts = null; // WebSocket dédié aux contrats ouverts (évite d'écraser `ws`)
  let ws1 = null; // WebSocket pour P/L live
  let subscribeOnOpen = false;
  let wsContractsAuthorized = false;
  let wsPL = null; // WebSocket pour P/L (éviter d'ouvrir plusieurs connexions)
  let plCallback = null;
  const activeContractsMap = {}; // stockage des contrats reçus (id -> contract obj)
  // Pagination / tri pour l'affichage des contrats
  let contractsPageSize = 10;
  let contractsCurrentPage = 1;
  let contractsSortMode = 'newest'; // newest, oldest, profit_desc, profit_asc
  let chart = null;
  let areaSeries = null;
  let chartData = [];
  let lastPrices = {};
  let recentChanges = [];
  let signal;
  let signal__;
  let Dispersion;
  // Historique local des ticks
  let tickHistory = [];
  // Historique de profits
  let profitHistory = [];
  const contractsData = {}; // stockage des contrats {id: {profits: [], infos: {…}}}
  let contracts = {};
  let portfolioReceived = false;

  // --- NEW: current symbol & pending subscribe ---
  let currentSymbol = null;
  let pendingSubscribe = null;
  let authorized = false;

  // Use SYMBOLS from DerivConstants
  const { SYMBOLS } = window.DerivConstants;
  
  const fmt = utils.formatPrice;
  const safe = v => (typeof v === "number" && !isNaN(v)) ? v : 0;

  // --- SYMBOLS ---
  function displaySymbols() {
    if (!symbolList) return;
    symbolList.innerHTML = "";
    SYMBOLS.forEach(s => {
      const el = document.createElement("div");
      el.className = "symbol-item";
      el.textContent = s.name;
      el.dataset.symbol = s.symbol;
      el.addEventListener("click", () => {
        // Remove active class from all symbols
        document.querySelectorAll('.symbol-item').forEach(item => {
          item.classList.remove('active');
          item.style.background = '#eee';
          item.style.color = '#000';
        });
        // Add active class to clicked symbol
        el.classList.add('active');
        el.style.background = '#007bff';
        el.style.color = '#fff';
        subscribeSymbol(s.symbol);
      });
      symbolList.appendChild(el);
    });
  }

  // --- CHART INIT ---
  function initChart() {
    try { if (chart) chart.remove(); } catch (e) {}
    chartInner.innerHTML = "";

    chart = LightweightCharts.createChart(chartInner, {
      layout: { textColor: "#333", background: { type: "solid", color: "#fff" } },
      timeScale: { timeVisible: true, secondsVisible: true }
    });

    // use addAreaSeries (works with standalone bundle)
    areaSeries = chart.addAreaSeries({
      lineColor: "#2962FF",
      topColor: "rgba(41,98,255,0.28)",
      bottomColor: "rgba(41,98,255,0.05)",
      lineWidth: 2
    });

    chartData = [];
    recentChanges = [];
    lastPrices = {};

    positionGauges();
  }

  // --- GAUGES ---
  function positionGauges() {
    let gaugesContainer = document.getElementById("gaugesContainer");
    if (!gaugesContainer) {
      gaugesContainer = document.createElement("div");
      gaugesContainer.id = "gaugesContainer";
      gaugesContainer.style.position = "absolute";
      gaugesContainer.style.top = "10px";
      gaugesContainer.style.right = "10px";  // Changed from left to right
      gaugesContainer.style.display = "flex";
      gaugesContainer.style.gap = "20px";
      gaugesContainer.style.zIndex = "12";
      chartInner.style.position = "relative";
      chartInner.appendChild(gaugesContainer);

      appendGauge(gaugesContainer, volGauge, "Volatility");
      appendGauge(gaugesContainer, trendGauge, "Tendance");
      appendGauge(gaugesContainer, probGauge, "Probabilité");
      appendGauge(gaugesContainer, plGauge, "P/L Live");
    }
  }

  function appendGauge(container, gaugeDiv, labelText) {
    const wrapper = document.createElement("div");
    wrapper.style.display = "flex";
    wrapper.style.flexDirection = "column";
    wrapper.style.alignItems = "center";
    wrapper.style.width = "140px";
    wrapper.style.pointerEvents = "none";

    const content = document.createElement("div");
    content.style.width = "100%";
    content.appendChild(gaugeDiv);
    wrapper.appendChild(content);
      console.log("updateContractsTable called with:", contracts);
      try { appendContractsDebug("updateContractsTable called with: " + (Array.isArray(contracts) ? contracts.length + ' items' : JSON.stringify(contracts).slice(0,200))); } catch (e) {}

      // Ensure table exists
      if (!document.getElementById('autoTradeTable')) initTable();
      const tbodyEl = document.getElementById("autoTradeBody");
      if (!tbodyEl) return;

      // If no contracts, clear table
      if (!contracts || contracts.length === 0) {
        tbodyEl.innerHTML = `<tr><td colspan="11" style="color:#94a3b8;">No active contracts</td></tr>`;
        return;
      }

      // helper functions
      const safeNumber = (v, fixed = 2) => {
        const n = Number(v);
        return (isFinite(n) ? n : 0).toFixed(fixed);
      };
      const safeText = v => (v === null || v === undefined) ? "-" : String(v);

      // Track incoming contract ids to remove stale rows later
      const incomingIds = new Set();

      contracts.forEach(pos => {
        try {
          // derive id and fields (robust to multiple server formats)
          const purchaseEpoch = Number(pos.purchase_time || pos.purchase_epoch || pos.date_start || pos.date || 0);
          const timeStr = purchaseEpoch ? new Date(purchaseEpoch * 1000).toLocaleTimeString() : "-";

          const contractIdRaw = pos.contract_id ?? pos.id ?? pos.contractId ?? "";
          const cid = String(contractIdRaw);
          incomingIds.add(cid);

          const contractTypeRaw = safeText(pos.contract_type || pos.contract_type_display || pos.display_name || "N/A");
          const isBuy = /CALL|BUY|UP|MULTUP/i.test(contractTypeRaw);
          const buyOrSellClass = isBuy ? "buy" : "sell";

          const buyPriceRaw = pos.buy_price ?? pos.purchase_price ?? pos.stake ?? pos.price ?? pos.buyPrice ?? 0;
          const buyPrice = safeNumber(buyPriceRaw || 0);

          const multiplier = safeText(pos.multiplier ?? pos.contract_multiplier ?? pos.multiplier_value ?? "-");

          const entryRaw = pos.entry_tick_display_value ?? pos.entry_spot_display_value ?? pos.entry_tick ?? pos.entry_spot ?? pos.entry_price ?? null;
          const entryTick = (entryRaw !== null && entryRaw !== undefined && entryRaw !== "") ? (typeof entryRaw === 'number' ? Number(entryRaw).toFixed(3) : safeText(entryRaw)) : "-";

          const tp = safeText(pos.take_profit ?? pos.tp ?? pos.takeProfit ?? "-");
          const sl = safeText(pos.stop_loss ?? pos.sl ?? pos.stopLoss ?? "-");

          let profitNum = parseFloat(pos.profit ?? pos.profit_value ?? pos.current_spot_profit ?? pos.current_profit);
          if (!isFinite(profitNum) && pos.profit_percentage) {
            const pct = parseFloat(pos.profit_percentage);
            const stake = parseFloat(pos.stake ?? buyPriceRaw ?? NaN);
            if (isFinite(pct) && isFinite(stake)) profitNum = (pct / 100) * stake;
          }
          if (!isFinite(profitNum)) {
            const payout = parseFloat(pos.payout ?? pos.profit_payout ?? NaN);
            const buy = parseFloat(buyPriceRaw || NaN);
            if (isFinite(payout) && isFinite(buy)) profitNum = payout - buy;
          }
          if (!isFinite(profitNum)) profitNum = 0;
          const profit = profitNum.toFixed(2);
          const profitClass = profitNum >= 0 ? "profit-positive" : "profit-negative";

          // Try to find existing row
          let tr = tbodyEl.querySelector(`tr[data-contract-id="${cid}"]`);
          const prevChecked = tr ? (tr.querySelector('.rowSelect')?.checked || false) : false;
          if (!tr) {
            tr = document.createElement('tr');
            tr.setAttribute('data-contract-id', cid);
            tbodyEl.appendChild(tr);
          }

          tr.innerHTML = `
            <td><input type="checkbox" class="rowSelect"></td>
            <td>${timeStr}</td>
            <td>${safeText(cid)}</td>
            <td class="${buyOrSellClass}">${contractTypeRaw}</td>
            <td>${buyPrice}</td>
            <td>${multiplier}</td>
            <td>${entryTick}</td>
            <td>${tp}</td>
            <td>${sl}</td>
            <td class="${profitClass}">${profit}</td>
            <td><button class="closeRowBtn" data-contract-id="${safeText(cid)}" style="background:#ef4444; border:none; color:white; border-radius:4px; padding:4px 8px; cursor:pointer;">Close</button></td>
          `;

          // restore checkbox state
          const cb = tr.querySelector('.rowSelect');
          if (cb) cb.checked = !!prevChecked;

        } catch (err) {
          console.error("Failed to render contract row", err, pos);
          try { appendContractsDebug('Failed to render contract row: ' + err.message); } catch (e) {}
        }
      });

      // Remove any rows that are no longer present
      tbodyEl.querySelectorAll('tr[data-contract-id]').forEach(r => {
        const id = r.getAttribute('data-contract-id');
        if (!incomingIds.has(id)) r.remove();
      });

    ws.onerror = (e) => {
      console.error("WS error", e);
    };
  }

  function startAutomation(ws) {
    console.log("Connecting...");

    if (currentSymbol === null) {
      console.log("Please select a symbol first.");
      return;
    }

    ws.onopen = () => {
      console.log("✅ Connecté au WebSocket Deriv");
      ws.send(JSON.stringify({ authorize: TOKEN }));
    };

    ws.onmessage = (msg) => {
      const data = JSON.parse(msg.data);

      // Autorisation réussie → abonnement aux ticks
      if (data.authorize) {
         console.log("🔑 Autorisé, abonnement aux ticks...");
         ws.send(JSON.stringify({ ticks: currentSymbol, subscribe: 1 }));
      }

      // Sauvegarder l'ID d'abonnement
      if (data.subscription && data.subscription.id) {
         tickSubscriptionId = data.subscription.id;
         console.log("🆔 ID abonnement:", tickSubscriptionId);
      }

      // Quand un tick arrive
      if (data.tick) {
         const price = parseFloat(data.tick.quote);
         const time = new Date(data.tick.epoch * 1000).toLocaleTimeString();

         tickHistory.push(price);
         if (tickHistory.length > 3) tickHistory.shift(); // garder seulement les 3 derniers ticks

         //console.clear();
         //console.log(`🕒 Tick reçu à ${time} | Prix : ${price}`);

         if (tickHistory.length === 3) {
            // Calcul sur le vecteur des 3 derniers ticks
            const [p1, p2, p3] = tickHistory;

           // Exemple de "variation moyenne" locale
           const variation = (p3 - p1) / 3; 
           
           // On peut aussi normaliser avec la moyenne
           const mean = (p1 + p2 + p3) / 3;
           Dispersion = utils.ecartType(tickHistory);
           if (Dispersion !==0)
           {
            const delta = (p3 - mean) / Dispersion; // variation relative
            // Application de la sigmoïde
            signal = utils.sigmoid(delta); // delta*10 ou 10 = facteur de sensibilité

            //console.log(`📊 Derniers ticks : ${tickHistory.map(x => x.toFixed(3)).join(", ")}`);
            //console.log(`⚙️ Variation moyenne : ${variation.toFixed(6)}`);
            console.log(`📈 Sigmoid : ${signal.toFixed(6)}`);
           }
         }
      }
    };

    ws.onclose = () => {
      console.log("Disconnected");
    };

    ws.onerror = (err) => {
      console.error("WebSocket error:", err);
    };
  }

  function stopAutomation(ws) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      if (tickSubscriptionId) {
        // Désabonnement propre
        ws.send(JSON.stringify({ forget: tickSubscriptionId }));
        console.log("🚫 Tick désabonné :", tickSubscriptionId);
        tickSubscriptionId = null;
      } else {
        console.log("⚠️ Aucun abonnement trouvé à oublier");
      }

      // Attendre un court délai avant fermeture
      setTimeout(() => {
        ws.close();
        console.log("🔒 Connexion fermée proprement");
      }, 2000);
    }
  }

  // --- SUBSCRIBE SYMBOL ---
  function subscribeSymbol(symbol) {
    // set desired symbol and reinit chart immediately
    currentSymbol = symbol;
    initChart(); // reinit chart so areaSeries exists before ticks arrive

    // if WS not ready, set pendingSubscribe and open connection
    if (!ws || ws.readyState !== WebSocket.OPEN || !authorized) {
      pendingSubscribe = symbol;
      if (!ws || ws.readyState === WebSocket.CLOSED) {
        connectDeriv();
      }
      // we'll actually send subscription after authorize in ws.onmessage
      return;
    }

    // WS open and authorized -> subscribe now
    try {
      ws.send(JSON.stringify({ forget_all: "ticks" }));
      ws.send(JSON.stringify({ ticks: symbol }));
    } catch (e) {
      // fallback: queue for after authorize
      pendingSubscribe = symbol;
      console.warn("Failed to send subscribe immediately, queued", e);
    }
  }

  // --- TICK HANDLER ---
  function handleTick(tick) {
    // ensure tick belongs to current symbol (or accept if no currentSymbol)
    if (!tick || !tick.symbol) return;
    if (currentSymbol && tick.symbol !== currentSymbol) return;

    const quote = safe(Number(tick.quote));
    // Deriv epoch is seconds; lightweight-charts accepts number seconds
    const epoch = Number(tick.epoch) || Math.floor(Date.now() / 1000);

    // update lastPrices per symbol key (keep generic)
    const prev = lastPrices[tick.symbol] ?? quote;
    lastPrices[tick.symbol] = quote;

    const change = quote - prev;
    recentChanges.push(change);
    if (recentChanges.length > 60) recentChanges.shift();

    updateCircularGauges();

    // update chartData and series
    if (!areaSeries || !chart) return;

    const point = { time: epoch, value: quote };

    // if first data point, setData with small array to initialize
    if (!chartData.length) {
      chartData.push(point);
      try {
        areaSeries.setData(chartData);
      } catch (e) {
        // fallback: try update
        try { areaSeries.update(point); } catch (err) {}
      }
    } else {
      // append and update
      chartData.push(point);
      if (chartData.length > 600) chartData.shift();

      // Prefer update (faster); fallback to setData if update throws
      try {
        areaSeries.update(point);
      } catch (e) {
        try { areaSeries.setData(chartData); } catch (err) {}
      }
    }

    // try to auto-fit time scale (safe)
    try { chart.timeScale().fitContent(); } catch (e) {}
  }

  // --- GAUGES UPDATE ---
  function updateCircularGauges() {
    if (!recentChanges.length) return;
    const mean = recentChanges.reduce((a, b) => a + b, 0) / recentChanges.length;
    const variance = recentChanges.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / recentChanges.length;
    const stdDev = Math.sqrt(variance);
    const volProb = Math.min(100, (stdDev / 0.07) * 100);

    const sum = recentChanges.reduce((a, b) => a + b, 0);
    const trendRaw = Math.min(100, Math.abs(sum) * 1000);

    const pos = recentChanges.filter(v => v > 0).length;
    const neg = recentChanges.filter(v => v < 0).length;
    const dominant = Math.max(pos, neg);
    const prob = recentChanges.length ? Math.round((dominant / recentChanges.length) * 100) : 50;

    const alpha = 0.25; // smoother
    smoothVol = smoothVol === 0 ? volProb : smoothVol + alpha * (volProb - smoothVol);
    smoothTrend = smoothTrend === 0 ? trendRaw : smoothTrend + alpha * (trendRaw - smoothTrend);

    drawCircularGauge(volGauge, smoothVol, "#ff9800");
    drawCircularGauge(trendGauge, smoothTrend, "#2962FF");
    drawCircularGauge(probGauge, prob, "#4caf50");
    
  }

  // --- DRAW GAUGE ---
  function drawCircularGauge(container, value, color) {
    const size = 110;
    container.style.width = size + "px";
    container.style.height = (size + 28) + "px";

    let canvas = container.querySelector("canvas");
    let pct = container.querySelector(".gauge-percent");
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.width = canvas.height = size;
      canvas.style.display = "block";
      canvas.style.margin = "0 auto";
      canvas.style.pointerEvents = "none";
      container.innerHTML = "";
      container.appendChild(canvas);

      pct = document.createElement("div");
      pct.className = "gauge-percent";
      pct.style.textAlign = "center";
      pct.style.marginTop = "-92px";
      pct.style.fontSize = "16px";
      pct.style.fontWeight = "700";
      pct.style.color = "#222";
      pct.style.pointerEvents = "none";
      container.appendChild(pct);
    }

    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, size, size);
    const center = size / 2;
    const radius = size / 2 - 8;
    const start = -Math.PI / 2;
    const end = start + (Math.min(value, 100) / 100) * 2 * Math.PI;

    ctx.beginPath();
    ctx.arc(center, center, radius, 0, 2 * Math.PI);
    ctx.strokeStyle = "#eee";
    ctx.lineWidth = 8;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(center, center, radius, start, end);
    ctx.strokeStyle = color;
    ctx.lineWidth = 8;
    ctx.lineCap = "round";
    ctx.stroke();

    pct.textContent = `${Math.round(value)}%`;
  }

  function updatePLGauge(plValue) {
    // On garde une moyenne lissée
    totalPL = plValue;   

    // Couleur dynamique : vert si positif, rouge si négatif
    const color = totalPL >= 0 ? "#4caf50" : "#f44336";
    const deg = Math.min(360, Math.abs(totalPL) * 3.6); // 100 = 360°
    
    plGauge.style.background = `conic-gradient(${color} ${deg}deg, #ddd ${deg}deg)`;
    plGauge.querySelector("span").textContent = `${totalPL >= 0 ? "+" : ""}${totalPL.toFixed(2)}$`;
  }

  // === P/L LIVE FUNCTION ===
  // contractentry: initialise une seule WebSocket pour suivre le P/L des contrats ouverts
  function contractentry(onUpdate) {
    // si déjà initialisé, on attache simplement le callback et on retourne
    if (wsPL && wsPL.readyState !== WebSocket.CLOSED) {
      if (typeof onUpdate === "function") plCallback = onUpdate;
      return wsPL;
    }

    if (!TOKEN) {
      console.log("Please, verify your token, and try again.");
      return null;
    }

    plCallback = typeof onUpdate === "function" ? onUpdate : null;
    wsPL = new WebSocket(WS_URL);

    const contractsMap = {};

    wsPL.onopen = () => {
      console.log("✅ wsPL connected — requesting authorize");
      try { wsPL.send(JSON.stringify({ authorize: TOKEN })); } catch (e) { console.error(e); }
    };

    wsPL.onmessage = (msg) => {
      let data;
      try { data = JSON.parse(msg.data); } catch (err) { console.warn("wsPL parse err", err); return; }

      try { appendContractsDebug(JSON.stringify(data)); } catch (e) {}

      // autorisation → demande portfolio
      if (data.msg_type === "authorize" && data.authorize) {
        console.log("wsPL authorized, requesting portfolio");
        try { wsPL.send(JSON.stringify({ portfolio: 1 })); } catch (e) { console.error(e); }
        return;
      }

      // portfolio with list of contracts
      if (data.msg_type === "portfolio" && data.portfolio) {
        const list = data.portfolio.contracts || [];
        console.log("wsPL portfolio contracts:", list.length, list);
        for (const c of list) {
          console.log("contract details:", c);
          contractsMap[c.contract_id] = 0;
          // stocke aussi dans activeContractsMap pour le tableau
          try { if (c && c.contract_id) activeContractsMap[c.contract_id] = c; } catch (e) {}
          try {
            wsPL.send(JSON.stringify({ proposal_open_contract: 1, contract_id: c.contract_id, subscribe: 1 }));
          } catch (e) { console.error(e); }
        }
        // re-render après avoir stocké les contrats
        renderActiveContracts();
        if (plCallback) plCallback(Object.values(contractsMap).reduce((a,b)=>a+b,0));
        return;
      }

      // direct proposal_open_contract updates
      if (data.msg_type === "proposal_open_contract" && data.proposal_open_contract) {
        const poc = data.proposal_open_contract;
        console.log("Received proposal_open_contract:", poc);
        
        if (poc.is_expired || poc.is_sold) {
          delete contractsMap[poc.contract_id];
          try { delete activeContractsMap[poc.contract_id]; } catch (e) {}
        } else {
          contractsMap[poc.contract_id] = Number(poc.profit) || 0;
          // Update activeContractsMap with live data
          if (activeContractsMap[poc.contract_id]) {
            activeContractsMap[poc.contract_id] = {
              ...activeContractsMap[poc.contract_id],
              profit: poc.profit,
              entry_tick: poc.entry_tick || poc.entry_spot,
              current_spot: poc.current_spot
            };
          }
        }

        const total = Object.values(contractsMap).reduce((a, b) => a + (Number(b) || 0), 0);
        if (plCallback) plCallback(total);
        return;
      }
    };

    wsPL.onerror = (err) => console.error("wsPL error", err);
    wsPL.onclose = () => console.log("wsPL closed");

    return wsPL;
  }


  // Use sigmoid from utils
  const sigmoid = utils.sigmoid;

  /*function ActivePositions(ws, symbol){

    ws.onopen = () => {
      console.log("✅ Connecté au WebSocket Deriv");
      ws.send(JSON.stringify({ authorize: TOKEN }));
    };

    ws.onmessage = (msg) => {
      const data = JSON.parse(msg.data);

      // Autorisation réussie → abonnement aux ticks
      if (data.authorize) {
         console.log("🔑 Autorisé, abonnement aux ticks...");
         ws.send(JSON.stringify({ ticks: symbol, subscribe: 1 }));
      }

      // Quand un tick arrive
      if (data.tick) {
         const price = parseFloat(data.tick.quote);
         const time = new Date(data.tick.epoch * 1000).toLocaleTimeString();

         tickHistory.push(price);
         if (tickHistory.length > 3) tickHistory.shift(); // garder seulement les 3 derniers ticks

         console.clear();
         console.log(`🕒 Tick reçu à ${time} | Prix : ${price}`);

         if (tickHistory.length === 3) {
            // Calcul sur le vecteur des 3 derniers ticks
            const [p1, p2, p3] = tickHistory;

           // Exemple de "variation moyenne" locale
           const variation = (p3 - p1) / 3; 
           
           // On peut aussi normaliser avec la moyenne
           const mean = (p1 + p2 + p3) / 3;
           Dispersion = ecartType(tickHistory);
           console.log("Dispersion : " + Dispersion);
           if (Dispersion !==0)
           {
            const delta = (p3 - mean) / Dispersion; // variation relative
            // Application de la sigmoïde
            signal = sigmoid(delta); // delta*10 ou 10 = facteur de sensibilité

            console.log(`📊 Derniers ticks : ${tickHistory.map(x => x.toFixed(3)).join(", ")}`);
            console.log(`⚙️ Variation moyenne : ${variation.toFixed(6)}`);
            console.log(`📈 Sigmoid : ${signal.toFixed(6)}`);
           }
          else
           {
             signal = null;
           }
         }
      }
    };

    return signal;
  } */

  // Fonction pour calculer l’écart-type (population)
  // Use ecartType from utils

  // Initialisation
  function initPLGauge() {
    const gauge__ = document.getElementById("plGauge");
    if (!gauge__) return;
    updatePLGauge(0);
  }

  buyBtn.onclick=()=>executeTrade("BUY");
  sellBtn.onclick=()=>executeTrade("SELL");

  //--- Trades (New)
  function executeTrade(type){
    const stake=parseFloat(stakeInput.value)||1;
    const multiplier=parseInt(multiplierInput.value)||300;

    if(authorized && ws && ws.readyState===WebSocket.OPEN){
       const payload = {
        buy: 1,
        price: stake.toFixed(2),
        parameters: {
          contract_type: type==="BUY"?"MULTUP":"MULTDOWN",
          symbol: currentSymbol,
          currency: "USD",
          basis: "stake",
          amount: stake.toFixed(2),
          multiplier: multiplier,
          //limit_order: { stop_loss: slInitial, take_profit: tpInitial }
        }
      };

      if (type === "BUY")
       {
        numb_ = parseInt(buyNum.value)||1;
       }
      else if (type === "SELL")
       {
        numb_ = parseInt(sellNum.value)||1;
       }

      for (let i=0;i < numb_; i++)
       {
         ws.send(JSON.stringify(payload));
       }
    }
  }

  closewinning.onclick=()=>{

    console.log("Closing all profitable trades...");

    const ws = new WebSocket(WS_URL);
    
    ws.onopen = () => {
      ws.send(JSON.stringify({ authorize: TOKEN }));
    };

    ws.onerror = (e) => {
      console.log("❌ WS Error: " + JSON.stringify(e));
    };

    ws.onmessage = (msg) => {
       const data = JSON.parse(msg.data);

      // Authorization successful
      if (data.msg_type === "authorize") {
         console.log("✅ Authorized successfully. Fetching portfolio...");
         ws.send(JSON.stringify({ portfolio: 1 }));
      }

      // Portfolio received
      if (data.msg_type === "portfolio" && data.portfolio?.contracts?.length > 0) {
         const contracts = data.portfolio.contracts;
         console.log("📊 Found " + contracts.length + " active contracts.");

         contracts.forEach((contract,i) => {
         setTimeout(() => {
            ws.send(
              JSON.stringify({
                 proposal_open_contract: 1,
                 contract_id: contract.contract_id,
              })
            );
          }, i * 200); // Délai de 500ms entre chaque demande
      });
    }

    // Proposal open contract (detail for each active trade)
    if (data.msg_type === "proposal_open_contract" && data.proposal_open_contract) {
      const poc = data.proposal_open_contract;
      const profit = parseFloat(poc.profit);

      if (profit > 0) {
        console.log(
          `💰 Closing profitable trade ${poc.contract_id} with profit ${profit.toFixed(2)}`
        );

        ws.send(
          JSON.stringify({
            sell: poc.contract_id,
            price: 0, // 0 = sell at market price
          })
        );
      }
    }

    // Sell confirmation
    if (data.msg_type === "sell") {
      const profit = parseFloat(data.sell.profit);
      console.log(`✅ Trade ${data.sell.contract_id} closed with profit: ${profit.toFixed(2)}`);
    }

    // No open contracts
    if (data.msg_type === "portfolio" && (!data.portfolio || !data.portfolio.contracts.length)) {
      console.log("⚠️ No active contracts found.");
    }
   };
 };

closeAll.onclick=()=>{
  
    ws = new WebSocket(WS_URL);
    
    ws.onopen=()=>{ ws.send(JSON.stringify({ authorize: TOKEN })); };
    ws.onclose=()=>{ console.log("Disconnected"); console.log("WS closed"); };
    ws.onerror=e=>{ console.log("WS error "+JSON.stringify(e)); };
    ws.onmessage=msg=>{
    const data=JSON.parse(msg.data);
    if(data.msg_type==="authorize")
     {
        if(!data.authorize?.loginid){ console.log("Token not authorized"); return; }
        authorized=true; 
        console.log("connection Authorized.");

        if(authorized && ws && ws.readyState===WebSocket.OPEN)
        {
           const portfoliopayload = { portfolio : 1};
           console.log('The request is open...');
           console.log('Request in process...');   

           ws.send(JSON.stringify(portfoliopayload));
       
           ws.onmessage = msg => {
           const data = JSON.parse(msg.data);
           if (data.msg_type === "portfolio" && data.portfolio?.contracts?.length > 0)
            {
             const contracts = data.portfolio.contracts;
             console.log('Found '+ contracts.length + ' active contracts - close all...');   
             for (const contract of contracts)
              {
               console.log('Closing contract '+ contract.contract_id + '(' + contract.contract_type + ')');
               ws.send(JSON.stringify({
                 "sell": contract.contract_id,
                 "price": 0
               }));
             }
            }
            
            if (contracts.length === 0)
            {
              console.log('No active contracts found.');
            }
          };
        } 
      }
    };
  }; 

  // === TABLEAU HTML ===
function initTable() {
  const autoHistoryList = document.getElementById("autoHistoryList");
  autoHistoryList.innerHTML = `
    <table class="trade-table" id="autoTradeTable">
      <thead>
        <tr>
          <th><input type="checkbox" id="selectAll"></th>
          <th>Time of Trade</th>
          <th>Contract ID</th>
          <th>Contract Type</th>
          <th>Stake</th>
          <th>Multiplier</th>
          <th>Entry Spot</th>
          <th>TP (%)</th>
          <th>SL (%)</th>
          <th>Profit</th>
          <th>Action</th>
        </tr>
      </thead>
      <tbody id="autoTradeBody"></tbody>
    </table>
  `;
}

// Affiche un message visible en haut du panneau des contrats
function setContractsPanelMessage(msg, level = "info") {
  const panel = document.getElementById("contractsPanel");
  if (!panel) return;

  let el = document.getElementById("contractsPanelMessage");
  if (!el) {
    el = document.createElement("div");
    el.id = "contractsPanelMessage";
    el.style.width = "100%";
    el.style.boxSizing = "border-box";
    el.style.padding = "8px 12px";
    el.style.borderRadius = "6px";
    el.style.marginBottom = "8px";
    el.style.fontWeight = "600";
    panel.insertBefore(el, panel.firstChild);
  }

  el.textContent = msg;
  if (level === "error") {
    el.style.background = "#fee2e2";
    el.style.color = "#991b1b";
    el.style.border = "1px solid #fecaca";
  } else if (level === "warn") {
    el.style.background = "#fff7ed";
    el.style.color = "#92400e";
    el.style.border = "1px solid #fcd34d";
  } else {
    el.style.background = "#ecfeff";
    el.style.color = "#0f766e";
    el.style.border = "1px solid #a7f3d0";
  }
}

// Append text to visible debug log inside contracts panel (keeps a limited number of lines)
function appendContractsDebug(text) {
  try {
    const el = document.getElementById("contractsDebugLog");
    if (!el) return;
    const now = new Date().toLocaleTimeString();
    // keep last 2000 chars
    el.textContent = `${now} — ${text}\n` + el.textContent;
    // trim to reasonable size
    if (el.textContent.length > 20000) el.textContent = el.textContent.slice(0, 20000);
  } catch (e) {
    console.debug("appendContractsDebug failed", e);
  }
}

// === METTRE À JOUR LE TABLEAU ===
function updateContractsTable(contracts) {
  console.log("updateContractsTable called with:", contracts);
  try { appendContractsDebug("updateContractsTable called with: " + (Array.isArray(contracts) ? contracts.length + ' items' : JSON.stringify(contracts).slice(0,200))); } catch (e) {}
  const tbody = document.getElementById("autoTradeBody");
  if (!tbody) {
    // si le tableau n'existe pas (panneau fermé), initialise-le pour afficher les données
    console.log("autoTradeBody not found, initializing table now");
    try { initTable(); } catch (e) { console.warn(e); }
  }

  const tbody2 = document.getElementById("autoTradeBody");
  if (!tbody2) {
    console.warn("updateContractsTable: tbody still not found");
    try { appendContractsDebug('updateContractsTable: tbody not found'); } catch (e) {}
    return;
  }
  const tbodyEl = tbody2;

  // clear
  tbodyEl.innerHTML = "";

  if (!contracts || contracts.length === 0) {
    tbody.innerHTML = `<tr><td colspan="11" style="color:#94a3b8;">No active contracts</td></tr>`;
    return;
  }

  // Use utility functions from utils
  const { safeNumber, safeText } = utils;

  contracts.forEach(pos => {
    try {
      const tr = document.createElement("tr");

      // normalize common fields from active_positions format
      // purchase time (several possible field names)
      const purchaseEpoch = Number(pos.purchase_time || pos.purchase_epoch || pos.date_start || pos.date || 0);
      const timeStr = purchaseEpoch ? new Date(purchaseEpoch * 1000).toLocaleTimeString() : "-";

      // contract id may be under contract_id or id
      const contractIdRaw = pos.contract_id ?? pos.id ?? pos.contractId ?? "-";
      const contractId = safeText(contractIdRaw);

      const contractTypeRaw = safeText(pos.contract_type || pos.contract_type_display || pos.display_name || "N/A");
      const isBuy = /CALL|BUY|UP|MULTUP/i.test(contractTypeRaw);
      const buyOrSellClass = isBuy ? "buy" : "sell";

      // buy price: try several possible field names (stake/buy_price)
      const buyPriceRaw = pos.buy_price ?? pos.purchase_price ?? pos.stake ?? pos.price ?? pos.buyPrice ?? 0;
      const buyPrice = safeNumber(buyPriceRaw || 0);

      const multiplier = safeText(pos.multiplier ?? pos.contract_multiplier ?? pos.multiplier_value ?? "-");

      // entry spot: prefer display fields when present
      const entryRaw = pos.entry_tick_display_value ?? pos.entry_spot_display_value ?? pos.entry_tick ?? pos.entry_spot ?? pos.entry_price ?? null;
      const entryTick = (entryRaw !== null && entryRaw !== undefined && entryRaw !== "") ? (typeof entryRaw === 'number' ? Number(entryRaw).toFixed(3) : safeText(entryRaw)) : "-";

      const tp = safeText(pos.take_profit ?? pos.tp ?? pos.takeProfit ?? "-");
      const sl = safeText(pos.stop_loss ?? pos.sl ?? pos.stopLoss ?? "-");

      // profit: direct field preferred, then profit_percentage, then compute from payout-buy_price
      let profitNum = parseFloat(pos.profit ?? pos.profit_value ?? pos.current_spot_profit ?? pos.current_profit);
      if (!isFinite(profitNum) && pos.profit_percentage) {
        // if profit_percentage given and buy_price exists, compute accordingly (assuming percentage of stake)
        const pct = parseFloat(pos.profit_percentage);
        const stake = parseFloat(pos.stake ?? buyPriceRaw ?? NaN);
        if (isFinite(pct) && isFinite(stake)) profitNum = (pct / 100) * stake;
      }
      if (!isFinite(profitNum)) {
        const payout = parseFloat(pos.payout ?? pos.profit_payout ?? NaN);
        const buy = parseFloat(buyPriceRaw || NaN);
        if (isFinite(payout) && isFinite(buy)) profitNum = payout - buy;
      }
      if (!isFinite(profitNum)) profitNum = 0;
      const profit = profitNum.toFixed(2);
      const profitClass = profitNum >= 0 ? "profit-positive" : "profit-negative";

      tr.innerHTML = `
      <td><input type="checkbox" class="rowSelect"></td>
      <td>${timeStr}</td>
      <td>${contractId}</td>
      <td class="${buyOrSellClass}">${contractTypeRaw}</td>
      <td>${buyPrice}</td>
      <td>${multiplier}</td>
      <td>${entryTick}</td>
      <td>${tp}</td>
      <td>${sl}</td>
      <td class="${profitClass}">${profit}</td>
      <td><button class="closeRowBtn" data-contract-id="${contractId}" style="background:#ef4444; border:none; color:white; border-radius:4px; padding:4px 8px; cursor:pointer;">Close</button></td>
    `;

      tbodyEl.appendChild(tr);
    } catch (err) {
      console.error("Failed to render contract row", err, pos);
      try { appendContractsDebug('Failed to render contract row: ' + err.message); } catch (e) {}
    }
  });
}

// Render current activeContractsMap into the table
function renderActiveContracts() {
  console.log("renderActiveContracts - activeContractsMap:", activeContractsMap);
  const arr = Object.keys(activeContractsMap).map(k => activeContractsMap[k]);
  console.log("Contracts array for render:", arr);
  // choose sort mode
  if (contractsSortMode === 'newest') {
    arr.sort((a,b) => Number(b.purchase_time||b.date_start||b.date||0) - Number(a.purchase_time||a.date_start||a.date||0));
  } else if (contractsSortMode === 'oldest') {
    arr.sort((a,b) => Number(a.purchase_time||a.date_start||a.date||0) - Number(b.purchase_time||b.date_start||b.date||0));
  } else if (contractsSortMode === 'profit_desc') {
    arr.sort((a,b) => (Number(b.profit||b.current_profit||b.current_spot_profit||0) - Number(a.profit||a.current_profit||a.current_spot_profit||0)));
  } else if (contractsSortMode === 'profit_asc') {
    arr.sort((a,b) => (Number(a.profit||a.current_profit||a.current_spot_profit||0) - Number(b.profit||b.current_profit||b.current_spot_profit||0)));
  }

  // pagination
  const totalItems = arr.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / contractsPageSize));
  if (contractsCurrentPage > totalPages) contractsCurrentPage = totalPages;
  const start = (contractsCurrentPage - 1) * contractsPageSize;
  const slice = arr.slice(start, start + contractsPageSize);

  // render
  updateContractsTable(slice);

  // update pagination UI
  renderContractsPagination(totalItems, totalPages);
}

function renderContractsPagination(totalItems, totalPages) {
  try {
    const pageInfo = document.getElementById('contractsPageInfo');
    const prevBtn = document.getElementById('contractsPrevBtn');
    const nextBtn = document.getElementById('contractsNextBtn');
    if (pageInfo) pageInfo.textContent = `Page ${contractsCurrentPage} / ${totalPages} (${totalItems} items)`;
    if (prevBtn) prevBtn.disabled = contractsCurrentPage <= 1;
    if (nextBtn) nextBtn.disabled = contractsCurrentPage >= totalPages;
  } catch (e) { console.debug('renderContractsPagination err', e); }
}

// === CONNEXION WEBSOCKET ===
function connectWS() {
  // Utilise une socket dédiée pour les contrats ouverts
  // Si une socket existe déjà et n'est pas CLOSED, la réutiliser (évite multiplications)
  if (wsContracts && wsContracts.readyState !== WebSocket.CLOSED) return wsContracts;

  wsContracts = new WebSocket(WS_URL);
  const socket = wsContracts; // capture local reference to avoid races when wsContracts is reassigned

  socket.onopen = () => {
    console.log("✅ Connecté à Deriv (wsContracts)");
    // demander l'autorisation
    try { socket.send(JSON.stringify({ authorize: TOKEN })); } catch (e) { console.error('wsContracts send onopen failed', e); }
  };

  socket.onmessage = (event) => {
    let data;
    try {
      data = JSON.parse(event.data);
    } catch (err) {
      console.warn("Failed to parse wsContracts message:", event.data);
      return;
    }

  console.debug("wsContracts message:", data);
  try { appendContractsDebug(JSON.stringify(data)); } catch (e) {}

    if (data.msg_type === "authorize") {
      // Si le panneau est ouvert, on s'abonne automatiquement
      if (data.authorize) {
        console.log("wsContracts authorized", data.authorize.loginid);
        wsContractsAuthorized = true;
        setContractsPanelMessage(`Authorized: ${data.authorize.loginid}`, "info");
        // soit on a demandé explicitement l'abonnement, soit on a mis en file d'attente
        if (isSubscribed || subscribeOnOpen) {
          subscribeOnOpen = false;
          subscribeActivePositions();
        }
      }
    } else if (data.msg_type === "active_positions") {
      const contracts = data.active_positions?.contracts || [];
      console.log("📦 Contrats reçus (wsContracts):", contracts);
      console.log("Message complet:", data);
      // store into map and render
      if (contracts.length === 0 && data.active_positions?.positions) {
        // adapté au format alternatif: positions array directement
        console.log("Format alternatif détecté - positions:", data.active_positions.positions);
        data.active_positions.positions.forEach(c => {
          if (c && c.contract_id) {
            const existing = activeContractsMap[c.contract_id] || {};
            activeContractsMap[c.contract_id] = { ...existing, ...c };
          }
        });
      } else {
        // format original: contracts array
        contracts.forEach(c => {
          if (c && c.contract_id) {
            const existing = activeContractsMap[c.contract_id] || {};
            activeContractsMap[c.contract_id] = { ...existing, ...c };
          }
        });
      console.log("État actuel activeContractsMap:", activeContractsMap);
      renderActiveContracts();
    }
    
    if (!contracts || contracts.length === 0) {
      setContractsPanelMessage("No active contracts", "warn");
    } else {
      setContractsPanelMessage(`Found ${contracts.length} active contract(s)`, "info");
    }
    } else if (data.msg_type === "portfolio" && data.portfolio) {
      // some endpoints return 'portfolio' with .contracts
      const contracts = data.portfolio.contracts || [];
      console.log("📦 Portfolio received (wsContracts):", contracts);
      contracts.forEach(c => { if (c && c.contract_id) activeContractsMap[c.contract_id] = c; });
      renderActiveContracts();
      if (!contracts || contracts.length === 0) setContractsPanelMessage("No active contracts", "warn");
      else setContractsPanelMessage(`Found ${contracts.length} active contract(s)`, "info");
    } else if (data.msg_type === "proposal_open_contract" && data.proposal_open_contract) {
      // single contract update — update or append
      const poc = data.proposal_open_contract;
      console.log("🔁 Proposal open contract update:", poc);
      // update map and re-render full table
      if (poc.is_expired || poc.is_sold) {
        try { delete activeContractsMap[poc.contract_id]; } catch (e) {}
      } else {
        // Merge avec les données existantes (garde shortcode etc)
        const existing = activeContractsMap[poc.contract_id] || {};
        activeContractsMap[poc.contract_id] = { ...existing, ...poc };
        console.log(`Contract ${poc.contract_id} updated:`, activeContractsMap[poc.contract_id]);
      }
      renderActiveContracts();
    }
  };

  socket.onclose = () => console.log("🔴 wsContracts fermé");
  socket.onerror = (err) => console.error("⚠️ Erreur wsContracts:", err);

  return wsContracts;
}

// === ABONNEMENT / DÉSABONNEMENT ===
function subscribeActivePositions() {
  // s'assurer que la socket dédiée est ouverte
  const socket = connectWS();
  if (!socket) {
    console.log("subscribeActivePositions: no socket returned from connectWS()");
    return;
  }

  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ active_positions: 1, subscribe: 1 }));
    console.log("📡 Abonné aux contrats ouverts (via wsContracts)");
    subscribeOnOpen = false;
  } else if (socket.readyState === WebSocket.CONNECTING) {
    // la socket est en cours d'ouverture — on met en file d'attente
    subscribeOnOpen = true;
    console.log("📡 Subscription queued until socket opens and authorizes");
  } else {
    // socket fermée ou autre — tente de la recréer et mettre en file d'attente
    console.log("subscribeActivePositions: socket not open, reconnecting and queuing subscription");
    subscribeOnOpen = true;
    connectWS();
  }
}

function unsubscribeActivePositions() {
  if (wsContracts && wsContracts.readyState === WebSocket.OPEN) {
    wsContracts.send(JSON.stringify({ forget_all: "active_positions" }));
    console.log("🛑 Désabonné des contrats ouverts (via wsContracts)");
  }
}

  // === Automation Toggle ===
  const toggleAutomationBtn = document.getElementById("toggleAutomation");
  toggleAutomationBtn.addEventListener("click", () => {
    let ws = new WebSocket(WS_URL);
    if (!automationRunning) {
      toggleAutomationBtn.textContent = "Stop Automation";
      toggleAutomationBtn.style.background = "linear-gradient(90deg,#f44336,#e57373)";
      startAutomation(ws);
      automationRunning = true;
    } else {
      toggleAutomationBtn.textContent = "Launch Automation";
      toggleAutomationBtn.style.background = "linear-gradient(90deg,#4caf50,#81c784)";
      stopAutomation(ws);
      automationRunning = false;
    }
  });

  // --- TOGGLE PANEL ---
  controlPanelToggle.addEventListener("click", () => {
    if (!controlFormPanel) return;
    // If panel is visible (either class active or inline flex), hide it with transition
    if (controlFormPanel.classList.contains("active") || controlFormPanel.style.display === "flex") {
      controlFormPanel.classList.remove("active");
      // wait for CSS transition to finish before removing from layout
      setTimeout(() => { try { controlFormPanel.style.display = "none"; } catch (e) {} }, 320);
      controlPanelToggle.textContent = "⚙️ Show Controls";
    } else {
      // show and add active class to allow opacity/transform animation
      controlFormPanel.style.display = "flex";
      // small timeout so the browser registers the display change before adding active
      setTimeout(() => controlFormPanel.classList.add("active"), 10);
      controlPanelToggle.textContent = "⚙️ Hide Controls";
    }
  });

  // Initialize connection management
  if (connectBtn) {
    let isConnecting = false;

    // Connect button handler with proper state management
    connectBtn.addEventListener("click", async () => {
      if (isConnecting) return; // Prevent multiple clicks while connecting
      
      try {
        isConnecting = true;
        console.log("Connect button clicked - initializing connection...");
        
        // Update UI to connecting state
        connectBtn.disabled = true;
        connectBtn.textContent = "Connecting...";
        
        // Try connection
        await new Promise((resolve, reject) => {
          try {
            connectDeriv();
            displaySymbols();
            resolve();
          } catch (e) {
            reject(e);
          }
        });

        // Success state
        setTimeout(() => {
          connectBtn.disabled = false;
          connectBtn.textContent = "Connected";
          connectBtn.style.background = "#4caf50";
        }, 1000);

      } catch (err) {
        console.error("Connection error:", err);
        
        // Error state
        connectBtn.disabled = false;
        connectBtn.textContent = "Connection Failed";
        connectBtn.style.background = "#f44336";
        
        // Show error to user
        alert("Connection failed: " + (err.message || "Please try again."));
        
        // Reset button after delay
        setTimeout(() => {
          if (!authorized) { // Only reset if still not authorized
            connectBtn.textContent = "Se connecter";
            connectBtn.style.background = "#007bff";
          }
        }, 3000);
      } finally {
        isConnecting = false;
      }
    });
  } else {
    console.error("Connect button not found in DOM");
    // Try to show visible error
    try {
      const header = document.querySelector("header");
      if (header) {
        const errorMsg = document.createElement("div");
        errorMsg.style.color = "#dc2626";
        errorMsg.style.padding = "8px";
        errorMsg.textContent = "Connect button not found - please refresh the page";
        header.appendChild(errorMsg);
      }
    } catch (e) {
      console.error("Failed to show UI error:", e);
    }
  }

  // Initialize all UI components
  function initializeUI() {
    try {
      console.log("Initializing UI components...");
      
      // Initialize core displays
      displaySymbols();
      initChart();
      initPLGauge();
      
      // Initialize contract panel
      setupContractsPanel();
      
      // Set up control panel toggle
      if (controlPanelToggle && controlFormPanel) {
        controlPanelToggle.addEventListener("click", () => {
          if (!controlFormPanel) return;
          const isVisible = controlFormPanel.classList.contains("active") || controlFormPanel.style.display === "flex";
          
          if (isVisible) {
            controlFormPanel.classList.remove("active");
            setTimeout(() => { controlFormPanel.style.display = "none"; }, 320);
            controlPanelToggle.textContent = "⚙️ Show Controls";
          } else {
            controlFormPanel.style.display = "flex";
            setTimeout(() => controlFormPanel.classList.add("active"), 10);
            controlPanelToggle.textContent = "⚙️ Hide Controls";
          }
        });
      }
      
      // Wire up trade buttons
      if (buyBtn && sellBtn) {
        buyBtn.onclick = () => executeTrade("BUY");
        sellBtn.onclick = () => executeTrade("SELL");
      }
      
      // Set up automation toggle
      if (toggleAutomationBtn) {
        toggleAutomationBtn.addEventListener("click", () => {
          const newWs = new WebSocket(WS_URL);
          if (!automationRunning) {
            toggleAutomationBtn.textContent = "Stop Automation";
            toggleAutomationBtn.style.background = "linear-gradient(90deg,#f44336,#e57373)";
            startAutomation(newWs);
            automationRunning = true;
          } else {
            toggleAutomationBtn.textContent = "Launch Automation";
            toggleAutomationBtn.style.background = "linear-gradient(90deg,#4caf50,#81c784)";
            stopAutomation(newWs);
            automationRunning = false;
          }
        });
      }
      
      console.log("UI components initialized successfully");
    } catch (err) {
      console.error("UI initialization failed:", err);
      alert("Failed to initialize the interface. Please refresh the page.");
    }
  }

  // Initialize the application
  try {
    initializeUI();
    
    // Set up resize handling
    window.addEventListener("resize", () => {
      try { 
        positionGauges(); 
        if (chart) {
          chart.resize(chartInner.clientWidth, chartInner.clientHeight);
        }
      } catch (e) {
        console.error("Resize handling error:", e);
      }
    });
    
    // Initialize P/L tracking
    contractentry(totalPL => updatePLGauge(totalPL));
    
    console.log("Application initialized successfully");
  } catch (err) {
    console.error("Application initialization failed:", err);
    alert("Failed to start the application. Please refresh the page.");
  }
  
  // Initialise la socket de P/L une seule fois et lie la callback
  contractentry(totalPL => updatePLGauge(totalPL));

// Contract panel setup and toggle handling
function setupContractsPanel() {
  let panelInitialized = false;
  let isToggling = false;

  if (!contractsPanelToggle || !contractsPanel) {
    console.error("Contract panel elements not found:", {
      toggle: !!contractsPanelToggle,
      panel: !!contractsPanel
    });
    // Try to show error message in UI
    try {
      const container = document.getElementById("contractsPanelContainer");
      if (container) {
        container.innerHTML = '<div style="color: #dc2626; padding: 8px; text-align: center;">Contract panel elements not found</div>';
      }
    } catch (e) {
      console.error("Failed to show UI error:", e);
    }
    return;
  }

  // Panel toggle handler with debounce and state management
  contractsPanelToggle.addEventListener("click", async () => {
    if (isToggling) return; // Prevent multiple clicks while toggling
    isToggling = true;

    try {
      console.log("contractsPanelToggle clicked. current display:", contractsPanel.style.display, "isSubscribed:", isSubscribed);
      
      if (contractsPanel.style.display === "none" || contractsPanel.style.display === "") {
        // Show panel
        contractsPanel.style.display = "flex";
        contractsPanelToggle.textContent = "📄 Hide Contracts";
        
        // Initialize table if not done yet
        if (!panelInitialized) {
          try {
            await new Promise((resolve, reject) => {
              try {
                initTable();
                panelInitialized = true;
                resolve();
              } catch (err) {
                reject(err);
              }
            });
          } catch (err) {
            console.error("Failed to initialize contracts table:", err);
            setContractsPanelMessage("Failed to initialize table", "error");
            isToggling = false;
            return;
          }
        }

        // Subscribe to contract updates
        isSubscribed = true;
        setContractsPanelMessage("Connecting to Deriv...", "info");
        
        try {
          const ws = await new Promise((resolve, reject) => {
            const socket = connectWS();
            if (socket) {
              resolve(socket);
            } else {
              reject(new Error("Failed to establish WebSocket connection"));
            }
          });
          
          if (ws) {
            subscribeActivePositions();
          }
        } catch (err) {
          console.error("WebSocket connection error:", err);
          setContractsPanelMessage("Connection failed. Please try again.", "error");
          isToggling = false;
          return;
        }

      } else {
        // Hide panel and cleanup
        contractsPanel.style.display = "none";
        contractsPanelToggle.textContent = "📄 Show Contracts";
        isSubscribed = false;
        
        // Unsubscribe and clear data
        try {
          unsubscribeActivePositions();
          Object.keys(activeContractsMap).forEach(k => delete activeContractsMap[k]);
          renderActiveContracts();
          setContractsPanelMessage("", "info");
        } catch (err) {
          console.error("Error during panel cleanup:", err);
          setContractsPanelMessage("Error during cleanup. Some data may persist.", "warn");
        }
      }
    } catch (err) {
      console.error("Contracts panel toggle error:", err);
      setContractsPanelMessage("An error occurred. Please try again.", "error");
    } finally {
      isToggling = false;
    }
  });
}

// Initialize contracts panel
setupContractsPanel();
});

// Refresh button handler: force a contracts refresh (active_positions + portfolio)
const contractsRefreshBtn = document.getElementById("contractsRefreshBtn");
if (contractsRefreshBtn) {
  contractsRefreshBtn.addEventListener("click", () => {
    appendContractsDebug("User clicked Refresh (requesting active_positions and portfolio)");
    // ask wsContracts for active_positions
    if (wsContracts && wsContracts.readyState === WebSocket.OPEN) {
      try { wsContracts.send(JSON.stringify({ active_positions: 1 })); appendContractsDebug('sent: active_positions'); } catch (e) { appendContractsDebug('failed send active_positions: ' + e.message); }
    } else {
      // ensure connection and queue a subscribe
      appendContractsDebug('wsContracts not open — connecting and queueing subscription');
      connectWS();
      subscribeOnOpen = true;
    }

    // ask wsPL for portfolio as well (if available)
    if (wsPL && wsPL.readyState === WebSocket.OPEN) {
      try { wsPL.send(JSON.stringify({ portfolio: 1 })); appendContractsDebug('sent: portfolio to wsPL'); } catch (e) { appendContractsDebug('failed send portfolio: ' + e.message); }
    }
  });
}

// --- Controls: pagination, sorting and close action wiring ---
(function setupContractsControls(){
  const prevBtn = document.getElementById('contractsPrevBtn');
  const nextBtn = document.getElementById('contractsNextBtn');
  const pageSizeSel = document.getElementById('contractsPageSize');
  const sortSelect = document.getElementById('contractsSortSelect');
  const container = document.getElementById('autoHistoryList');

  if (prevBtn) prevBtn.addEventListener('click', () => { if (contractsCurrentPage>1){ contractsCurrentPage--; renderActiveContracts(); } });
  if (nextBtn) nextBtn.addEventListener('click', () => { contractsCurrentPage++; renderActiveContracts(); });
  if (pageSizeSel) pageSizeSel.addEventListener('change', (e)=>{ contractsPageSize = parseInt(e.target.value)||10; contractsCurrentPage=1; renderActiveContracts(); });
  if (sortSelect) sortSelect.addEventListener('change', (e)=>{ contractsSortMode = e.target.value || 'newest'; contractsCurrentPage=1; renderActiveContracts(); });

  // Delegated click handler for Close buttons inside the table
  if (container) {
    container.addEventListener('click', (ev) => {
      const btn = ev.target.closest && ev.target.closest('.closeRowBtn');
      if (!btn) return;
      const cid = btn.getAttribute('data-contract-id');
      if (!cid) return;
      // confirm
      const ok = confirm(`Close contract ${cid} ?`);
      if (!ok) return;
      closeContract(cid);
    });
  }

  // closeContract implementation — try to reuse wsPL then wsContracts, otherwise open one-shot socket
  function closeContract(contractId) {
    try {
      setContractsPanelMessage(`Closing ${contractId}...`, 'warn');
      // optimistic UI removal
      try { if (activeContractsMap[contractId]) delete activeContractsMap[contractId]; } catch (e) {}
      renderActiveContracts();

      const sellPayload = { sell: contractId, price: 0 };

      const sendVia = (s) => {
        try { s.send(JSON.stringify(sellPayload)); appendContractsDebug('sent sell for ' + contractId); } catch (e) { appendContractsDebug('failed send sell: ' + e.message); }
      };

      if (wsPL && wsPL.readyState === WebSocket.OPEN) {
        sendVia(wsPL);
        return;
      }
      if (wsContracts && wsContracts.readyState === WebSocket.OPEN) {
        sendVia(wsContracts);
        return;
      }

      // fallback: open a short-lived socket to send the sell
      const tmp = new WebSocket(WS_URL);
      tmp.addEventListener('open', () => { try { tmp.send(JSON.stringify({ authorize: TOKEN })); } catch (e) {} });
      tmp.addEventListener('message', (m) => {
        let data; try { data = JSON.parse(m.data); } catch (e) { return; }
        if (data.msg_type === 'authorize' && data.authorize) {
          try { tmp.send(JSON.stringify(sellPayload)); appendContractsDebug('tmp sell sent ' + contractId); } catch (e) {}
          setTimeout(()=>{ try{ tmp.close(); }catch(e){} }, 800);
        }
      });
      tmp.addEventListener('error', (e) => appendContractsDebug('tmp socket error: ' + (e && e.message))); 
    } catch (e) {
      console.error('closeContract error', e);
      appendContractsDebug('closeContract error: ' + e.message);
    }
  }
})();

});
