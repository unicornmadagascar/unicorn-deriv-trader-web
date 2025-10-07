// --- Création du graphique et de la liste ---
createChart();
buildSymbolList();
logHistory('Interface ready. Select a symbol.');

// --- Fonction d'abonnement automatique à tous les symboles ---
function subscribeAllSymbols() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  symbols.forEach(sym => {
    wsSendWhenOpen({ ticks: sym, subscribe: 1 });
  });
  logHistory('Subscribed to all Boom/Crash symbols.');
}

// --- Connexion WebSocket améliorée ---
function connectToDeriv(token) {
  if (ws) {
    try { ws.close(); } catch(e){}
    ws = null;
  }

  ws = new WebSocket(WS_URL);
  setStatus('Connecting...');
  ws.onopen = () => {
    isConnected = true;
    setStatus('Connected (unauthorized)');
    logHistory('WebSocket opened');

    if (token) wsSendWhenOpen({ authorize: token });
    else setStatus('Connected (simulation)');

    // Abonne tous les symboles après connexion
    setTimeout(subscribeAllSymbols, 1000);

    keepAliveTimer = setInterval(()=> wsSendWhenOpen({ ping: 1 }), 20000);
  };

  ws.onclose = () => {
    isConnected = false;
    isAuthorized = false;
    authorizeInfo = null;
    setStatus('Disconnected');
    logHistory('WebSocket closed');
    if (keepAliveTimer) clearInterval(keepAliveTimer);
  };

  ws.onerror = (err) => {
    console.error('WS error', err);
    setStatus('WebSocket error');
  };

  ws.onmessage = (evt) => {
    try {
      const msg = JSON.parse(evt.data);
      handleMessage(msg);
    } catch (e) {
      console.error('Invalid JSON', e, evt.data);
    }
  };
}

// --- Met à jour le style du symbole actif ---
function highlightSymbol(sym) {
  document.querySelectorAll('.symbolItem').forEach(el => el.classList.remove('active'));
  const el = document.getElementById('sym-' + sym);
  if (el) el.classList.add('active');
}

// --- HandleMessage amélioré avec Spread & flèche de tendance ---
function handleMessage(msg) {
  if (msg.error) {
    console.warn('API error', msg);
    logHistory('API error: ' + JSON.stringify(msg.error));
  }

  if (msg.authorize) {
    isAuthorized = true;
    authorizeInfo = msg.authorize;
    setStatus(`Authorized: ${authorizeInfo.loginid || 'unknown'}`);
    logHistory(`Authorized as ${authorizeInfo.loginid || 'unknown'}`);
    wsSendWhenOpen({ balance: 1, subscribe: 1 });
    return;
  }

  if (msg.balance) {
    try {
      const b = msg.balance.balance || msg.balance;
      balanceEl.textContent = 'Balance: ' + parseFloat(b).toFixed(2);
    } catch(e){}
    return;
  }

  if (msg.tick) {
    const t = msg.tick;
    const symbol = t.symbol || (msg.echo_req && msg.echo_req.ticks);
    if (!symbol) return;

    const quote = Number(t.quote);
    const epoch = Number(t.epoch);
    const prev = parseFloat(lastTick[symbol] || quote);
    const directionUp = quote > prev;

    lastTick[symbol] = quote;

    const bid = (quote - 0.0001).toFixed(5);
    const ask = (quote + 0.0001).toFixed(5);
    const spread = (ask - bid).toFixed(5);
    const change = ((quote - prev) / prev) * 100;

    const bidEl = document.getElementById('bid-' + symbol);
    const askEl = document.getElementById('ask-' + symbol);
    const chgEl = document.getElementById('chg-' + symbol);
    const sprEl = document.getElementById('spr-' + symbol);
    const dirEl = document.getElementById('dir-' + symbol);

    if (bidEl && askEl && chgEl && sprEl && dirEl) {
      bidEl.textContent = bid;
      askEl.textContent = ask;
      chgEl.textContent = change.toFixed(3) + '%';
      sprEl.textContent = spread;
      dirEl.textContent = directionUp ? '↑' : '↓';
      dirEl.style.color = directionUp ? '#00ff9c' : '#ff4040';
      chgEl.style.color = directionUp ? '#00ff9c' : '#ff4040';
    }

    if (symbol === selectedSymbol && series) {
      series.update({ time: Math.floor(epoch), value: quote });
    }
    return;
  }

  if (msg.history || msg.candles || msg['ticks_history']) {
    let prices = null, times = null;
    if (msg.history && msg.history.prices && msg.history.times) {
      prices = msg.history.prices;
      times = msg.history.times;
    } else if (msg.candles && Array.isArray(msg.candles)) {
      const data = msg.candles.map(c => ({ time: c.epoch, value: Number(c.close) }));
      if (series) series.setData(data);
      return;
    } else if (msg['ticks_history'] && msg['ticks_history'].history) {
      const h = msg['ticks_history'].history;
      if (h.prices && h.times) {
        prices = h.prices;
        times = h.times;
      }
    }

    if (prices && times && series) {
      const data = times.map((t, i) => ({ time: Math.floor(Number(t)), value: Number(prices[i]) }));
      series.setData(data);
    }
    return;
  }

  if (msg.proposal) return;
  if (msg.buy) return;
}

// --- Nouvelle version de buildSymbolList ---
function buildSymbolList() {
  symbolListEl.innerHTML = '';
  symbols.forEach(s => {
    const div = document.createElement('div');
    div.className = 'symbolItem';
    div.id = 'sym-' + s;
    div.innerHTML = `
      <div style="font-weight:700">${s.toUpperCase()}</div>
      <div>Bid: <span id="bid-${s}">--</span> | Ask: <span id="ask-${s}">--</span></div>
      <div>Δ: <span id="chg-${s}">--</span> | Spread: <span id="spr-${s}">--</span></div>
      <div>Tendance: <span id="dir-${s}" style="font-weight:bold">-</span></div>
    `;
    div.addEventListener('click', ()=> selectSymbol(s));
    symbolListEl.appendChild(div);
  });
}
