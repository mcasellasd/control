// Franklin Finances - Lògica de l'Aplicació i Gestió de l'Estat
// Desenvolupat amb estàndards web moderns en Català.

const FranklinApp = {
  // Estat de l'aplicació
  state: {
    cash: { balance: 0, currency: 'EUR' },
    goals: [],
    transactions: [],
    livePrices: {},
    activeTab: 'resum',
    isSimulating: false,
    simulationInterval: null,
    openaiKey: '',
    openaiModel: 'gpt-4o-mini',
    chatHistory: []
  },

  // Inicialització
  init() {
    this.loadState();
    
    // Comprovar si la web està desbloquejada criptogràficament
    const isUnlocked = sessionStorage.getItem('franklin_unlocked') === 'true';
    const overlay = document.getElementById('loginOverlay');
    
    if (isUnlocked) {
      if (overlay) overlay.classList.add('hidden');
    } else {
      if (overlay) overlay.classList.remove('hidden');
    }

    this.setupEventListeners();
    
    // Inicialitzar els gràfics
    if (window.FranklinCharts) {
      window.FranklinCharts.init();
    }
    
    // Si està desbloquejat, pintar a la pantalla inicial
    if (isUnlocked) {
      this.render();
    }
    
    // Actualitzar la interfície de xat de la IA
    this.updateAIChatUI();
    
    // Auto-activar simulació si estava guardada o per defecte encendre-la per fer-ho dinàmic
    const savedSim = localStorage.getItem('franklin_sim_active');
    if (savedSim === 'true' || savedSim === null) {
      document.getElementById('simSwitch').checked = true;
      // Només simular actius en viu si l'app està desbloquejada
      if (isUnlocked) {
        this.toggleSimulation(true);
      }
    }
  },

  // Carregar dades des de localStorage o utilitzar les dades de data.js per defecte
  loadState() {
    const savedData = localStorage.getItem('franklin_portfolio_data');
    const migrated = localStorage.getItem('franklin_data_migrated_v3');
    
    if (savedData && migrated === 'true') {
      try {
        this.state = JSON.parse(savedData);
        // Assegurar tab inicial correcte i definició de valors IA per defecte
        this.state.activeTab = 'resum';
        if (this.state.openaiKey === undefined) this.state.openaiKey = '';
        if (this.state.openaiModel === undefined) this.state.openaiModel = 'gpt-4o-mini';
        this.state.chatHistory = []; // Es manté en memòria durant la sessió
      } catch (e) {
        console.error("Error carregant dades del localStorage, restablint...", e);
        this.state = JSON.parse(JSON.stringify(window.FranklinDefaultData));
        this.state.openaiKey = '';
        this.state.openaiModel = 'gpt-4o-mini';
        this.state.chatHistory = [];
      }
    } else {
      // Carregar dades preconfigurades de Fons
      let key = '';
      let model = 'gpt-4o-mini';
      if (savedData) {
        try {
          const parsed = JSON.parse(savedData);
          key = parsed.openaiKey || '';
          model = parsed.openaiModel || 'gpt-4o-mini';
        } catch(e) {}
      }
      this.state = JSON.parse(JSON.stringify(window.FranklinDefaultData));
      this.state.openaiKey = key;
      this.state.openaiModel = model;
      this.state.chatHistory = [];
      localStorage.setItem('franklin_data_migrated_v3', 'true');
      this.saveState();
    }
  },

  // Desar dades a localStorage
  saveState() {
    localStorage.setItem('franklin_portfolio_data', JSON.stringify(this.state));
  },

  // Generador determinista i consistent de retorns històrics basat en el símbol
  getHistoricalReturns(symbol) {
    let seed = 0;
    const sym = symbol.toUpperCase();
    for (let i = 0; i < sym.length; i++) {
      seed = (seed << 5) - seed + sym.charCodeAt(i);
      seed |= 0; // Convertir a enter de 32 bits
    }
    
    // Funció pseudo-aleatòria determinista basada en la llavor
    const pseudoRandom = (offset) => {
      const x = Math.sin(seed + offset) * 10000;
      return x - Math.floor(x);
    };

    // Generació de rendiments realistes i consistents
    const daily = (pseudoRandom(1) * 3 - 1.2);    // -1.2% a +1.8%
    const weekly = (pseudoRandom(2) * 8 - 3);      // -3.0% a +5.0%
    const monthly = (pseudoRandom(3) * 15 - 5);    // -5.0% a +10.0%
    const ytd = (pseudoRandom(4) * 40 - 10);       // -10.0% a +30.0%
    const annual = (pseudoRandom(5) * 60 - 15);    // -15.0% a +45.0%

    return {
      daily: parseFloat(daily.toFixed(2)),
      weekly: parseFloat(weekly.toFixed(2)),
      monthly: parseFloat(monthly.toFixed(2)),
      ytd: parseFloat(ytd.toFixed(2)),
      annual: parseFloat(annual.toFixed(2))
    };
  },

  // Càlculs de la cartera (Holdings)
  calculateHoldings() {
    const holdings = {};
    
    // Endreçar les transaccions per data de forma cronològica per calcular correctament el WAC (Cost Mitjà Ponderat)
    const sortedTx = [...this.state.transactions].sort((a, b) => new Date(a.date) - new Date(b.date));
    
    sortedTx.forEach(tx => {
      const sym = tx.symbol.toUpperCase();
      if (!holdings[sym]) {
        holdings[sym] = {
          symbol: sym,
          isin: tx.isin || '',
          name: tx.name,
          assetType: tx.assetType,
          shares: 0,
          totalCost: 0, // Cost total en EUR
          avgPriceEUR: 0, // Preu mitjà en EUR
          currency: tx.currency || 'EUR',
          exchangeRate: tx.exchangeRate || 1
        };
      }
      
      const h = holdings[sym];
      const qty = parseFloat(tx.quantity);
      const price = parseFloat(tx.price);
      const commission = parseFloat(tx.commission || 0);
      const rate = parseFloat(tx.exchangeRate || 1);
      
      if (tx.type === 'compra') {
        const costInEUR = (qty * price * rate) + commission;
        h.shares += qty;
        h.totalCost += costInEUR;
        h.avgPriceEUR = h.shares > 0 ? (h.totalCost / h.shares) : 0;
      } else if (tx.type === 'venda') {
        const proportionSold = qty / h.shares;
        h.shares = Math.max(0, h.shares - qty);
        h.totalCost = Math.max(0, h.totalCost * (1 - proportionSold));
        // El preu mitjà de compra no canvia en vendre
      }
    });
    
    // Filtrar posicions tancades (menys de 0.0001 unitats) i calcular valors en viu
    return Object.values(holdings)
      .filter(h => h.shares > 0.0001)
      .map(h => {
        const live = this.state.livePrices[h.symbol] || { current: h.avgPriceEUR / h.exchangeRate, change: 0 };
        const livePriceEUR = live.current * h.exchangeRate;
        const currentValueEUR = h.shares * livePriceEUR;
        const profitEUR = currentValueEUR - h.totalCost;
        const profitPercent = h.totalCost > 0 ? (profitEUR / h.totalCost) * 100 : 0;
        
        const hist = this.getHistoricalReturns(h.symbol);
        const weeklyReturn = live.weekly !== undefined ? live.weekly : hist.weekly;
        const monthlyReturn = live.monthly !== undefined ? live.monthly : hist.monthly;
        const ytdReturn = live.ytd !== undefined ? live.ytd : hist.ytd;
        const annualReturn = live.annual !== undefined ? live.annual : hist.annual;

        return {
          ...h,
          livePrice: live.current,
          livePriceEUR,
          currentValueEUR,
          profitEUR,
          profitPercent,
          dailyChange: live.change || 0,
          weeklyReturn,
          monthlyReturn,
          ytdReturn,
          annualReturn
        };
      });
  },

  // Càlcul de mètriques agregades de la cartera
  calculateMetrics(holdings) {
    let totalInvested = 0;
    let currentHoldingsValue = 0;
    
    let totalInvestedAccions = 0;
    let currentValAccions = 0;
    
    let totalInvestedETFs = 0;
    let currentValETFs = 0;
    
    let totalInvestedFons = 0;
    let currentValFons = 0;
    
    holdings.forEach(h => {
      totalInvested += h.totalCost;
      currentHoldingsValue += h.currentValueEUR;
      
      if (h.assetType === 'accion') {
        totalInvestedAccions += h.totalCost;
        currentValAccions += h.currentValueEUR;
      } else if (h.assetType === 'etf') {
        totalInvestedETFs += h.totalCost;
        currentValETFs += h.currentValueEUR;
      } else if (h.assetType === 'fons') {
        totalInvestedFons += h.totalCost;
        currentValFons += h.currentValueEUR;
      }
    });
    
    const cashBalance = parseFloat(this.state.cash.balance);
    const netWorth = currentHoldingsValue + cashBalance;
    const totalProfit = currentHoldingsValue - totalInvested;
    const overallYield = totalInvested > 0 ? (totalProfit / totalInvested) * 100 : 0;
    
    // Càlcul de la variació diària simulada basada en el pes de cada actiu
    let dailyChangeEUR = 0;
    holdings.forEach(h => {
      const weight = netWorth > 0 ? (h.currentValueEUR / netWorth) : 0;
      const dailyAssetChangeEUR = h.currentValueEUR * (h.dailyChange / 100);
      dailyChangeEUR += dailyAssetChangeEUR;
    });
    
    const dailyChangePercent = netWorth > 0 ? (dailyChangeEUR / netWorth) * 100 : 0;

    return {
      netWorth,
      totalInvested,
      currentHoldingsValue,
      cashBalance,
      totalProfit,
      overallYield,
      dailyChangeEUR,
      dailyChangePercent,
      // Detalls per tipus d'actiu
      accions: { invested: totalInvestedAccions, value: currentValAccions },
      etfs: { invested: totalInvestedETFs, value: currentValETFs },
      fons: { invested: totalInvestedFons, value: currentValFons }
    };
  },

  // Actualitzar tota la interfície gràfica
  render() {
    const holdings = this.calculateHoldings();
    const metrics = this.calculateMetrics(holdings);
    
    // 1. Renderitzar elements globals i KPI cards
    this.renderKPIs(metrics);
    
    // 2. Actualitzar els gràfics
    this.renderCharts(holdings, metrics);
    
    // 3. Renderitzar les pestanyes segons la pestanya activa
    this.renderActiveTabContent(holdings, metrics);
    
    // 4. Renderitzar historial de transaccions global
    this.renderTransactionsLog();

    // 5. Renderitzar objectius
    this.renderGoals(metrics.netWorth);
  },

  // Pintar KPI superiors
  renderKPIs(metrics) {
    // Patrimoni Net
    const netWorthEl = document.getElementById('globalNetWorth');
    if (netWorthEl) {
      netWorthEl.innerText = metrics.netWorth.toLocaleString('ca-ES', { style: 'currency', currency: 'EUR' });
    }
    
    // Variació Diària
    const dailyChangeEl = document.getElementById('globalDailyChange');
    if (dailyChangeEl) {
      const sign = metrics.dailyChangeEUR >= 0 ? '+' : '';
      dailyChangeEl.innerText = `${sign}${metrics.dailyChangeEUR.toLocaleString('ca-ES', { style: 'currency', currency: 'EUR' })} (${sign}${metrics.dailyChangePercent.toFixed(2)}%)`;
      dailyChangeEl.className = 'net-worth-change ' + (metrics.dailyChangeEUR >= 0 ? 'change-up' : 'change-down');
    }
    
    // Targetes de KPI
    const valInvestit = document.getElementById('kpiInvestit');
    if (valInvestit) {
      valInvestit.innerText = metrics.totalInvested.toLocaleString('ca-ES', { style: 'currency', currency: 'EUR' });
    }

    const valEfectiu = document.getElementById('kpiEfectiu');
    if (valEfectiu) {
      valEfectiu.innerText = metrics.cashBalance.toLocaleString('ca-ES', { style: 'currency', currency: 'EUR' });
    }

    const valPlusvalua = document.getElementById('kpiPlusvalua');
    if (valPlusvalua) {
      const sign = metrics.totalProfit >= 0 ? '+' : '';
      valPlusvalua.innerText = `${sign}${metrics.totalProfit.toLocaleString('ca-ES', { style: 'currency', currency: 'EUR' })}`;
      valPlusvalua.parentElement.className = 'kpi-card ' + (metrics.totalProfit >= 0 ? 'border-emerald' : 'border-crimson');
      const valPlusvaluaIcon = valPlusvalua.previousElementSibling.firstElementChild;
      valPlusvaluaIcon.className = metrics.totalProfit >= 0 ? 'kpi-icon emerald' : 'kpi-icon crimson';
      valPlusvaluaIcon.innerHTML = metrics.totalProfit >= 0 ? '<i class="ri-arrow-up-double-line"></i>' : '<i class="ri-arrow-down-double-line"></i>';
    }

    const valRendibilitat = document.getElementById('kpiRendibilitat');
    if (valRendibilitat) {
      const sign = metrics.overallYield >= 0 ? '+' : '';
      valRendibilitat.innerText = `${sign}${metrics.overallYield.toFixed(2)}%`;
      valRendibilitat.className = 'kpi-value ' + (metrics.overallYield >= 0 ? 'change-up' : 'change-down');
    }
  },

  // Dibuixar els gràfics
  renderCharts(holdings, metrics) {
    if (!window.FranklinCharts) return;
    
    // A. Donut: Accions vs ETFs vs Fons vs Efectiu
    window.FranklinCharts.updateAllocation(
      metrics.accions.value,
      metrics.etfs.value,
      metrics.fons.value,
      metrics.cashBalance
    );
    
    // B. Evolució històrica
    // Simulem dades històriques partint dels últims 5 mesos adaptant-los al valor de patrimoni net actual
    const baseValue = metrics.netWorth;
    const historyValues = [
      baseValue * 0.88, // Fa 5 mesos
      baseValue * 0.91, // Fa 4 mesos
      baseValue * 0.94, // Fa 3 mesos
      baseValue * 0.93, // Fa 2 mesos
      baseValue * 0.97, // Fa 1 mes
      baseValue         // Mes actual
    ];
    
    // Obtenir noms dels darrers 6 mesos en Català
    const mesos = ['Gener', 'Febrer', 'Març', 'Abril', 'Maig', 'Juny', 'Juliol', 'Agost', 'Setembre', 'Octubre', 'Novembre', 'Desembre'];
    const avui = new Date();
    const labels = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(avui.getFullYear(), avui.getMonth() - i, 1);
      labels.push(mesos[d.getMonth()]);
    }
    
    window.FranklinCharts.updateEvolution(labels, historyValues);

    // C. Comparativa de Rendiment Global (%) — Sumant i mostrant també els Fons d'Inversió
    const yieldAccions = metrics.accions.invested > 0 ? ((metrics.accions.value - metrics.accions.invested) / metrics.accions.invested) * 100 : 0;
    const yieldETFs = metrics.etfs.invested > 0 ? ((metrics.etfs.value - metrics.etfs.invested) / metrics.etfs.invested) * 100 : 0;
    const yieldFons = metrics.fons.invested > 0 ? ((metrics.fons.value - metrics.fons.invested) / metrics.fons.invested) * 100 : 0;
    
    window.FranklinCharts.updatePerformance(
      window.FranklinCharts.globalPerformanceChart,
      ['Accions', 'ETFs', 'Fons d\'Inversió'],
      [yieldAccions, yieldETFs, yieldFons]
    );

    // D. Gràfics de Rendiment Individuals per Secció (Accions, ETFs i Fons)
    // Accions
    const accionsHoldings = holdings.filter(h => h.assetType === 'accion');
    const accionsLabels = accionsHoldings.map(h => h.symbol);
    const accionsValues = accionsHoldings.map(h => h.profitPercent);
    window.FranklinCharts.updatePerformance(
      window.FranklinCharts.accionsPerformanceChart,
      accionsLabels,
      accionsValues
    );

    // ETFs
    const etfsHoldings = holdings.filter(h => h.assetType === 'etf');
    const etfsLabels = etfsHoldings.map(h => h.symbol);
    const etfsValues = etfsHoldings.map(h => h.profitPercent);
    window.FranklinCharts.updatePerformance(
      window.FranklinCharts.etfsPerformanceChart,
      etfsLabels,
      etfsValues
    );

    // Fons
    const fonsHoldings = holdings.filter(h => h.assetType === 'fons');
    const fonsLabels = fonsHoldings.map(h => h.symbol);
    const fonsValues = fonsHoldings.map(h => h.profitPercent);
    window.FranklinCharts.updatePerformance(
      window.FranklinCharts.fonsPerformanceChart,
      fonsLabels,
      fonsValues
    );
  },

  // Contingut dinàmic de les pestanyes
  renderActiveTabContent(holdings, metrics) {
    // Amagar totes les seccions de pestanyes
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    
    // Mostrar la secció seleccionada
    const targetTab = document.getElementById(`tab-${this.state.activeTab}`);
    if (targetTab) {
      targetTab.classList.add('active');
    }
    
    // Accions, ETFs, i Fons utilitzen taules i targetes resum específiques
    if (['accions', 'etfs', 'fons'].includes(this.state.activeTab)) {
      const assetType = this.state.activeTab.slice(0, -1); // 'accion', 'etf', 'fon' -> cal ajustar 'fons' -> 'fons'
      const filterType = this.state.activeTab === 'fons' ? 'fons' : assetType;
      
      const filteredHoldings = holdings.filter(h => h.assetType === filterType);
      const specificMetrics = metrics[this.state.activeTab];
      
      // Actualitzar targetes resum d'aquesta pestanya
      const valTotal = document.getElementById(`${this.state.activeTab}TotalValue`);
      const valInvestit = document.getElementById(`${this.state.activeTab}TotalInvested`);
      const valRend = document.getElementById(`${this.state.activeTab}OverallYield`);
      
      if (valTotal) valTotal.innerText = specificMetrics.value.toLocaleString('ca-ES', { style: 'currency', currency: 'EUR' });
      if (valInvestit) valInvestit.innerText = specificMetrics.invested.toLocaleString('ca-ES', { style: 'currency', currency: 'EUR' });
      
      if (valRend) {
        const profit = specificMetrics.value - specificMetrics.invested;
        const yieldPercent = specificMetrics.invested > 0 ? (profit / specificMetrics.invested) * 100 : 0;
        const sign = profit >= 0 ? '+' : '';
        valRend.innerText = `${sign}${profit.toLocaleString('ca-ES', { style: 'currency', currency: 'EUR' })} (${sign}${yieldPercent.toFixed(2)}%)`;
        valRend.className = 'asset-summary-value ' + (profit >= 0 ? 'change-up' : 'change-down');
      }
      
      // Dibuixar gràfic de rendiment específic de la pestanya
      const labels = filteredHoldings.map(h => h.symbol);
      const values = filteredHoldings.map(h => h.profitPercent);
      const chartInstance = window.FranklinCharts[`${this.state.activeTab}PerformanceChart`];
      if (chartInstance) {
        window.FranklinCharts.updatePerformance(chartInstance, labels, values);
      }
      
      // Emplenar la taula específica d'actius
      const tbody = document.querySelector(`#${this.state.activeTab}Table tbody`);
      if (tbody) {
        if (filteredHoldings.length === 0) {
          tbody.innerHTML = `<tr><td colspan="12" style="text-align: center; color: var(--text-dim); padding: 3rem;">No tens cap actiu registrat d'aquest tipus. Afegeix una transacció de compra!</td></tr>`;
        } else {
          tbody.innerHTML = filteredHoldings.map(h => {
            const profitSign = h.profitEUR >= 0 ? '+' : '';
            const profitClass = h.profitEUR >= 0 ? 'change-up' : 'change-down';
            
            // Format del preu actual en la seva divisa
            const livePriceStr = h.livePrice.toLocaleString('ca-ES', { style: 'currency', currency: h.currency });
            const avgPriceStr = (h.avgPriceEUR / h.exchangeRate).toLocaleString('ca-ES', { style: 'currency', currency: h.currency });
            
            // Funció interna per maquetar percentatges colorits de rendiment
            const formatPerfCell = (val) => {
              const sign = val >= 0 ? '+' : '';
              const cls = val >= 0 ? 'change-up' : 'change-down';
              return `<span class="${cls}" style="font-family: var(--font-heading); font-weight: 600; font-size: 0.9rem;">${sign}${val.toFixed(2)}%</span>`;
            };

            // Accions o botons de control a la darrera columna
            const actionCellContent = this.state.activeTab === 'fons' ? `
              <div style="display: flex; gap: 0.35rem; justify-content: center; align-items: center;">
                <button class="btn btn-secondary" style="padding: 0.4rem 0.60rem; font-size: 0.8rem; border-radius: 8px; font-family: var(--font-heading); font-weight: 600; display: inline-flex; align-items: center; gap: 0.25rem; margin: 0;" onclick="FranklinApp.showFundHistory('${h.symbol}', '${h.isin}')" title="Veure històric de ${h.symbol}">
                  <i class="ri-line-chart-line" style="color: var(--amber);"></i> Històric
                </button>
                <button class="btn-delete" onclick="FranklinApp.deleteHolding('${h.symbol}')" title="Eliminar posició completa de ${h.symbol}">
                  <i class="ri-delete-bin-6-line"></i>
                </button>
              </div>
            ` : `
              <button class="btn-delete" onclick="FranklinApp.deleteHolding('${h.symbol}')" title="Eliminar posició completa de ${h.symbol}">
                <i class="ri-delete-bin-6-line"></i>
              </button>
            `;

            return `
              <tr data-symbol="${h.symbol}">
                <td>
                  <div class="asset-identity">
                    <div class="asset-badge">${h.symbol.slice(0, 2)}</div>
                    <div>
                      <div class="asset-symbol">
                        ${h.symbol}
                        ${h.isin ? `<span style="font-size: 0.65rem; color: var(--text-dim); font-weight: normal; margin-left: 0.4rem; padding: 0.1rem 0.35rem; background: rgba(255,255,255,0.04); border-radius: 4px; border: 1px solid rgba(255,255,255,0.03);">${h.isin}</span>` : ''}
                      </div>
                      <div class="asset-name">${h.name}</div>
                    </div>
                  </div>
                </td>
                <td style="font-family: var(--font-heading); font-weight: 600;">${h.shares.toLocaleString('ca-ES', { maximumFractionDigits: 4 })}</td>
                <td style="color: var(--text-muted); font-family: var(--font-body);">${avgPriceStr}</td>
                <td class="live-price-cell" style="font-family: var(--font-heading); font-weight: 700; font-size: 0.95rem;">${livePriceStr}</td>
                <td style="font-family: var(--font-heading); font-weight: 700;">${h.currentValueEUR.toLocaleString('ca-ES', { style: 'currency', currency: 'EUR' })}</td>
                <td style="text-align: center;">${formatPerfCell(h.dailyChange)}</td>
                <td style="text-align: center;">${formatPerfCell(h.weeklyReturn)}</td>
                <td style="text-align: center;">${formatPerfCell(h.monthlyReturn)}</td>
                <td style="text-align: center;">${formatPerfCell(h.ytdReturn)}</td>
                <td style="text-align: center;">${formatPerfCell(h.annualReturn)}</td>
                <td class="${profitClass}" style="font-family: var(--font-heading); font-weight: 700; text-align: center;">
                  <div style="font-size: 0.95rem; font-weight: 800;">${profitSign}${h.profitPercent.toFixed(2)}%</div>
                  <div style="font-size: 0.70rem; font-weight: 500; opacity: 0.8; margin-top: 0.05rem;">
                    ${profitSign}${h.profitEUR.toLocaleString('ca-ES', { style: 'currency', currency: 'EUR' })}
                  </div>
                </td>
                <td style="text-align: center;">
                  ${actionCellContent}
                </td>
              </tr>
            `;
          }).join('');
        }
      }
    }
    
    // Per a la pestanya de Resum, volem mostrar la taula amb TOP actius per valoració
    if (this.state.activeTab === 'resum') {
      const topHoldings = [...holdings].sort((a, b) => b.currentValueEUR - a.currentValueEUR).slice(0, 5);
      const topTbody = document.querySelector('#topAssetsTable tbody');
      
      if (topTbody) {
        if (topHoldings.length === 0) {
          topTbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-dim); padding: 2rem;">Sense actius disponibles. Registra una transacció de compra per començar.</td></tr>`;
        } else {
          topTbody.innerHTML = topHoldings.map(h => {
            const profitSign = h.profitEUR >= 0 ? '+' : '';
            const profitClass = h.profitEUR >= 0 ? 'change-up' : 'change-down';
            
            return `
              <tr data-symbol="${h.symbol}">
                <td>
                  <div class="asset-identity">
                    <div class="asset-badge">${h.symbol.slice(0, 2)}</div>
                    <div>
                      <div class="asset-symbol">${h.symbol}</div>
                      <div class="asset-name">${h.name}</div>
                    </div>
                  </div>
                </td>
                <td><span class="tag-label tag-${h.assetType === 'accion' ? 'accion' : h.assetType === 'etf' ? 'etf' : 'fons'}">${h.assetType === 'accion' ? 'Acció' : h.assetType === 'etf' ? 'ETF' : 'Fons'}</span></td>
                <td style="font-family: var(--font-heading); font-weight: 600;">${h.shares.toLocaleString('ca-ES', { maximumFractionDigits: 4 })}</td>
                <td style="font-family: var(--font-heading); font-weight: 700;">${h.currentValueEUR.toLocaleString('ca-ES', { style: 'currency', currency: 'EUR' })}</td>
                <td class="${profitClass}" style="font-family: var(--font-heading); font-weight: 700;">
                  ${profitSign}${h.profitPercent.toFixed(2)}%
                </td>
              </tr>
            `;
          }).join('');
        }
      }
    }
  },

  // Renderitzar el llistat de transaccions completes
  renderTransactionsLog() {
    const list = document.getElementById('transactionsList');
    if (!list) return;
    
    // Ordenar de més recent a més antiga
    const sortedTx = [...this.state.transactions].sort((a, b) => new Date(b.date) - new Date(a.date));
    
    if (sortedTx.length === 0) {
      list.innerHTML = `<div style="text-align: center; color: var(--text-dim); padding: 3rem;">No hi ha transaccions registrades en l'historial.</div>`;
      return;
    }
    
    list.innerHTML = sortedTx.map(tx => {
      const isBuy = tx.type === 'compra';
      const totalCost = tx.quantity * tx.price;
      const currencySymbol = tx.currency === 'USD' ? '$' : '€';
      
      const badgeClass = tx.assetType === 'accion' ? 'tag-accion' : tx.assetType === 'etf' ? 'tag-etf' : 'tag-fons';
      const badgeText = tx.assetType === 'accion' ? 'Acció' : tx.assetType === 'etf' ? 'ETF' : 'Fons';
      
      return `
        <div class="transaction-row">
          <div class="transaction-left">
            <div class="transaction-icon ${isBuy ? 'buy' : 'sell'}">
              <i class="${isBuy ? 'ri-download-2-line' : 'ri-upload-2-line'}"></i>
            </div>
            <div class="transaction-details">
              <div class="transaction-name">
                <span style="font-weight: 800;">${isBuy ? 'COMPRA' : 'VENDA'}</span> - ${tx.name} (${tx.symbol})
                <span class="tag-label ${badgeClass}" style="font-size: 0.65rem; margin-left: 0.5rem; padding: 0.1rem 0.4rem;">${badgeText}</span>
              </div>
              <div class="transaction-meta">
                ${tx.quantity.toLocaleString('ca-ES', { maximumFractionDigits: 4 })} unitats @ ${tx.price.toLocaleString('ca-ES', { style: 'currency', currency: tx.currency })} 
                ${tx.commission > 0 ? ` (+ comissió: ${tx.commission.toLocaleString('ca-ES', { style: 'currency', currency: tx.currency })})` : ''}
                ${tx.notes ? ` | <span style="font-style: italic;">"${tx.notes}"</span>` : ''}
              </div>
            </div>
          </div>
          <div class="transaction-right">
            <div class="transaction-amount ${isBuy ? 'change-down' : 'change-up'}">
              ${isBuy ? '-' : '+'}${totalCost.toLocaleString('ca-ES', { style: 'currency', currency: tx.currency })}
            </div>
            <div class="transaction-date">
              <i class="ri-calendar-line" style="vertical-align: middle;"></i> ${tx.date}
              <button class="btn-delete" onclick="FranklinApp.deleteTransaction('${tx.id}')" title="Eliminar transacció">
                <i class="ri-delete-bin-6-line"></i>
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  },

  // Renderitzar objectius financers
  renderGoals(netWorth) {
    // Renderitzar objectiu destacat al resum general
    const quickGoalEl = document.getElementById('quickGoalWidget');
    if (quickGoalEl) {
      if (this.state.goals.length === 0) {
        quickGoalEl.innerHTML = `<p style="font-size: 0.85rem; color: var(--text-muted); line-height: 1.5;">Vés a la secció d'<strong>Objectius</strong> per afegir nous reptes financers i veure la llista en detall.</p>`;
      } else {
        const g = this.state.goals[0];
        let allocated = 0;
        if (g.title.toLowerCase().includes('emergència')) {
          allocated = this.state.cash.balance;
        } else if (g.title.toLowerCase().includes('llibertat')) {
          allocated = netWorth;
        } else {
          allocated = Math.min(g.target, netWorth * 0.15);
        }
        const percent = Math.min(100, (allocated / g.target) * 100);
        
        quickGoalEl.innerHTML = `
          <div class="goal-progress-card" style="margin: 0; background: transparent; border: none; padding: 0;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
              <span class="goal-badge" style="margin: 0;">${g.category}</span>
              <span class="goal-deadline" style="font-size: 0.75rem;"><i class="ri-time-line"></i> Límit: ${g.deadline}</span>
            </div>
            <div class="goal-title" style="font-size: 1.1rem; margin-bottom: 0.5rem;">${g.title}</div>
            <div style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 1rem;">${g.notes || 'Sense comentaris.'}</div>
            
            <div class="goal-progress-container">
              <div class="goal-progress-bar-bg">
                <div class="goal-progress-bar-fill" style="width: ${percent}%"></div>
              </div>
              <div class="goal-metrics" style="margin-top: 0.5rem;">
                <div style="font-size: 0.8rem; color: var(--text-muted);">${allocated.toLocaleString('ca-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })} aconseguits</div>
                <div class="goal-percentage" style="font-size: 0.95rem; font-weight: 700; color: var(--accent-primary);">${percent.toFixed(0)}%</div>
              </div>
            </div>
            <div style="margin-top: 1rem; text-align: right;">
              <button class="btn btn-secondary" onclick="FranklinApp.switchTab('objectius')" style="font-size: 0.75rem; padding: 0.35rem 0.75rem;">
                Veure tots els objectius <i class="ri-arrow-right-line"></i>
              </button>
            </div>
          </div>
        `;
      }
    }

    const grid = document.getElementById('goalsGrid');
    if (!grid) return;
    
    if (this.state.goals.length === 0) {
      grid.innerHTML = `<div style="grid-column: span 3; text-align: center; color: var(--text-dim); padding: 3rem;">No tens cap objectiu financer definit. Afegeix-ne un!</div>`;
      return;
    }
    
    grid.innerHTML = this.state.goals.map(g => {
      // Simulem quin percentatge hem aconseguit, basat en el nostre Patrimoni Net (per a Llibertat Financera)
      // o manual/fons d'emergència vinculat a l'efectiu. Per simplificar i fer-ho atractiu:
      let allocated = 0;
      if (g.title.toLowerCase().includes('emergència')) {
        allocated = this.state.cash.balance;
      } else if (g.title.toLowerCase().includes('llibertat')) {
        allocated = netWorth;
      } else {
        // Altres objectius tenen un valor fix proporcional segons estalvi manual
        allocated = Math.min(g.target, netWorth * 0.15); // Assumim 15% del total
      }
      
      const percent = Math.min(100, (allocated / g.target) * 100);
      const remaining = Math.max(0, g.target - allocated);
      
      return `
        <div class="goal-progress-card">
          <span class="goal-badge">${g.category}</span>
          <div class="goal-title">${g.title}</div>
          <div style="font-size: 0.8rem; color: var(--text-muted); line-height: 1.4; min-height: 2.8rem;">${g.notes || 'Sense comentaris.'}</div>
          
          <div class="goal-progress-container">
            <div class="goal-progress-bar-bg">
              <div class="goal-progress-bar-fill" style="width: ${percent}%"></div>
            </div>
            <div class="goal-metrics">
              <div>${allocated.toLocaleString('ca-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })} aconseguits</div>
              <div class="goal-percentage">${percent.toFixed(0)}%</div>
            </div>
          </div>
          
          <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid rgba(255, 255, 255, 0.05); padding-top: 0.85rem; margin-top: 0.5rem;">
            <span class="goal-deadline"><i class="ri-time-line"></i> Límit: ${g.deadline}</span>
            <button class="btn-delete" onclick="FranklinApp.deleteGoal('${g.id}')" title="Eliminar objectiu">
              <i class="ri-delete-bin-6-line"></i>
            </button>
          </div>
        </div>
      `;
    }).join('');
  },

  // Canviar de pestanya activa
  switchTab(tabId) {
    this.state.activeTab = tabId;
    
    // Actualitzar classe activa de la barra lateral
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    const activeNav = document.getElementById(`nav-${tabId}`);
    if (activeNav) activeNav.classList.add('active');
    
    this.render();
  },

  // Activar o desactivar simulació dinàmica dels mercats
  toggleSimulation(active) {
    this.state.isSimulating = active;
    localStorage.setItem('franklin_sim_active', active);
    
    if (active) {
      if (this.simulationInterval) clearInterval(this.simulationInterval);
      
      this.simulationInterval = setInterval(() => {
        this.runSimulationStep();
      }, 2500); // Actualitzar cada 2.5 segons per dinamisme
    } else {
      if (this.simulationInterval) {
        clearInterval(this.simulationInterval);
        this.simulationInterval = null;
      }
    }
  },

  // Pas de simulació: altera preus subtilment per fer l'app viva
  runSimulationStep() {
    const assets = Object.keys(this.state.livePrices);
    if (assets.length === 0) return;
    
    // Seleccionar 2-3 actius aleatoris per fluctuar
    const numToFluctuate = Math.min(assets.length, Math.floor(Math.random() * 2) + 2);
    const shuffled = assets.sort(() => 0.5 - Math.random());
    const selected = shuffled.slice(0, numToFluctuate);
    
    selected.forEach(symbol => {
      const priceObj = this.state.livePrices[symbol];
      // Volatilitat simulada entre -0.7% i +0.8%
      const changePercent = (Math.random() * 1.5 - 0.7); 
      const oldPrice = priceObj.current;
      const newPrice = Math.max(0.01, oldPrice * (1 + changePercent / 100));
      
      priceObj.current = parseFloat(newPrice.toFixed(2));
      priceObj.change = parseFloat(changePercent.toFixed(2));

      // Assegurar inicialització dels retorns històrics en viu si no existeixen
      if (priceObj.weekly === undefined) {
        const hist = this.getHistoricalReturns(symbol);
        priceObj.weekly = hist.weekly;
        priceObj.monthly = hist.monthly;
        priceObj.ytd = hist.ytd;
        priceObj.annual = hist.annual;
      }

      // Fer fluctuar els retorns de forma proporcional decreixent (economia real)
      priceObj.weekly = parseFloat((priceObj.weekly + changePercent * 0.8).toFixed(2));
      priceObj.monthly = parseFloat((priceObj.monthly + changePercent * 0.5).toFixed(2));
      priceObj.ytd = parseFloat((priceObj.ytd + changePercent * 0.3).toFixed(2));
      priceObj.annual = parseFloat((priceObj.annual + changePercent * 0.2).toFixed(2));
      
      // Disparar efecte visual flashing en la taula si està visible
      setTimeout(() => {
        const rows = document.querySelectorAll(`tr[data-symbol="${symbol}"]`);
        rows.forEach(row => {
          const priceCell = row.querySelector('.live-price-cell');
          if (priceCell) {
            priceCell.classList.remove('flash-up', 'flash-down');
            void priceCell.offsetWidth; // triga reflow per reiniciar animació CSS
            priceCell.classList.add(changePercent >= 0 ? 'flash-up' : 'flash-down');
          }
        });
      }, 0);
    });
    
    // Recalcular i repintar tota la pantalla amb nous preus
    this.render();
  },

  // Afegir una transacció manual des del formulari
  addTransaction(event) {
    event.preventDefault();
    
    const form = event.target;
    const txId = 't_' + Date.now();
    const date = form.txDate.value;
    const assetType = form.txAssetType.value;
    const isin = form.txIsin ? form.txIsin.value.toUpperCase().trim() : '';
    const symbol = form.txSymbol.value.toUpperCase().trim();
    const name = form.txName.value.trim();
    const type = form.txType.value;
    const quantity = parseFloat(form.txQty.value);
    const price = parseFloat(form.txPrice.value);
    const commission = parseFloat(form.txCommission.value || 0);
    const currency = form.txCurrency.value;
    const notes = form.txNotes.value.trim();
    const linkCash = form.txLinkCash.checked;
    
    // Taxa de canvi simplificada
    const exchangeRate = currency === 'USD' ? 0.92 : 1.0;
    
    const newTx = {
      id: txId,
      date,
      type,
      assetType,
      isin,
      symbol,
      name,
      quantity,
      price,
      commission,
      currency,
      exchangeRate,
      notes
    };
    
    // Descomptar o afegir de l'efectiu si es demana
    const totalCostEUR = (quantity * price * exchangeRate) + commission;
    if (linkCash) {
      if (type === 'compra') {
        if (this.state.cash.balance < totalCostEUR) {
          alert("Error: No tens prou saldo en efectiu per fer aquesta compra!");
          return;
        }
        this.state.cash.balance -= totalCostEUR;
      } else if (type === 'venda') {
        this.state.cash.balance += totalCostEUR;
      }
    }
    
    // Afegir transacció a la llista
    this.state.transactions.push(newTx);
    
    // Crear preu de mercat "en viu" inicial per al nou actiu si no existeix
    if (!this.state.livePrices[symbol]) {
      this.state.livePrices[symbol] = {
        current: price,
        currency: currency,
        change: 0.0
      };
    }
    
    // Desar estat i recarregar
    this.saveState();
    this.render();
    
    // Tancar el modal
    this.closeModal('transactionModal');
    form.reset();
  },

  // Eliminar transacció
  deleteTransaction(id) {
    if (confirm("Segur que vols eliminar aquesta transacció de l'historial? (Els teus saldos es recalcularan)")) {
      this.state.transactions = this.state.transactions.filter(tx => tx.id !== id);
      this.saveState();
      this.render();
    }
  },

  // Actualitzar el compte d'efectiu directament
  updateCashBalance(event) {
    event.preventDefault();
    const amount = parseFloat(document.getElementById('newCashAmount').value);
    if (!isNaN(amount)) {
      this.state.cash.balance = amount;
      this.saveState();
      this.render();
      this.closeModal('cashModal');
    }
  },

  // Afegir objectiu
  addGoal(event) {
    event.preventDefault();
    const form = event.target;
    
    const newGoal = {
      id: 'g_' + Date.now(),
      title: form.goalTitle.value.trim(),
      target: parseFloat(form.goalTarget.value),
      deadline: form.goalDeadline.value,
      category: form.goalCategory.value,
      notes: form.goalNotes.value.trim()
    };
    
    this.state.goals.push(newGoal);
    this.saveState();
    this.render();
    this.closeModal('goalModal');
    form.reset();
  },

  // Eliminar objectiu
  deleteGoal(id) {
    if (confirm("Vols eliminar aquest objectiu financer?")) {
      this.state.goals = this.state.goals.filter(g => g.id !== id);
      this.saveState();
      this.render();
    }
  },

  // Modals obrir / tancar
  openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.add('active');
      // Per defecte configurar la data d'avui en els formularis de transaccions
      if (modalId === 'transactionModal') {
        document.getElementById('txDate').value = new Date().toISOString().substring(0, 10);
        this.updateAvailableAssetsDropdown();
        // Netejar missatges de cerca d'ISIN i preselecció anteriors
        const feedback = document.getElementById('isinSearchFeedback');
        if (feedback) feedback.style.display = 'none';
        const assetSelect = document.getElementById('txAssetSelect');
        if (assetSelect) assetSelect.value = '';
      }
    }
  },

  closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.remove('active');
  },

  // Escoltar esdeveniments del DOM
  setupEventListeners() {
    // Pestanyes actives
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const tabId = item.id.replace('nav-', '');
        this.switchTab(tabId);
      });
    });
    
    // Switch de simulació
    const simSwitch = document.getElementById('simSwitch');
    if (simSwitch) {
      simSwitch.addEventListener('change', (e) => {
        this.toggleSimulation(e.target.checked);
      });
    }
    
    // Enllaçar formularis
    const txForm = document.getElementById('addTransactionForm');
    if (txForm) txForm.addEventListener('submit', (e) => this.addTransaction(e));
    
    // Desplegable de preselecció d'actiu existent
    const assetSelect = document.getElementById('txAssetSelect');
    if (assetSelect) {
      assetSelect.addEventListener('change', (e) => {
        const val = e.target.value;
        if (!val) return;
        try {
          const asset = JSON.parse(val);
          document.getElementById('txAssetType').value = asset.assetType;
          document.getElementById('txIsin').value = asset.isin || '';
          document.getElementById('txSymbol').value = asset.symbol;
          document.getElementById('txName').value = asset.name;
          document.getElementById('txPrice').value = asset.price || '';
          document.getElementById('txCurrency').value = asset.currency || 'EUR';
          
          const feedback = document.getElementById('isinSearchFeedback');
          if (feedback) {
            feedback.style.display = 'block';
            feedback.style.color = 'var(--accent-secondary)';
            const typeLabel = asset.assetType === 'accion' ? 'Acció' : asset.assetType === 'etf' ? 'ETF' : 'Fons';
            feedback.innerHTML = `📋 **Preseleccionat:** S'han carregat les dades de **${asset.name}** (${asset.symbol}) — ${typeLabel}.`;
          }
        } catch (err) {
          console.error("Error parsing asset preselection:", err);
        }
      });
    }
    
    const cashForm = document.getElementById('updateCashForm');
    if (cashForm) cashForm.addEventListener('submit', (e) => this.updateCashBalance(e));

    const goalForm = document.getElementById('addGoalForm');
    if (goalForm) goalForm.addEventListener('submit', (e) => this.addGoal(e));

    // Formularis de Configuració i Xat IA
    const settingsForm = document.getElementById('saveSettingsForm');
    if (settingsForm) settingsForm.addEventListener('submit', (e) => this.saveSettings(e));

    const aiForm = document.getElementById('aiChatForm');
    if (aiForm) aiForm.addEventListener('submit', (e) => this.sendChatMessage(e));

    // Toggle de visibilitat de la clau d'API en la configuració
    const btnToggleVis = document.getElementById('btnToggleKeyVisibility');
    if (btnToggleVis) {
      btnToggleVis.addEventListener('click', () => {
        const keyInput = document.getElementById('settingsOpenAIKey');
        const icon = btnToggleVis.querySelector('i');
        if (keyInput.type === 'password') {
          keyInput.type = 'text';
          icon.className = 'ri-eye-line';
        } else {
          keyInput.type = 'password';
          icon.className = 'ri-eye-off-line';
        }
      });
    }

    // Escoltar càrregues de fitxers JSON
    const jsonFileInput = document.getElementById('importJSONInput');
    if (jsonFileInput) {
      jsonFileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) this.importStateFromJSON(file);
      });
    }

    // Escoltar càrregues de fitxers CSV des del selector clàssic
    const csvFileInput = document.getElementById('importCSVInput');
    if (csvFileInput) {
      csvFileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) this.importTransactionsFromCSV(file);
      });
    }

    // Configurar esdeveniments per a la zona interactiva Drag & Drop de CSV
    const csvDropZone = document.getElementById('csvDropZone');
    if (csvDropZone) {
      const dropZoneText = document.getElementById('csvDropZoneText');
      const dropZoneSubText = document.getElementById('csvDropZoneSubText');

      csvDropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        csvDropZone.classList.add('dragover');
        if (dropZoneText) dropZoneText.innerText = "Deixa anar el fitxer per importar!";
        if (dropZoneSubText) dropZoneSubText.innerText = "Formats suportats: .csv";
      });

      csvDropZone.addEventListener('dragleave', (e) => {
        e.preventDefault();
        csvDropZone.classList.remove('dragover');
        if (dropZoneText) dropZoneText.innerText = "Arrossega el teu fitxer CSV aquí";
        if (dropZoneSubText) dropZoneSubText.innerText = "o fes clic per buscar a l'ordinador";
      });

      csvDropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        csvDropZone.classList.remove('dragover');
        if (dropZoneText) dropZoneText.innerText = "Arrossega el teu fitxer CSV aquí";
        if (dropZoneSubText) dropZoneSubText.innerText = "o fes clic per buscar a l'ordinador";
        
        const file = e.dataTransfer.files[0];
        if (file && file.name.endsWith('.csv')) {
          this.importTransactionsFromCSV(file);
        } else {
          alert("Error: Només s'admeten fitxers amb extensió .csv");
        }
      });
    }
  },

  // ----------------------------------------------------
  // INTEGRACIÓ DE L'ASSESSOR DE IA (OPENAI)
  // ----------------------------------------------------

  // Actualitza l'UI de la secció d'Assessor segons si hi ha clau guardada
  updateAIChatUI() {
    const warningCard = document.getElementById('aiKeyWarning');
    const chatWrapper = document.getElementById('aiChatWrapper');
    const keyInput = document.getElementById('settingsOpenAIKey');
    const modelSelect = document.getElementById('settingsModel');
    
    // Emplenar valors existents en configuració
    if (keyInput) keyInput.value = this.state.openaiKey || '';
    if (modelSelect) modelSelect.value = this.state.openaiModel || 'gpt-4o-mini';

    if (this.state.openaiKey && this.state.openaiKey.trim() !== '') {
      if (warningCard) warningCard.style.display = 'none';
      if (chatWrapper) chatWrapper.style.display = 'flex';
      
      // Si no hi ha historial, carregar missatge de benvinguda de Franklin AI
      if (this.state.chatHistory.length === 0) {
        const initialGreeting = `Hola Marc! Soc en **Franklin AI**, el teu assessor financer virtual. 

He carregat en temps real totes les dades de la teva cartera: **accions**, **ETFs**, **fons d'inversió**, **comptes d'efectiu** i **objectius financers**.

Com et puc ajudar avui? Puc:
* Realitzar una **auditoria completa** de la diversificació del teu patrimoni.
* Analitzar si els teus estalvis actuals són viables per aconseguir l'**entrada de l'habitatge** o la teva **llibertat financera**.
* Recomanar-te estratègies de **rebalanceig** segons el teu perfil de risc.

Si us plau, selecciona una de les accions ràpides de dalt o escriu qualsevol dubte que tinguis al quadre de text inferior.`;
        
        this.addMessageToChatLog('ai', initialGreeting);
        this.state.chatHistory.push({ role: 'assistant', content: initialGreeting });
      }
    } else {
      if (warningCard) warningCard.style.display = 'flex';
      if (chatWrapper) chatWrapper.style.display = 'none';
    }
  },

  // Desar configuració d'API i model
  saveSettings(event) {
    event.preventDefault();
    const key = document.getElementById('settingsOpenAIKey').value.trim();
    const model = document.getElementById('settingsModel').value;

    this.state.openaiKey = key;
    this.state.openaiModel = model;
    
    this.saveState();
    alert("Paràmetres desar-se correctament! Ja pots utilitzar l'Assessor d'IA.");
    
    this.updateAIChatUI();
    this.switchTab('resum');
  },

  // Enviament automàtic de preguntes predefinides
  sendQuickPrompt(promptText) {
    const input = document.getElementById('aiMessageInput');
    if (input) {
      input.value = promptText;
      const form = document.getElementById('aiChatForm');
      if (form) {
        // Simular el submit
        const event = new Event('submit', { cancelable: true });
        form.dispatchEvent(event);
      }
    }
  },

  // Afegir bombolla de missatge a la pantalla de xat
  addMessageToChatLog(role, text) {
    const chatLog = document.getElementById('aiChatLog');
    if (!chatLog) return;

    const messageRow = document.createElement('div');
    messageRow.className = `chat-message ${role}`;
    
    const avatar = document.createElement('div');
    avatar.className = 'chat-avatar';
    avatar.innerHTML = role === 'user' ? '<i class="ri-user-line"></i>' : '<i class="ri-brain-line"></i>';
    
    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble';
    bubble.innerHTML = this.parseMarkdown(text);
    
    messageRow.appendChild(avatar);
    messageRow.appendChild(bubble);
    
    chatLog.appendChild(messageRow);
    
    // Desplaçar cap avall de forma suau
    chatLog.scrollTop = chatLog.scrollHeight;
  },

  // Renderitzador bàsic i segur de Markdown a HTML natiu
  parseMarkdown(text) {
    let html = text;
    // Escapar tags per seguretat excepte els que nosaltres creem
    html = html
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    // Negreta: **text**
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    
    // Elements de codi en línia: `codi`
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    
    // Blocs de codi preformatats: ```codi```
    html = html.replace(/```([^`]+)```/g, '<pre><code>$1</code></pre>');

    // Punts de llista: * text
    html = html.replace(/^\*\s+([^\n]+)/gm, '<li>$1</li>');
    // Agrupar els <li> continus dins d'un <ul>
    html = html.replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>');
    
    // Salts de línia
    html = html.replace(/\n/g, '<br>');
    
    // Corregir salts de línia dins d'estructures de llista
    html = html.replace(/<\/ul><br><ul>/g, '');
    html = html.replace(/<\/li><br><li>/g, '</li><li>');

    return html;
  },

  // Genera un instantània detallada de la cartera en format textual per a la IA
  generatePortfolioSnapshot(holdings, metrics) {
    let snapshot = `INFORMACIÓ DE LA CARTERA EN TEMPS REAL DEL CLIENT Marc (Avui: ${new Date().toISOString().substring(0,10)}):
- Patrimoni Net Total: ${metrics.netWorth.toLocaleString('ca-ES', {style:'currency', currency:'EUR'})}
- Líquid/Efectiu: ${metrics.cashBalance.toLocaleString('ca-ES', {style:'currency', currency:'EUR'})}
- Total Capital Invertit: ${metrics.totalInvested.toLocaleString('ca-ES', {style:'currency', currency:'EUR'})}
- Plusvàlua Latent Total: ${metrics.totalProfit.toLocaleString('ca-ES', {style:'currency', currency:'EUR'})}
- Rendibilitat Global Ponderada: ${metrics.overallYield.toFixed(2)}%

REPARTIMENT PER ACTIUS:
- Accions: Invertit ${metrics.accions.invested.toLocaleString('ca-ES', {style:'currency', currency:'EUR'})} (Valor actual: ${metrics.accions.value.toLocaleString('ca-ES', {style:'currency', currency:'EUR'})})
- ETFs: Invertit ${metrics.etfs.invested.toLocaleString('ca-ES', {style:'currency', currency:'EUR'})} (Valor actual: ${metrics.etfs.value.toLocaleString('ca-ES', {style:'currency', currency:'EUR'})})
- Fons d'Inversió: Invertit ${metrics.fons.invested.toLocaleString('ca-ES', {style:'currency', currency:'EUR'})} (Valor actual: ${metrics.fons.value.toLocaleString('ca-ES', {style:'currency', currency:'EUR'})})

LLISTAT DE POSICIONS ACTIVES DE LA CARTERA:`;

    holdings.forEach(h => {
      snapshot += `
* [${h.assetType.toUpperCase()}] Símbol: ${h.symbol} | Nom: ${h.name} | Unitats: ${h.shares.toFixed(4)} | Preu Compra Mitjà (EUR): ${h.avgPriceEUR.toFixed(2)}€ | Preu Cotització Actual: ${(h.livePriceEUR).toFixed(2)}€ | Valor de Mercat Total (EUR): ${h.currentValueEUR.toFixed(2)}€ | Guany/Pèrdua (%): ${h.profitPercent.toFixed(2)}% (${h.profitEUR.toFixed(2)}€) | Variació Diària: ${h.dailyChange}%`;
    });

    snapshot += `\n\nOBJECTIUS FINANCERS DE L'USUARI:`;
    this.state.goals.forEach(g => {
      let allocated = 0;
      if (g.title.toLowerCase().includes('emergència')) {
        allocated = this.state.cash.balance;
      } else if (g.title.toLowerCase().includes('llibertat')) {
        allocated = metrics.netWorth;
      } else {
        allocated = Math.min(g.target, metrics.netWorth * 0.15);
      }
      const percent = (allocated / g.target) * 100;
      snapshot += `
* Metes: "${g.title}" | Categoria: ${g.category} | Import Objectiu: ${g.target.toLocaleString('ca-ES')}€ | Assolit: ${allocated.toLocaleString('ca-ES')}€ (${percent.toFixed(0)}%) | Límit: ${g.deadline} | Notes: ${g.notes}`;
    });

    return snapshot;
  },

  // Enviament i petició a l'API d'OpenAI
  async sendChatMessage(event) {
    event.preventDefault();
    
    const input = document.getElementById('aiMessageInput');
    const userMessageText = input.value.trim();
    if (!userMessageText) return;

    // Afegir missatge de l'usuari a la pantalla i buidar input
    this.addMessageToChatLog('user', userMessageText);
    input.value = '';

    // Afegir al nostre historial de xat
    this.state.chatHistory.push({ role: 'user', content: userMessageText });

    // Preparar indicació visual de càrrega
    const chatLog = document.getElementById('aiChatLog');
    const loadingRow = document.createElement('div');
    loadingRow.className = 'chat-message ai';
    loadingRow.id = 'aiChatLoadingIndicator';
    loadingRow.innerHTML = `
      <div class="chat-avatar"><i class="ri-brain-line"></i></div>
      <div class="chat-bubble" style="padding: 0.6rem 1rem;">
        <div class="typing-indicator">
          <div class="typing-dot"></div>
          <div class="typing-dot"></div>
          <div class="typing-dot"></div>
        </div>
      </div>
    `;
    chatLog.appendChild(loadingRow);
    chatLog.scrollTop = chatLog.scrollHeight;

    // Generar el context financer en temps real
    const holdings = this.calculateHoldings();
    const metrics = this.calculateMetrics(holdings);
    const portfolioSnapshot = this.generatePortfolioSnapshot(holdings, metrics);

    // Prompt del sistema complet
    const systemPrompt = `Ets en Franklin AI, un assessor financer virtual, personal, professional, pràctic i extremadament analític. 
La teva missió és ajudar a l'usuari Marc a fer el seguiment de les seves inversions i estalvis, oferint consells sòlids però recordant que no ets un assessor financer certificat i que tota inversió comporta riscos.
Totes les teves respostes han de ser en **Català**, amb un estil educat, rigorós, encoratjador i empàtic.

Tens accés complet a les seves dades financeres actuals en temps real:
${portfolioSnapshot}

Instruccions de format:
- Fes servir un format estructurat amb punts, llistes o taules quan analitzis dades numèriques per fer-ho fàcil de llegir.
- Destaca els valors clau en negreta.
- Sigues concís i no facis textos extremadament llargs.
- Analitza accions específiques (com Apple, Nvidia, ASML) citant el seu ticker si l'usuari et pregunta dades o diversificació.
- Utilitza emoticones per fer la conversa propera i dinàmica.`;

    // Trucada a OpenAI
    try {
      const messages = [
        { role: 'system', content: systemPrompt },
        ...this.state.chatHistory.slice(-6) // Retenir les darreres 3 anades i tornades
      ];

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.state.openaiKey}`
        },
        body: JSON.stringify({
          model: this.state.openaiModel || 'gpt-4o-mini',
          messages: messages,
          temperature: 0.7
        })
      });

      // Retirar l'indicador de càrrega
      const loadingIndicator = document.getElementById('aiChatLoadingIndicator');
      if (loadingIndicator) loadingIndicator.remove();

      if (!response.ok) {
        const errData = await response.json();
        const errCode = errData.error ? errData.error.message : 'Error desconegut';
        throw new Error(`OpenAI API Error: ${errCode}`);
      }

      const resData = await response.json();
      const aiReply = resData.choices[0].message.content;

      // Afegir missatge a la pantalla i desar historial
      this.addMessageToChatLog('ai', aiReply);
      this.state.chatHistory.push({ role: 'assistant', content: aiReply });

    } catch (error) {
      console.error("Error trucant a OpenAI:", error);
      
      // Retirar l'indicador de càrrega si encara hi és
      const loadingIndicator = document.getElementById('aiChatLoadingIndicator');
      if (loadingIndicator) loadingIndicator.remove();

      const errorMessage = `⚠️ **Error de connexió amb OpenAI:**
No hem pogut connectar correctament. Si us plau, verifica:
1. Que la teva clau de l'API introduïda a la pestanya de **Configuració** sigui vàlida.
2. Que la teva clau tingui crèdit/saldos de pagament disponibles al tauler de control d'OpenAI.
3. Detall de l'error: \`${error.message}\``;

      this.addMessageToChatLog('ai', errorMessage);
    }
  },

  // ----------------------------------------------------
  // GESTIÓ DE FITXERS: IMPORTACIÓ I EXPORTACIÓ
  // ----------------------------------------------------

  // A. Exportació en format JSON de tot l'estat actual
  exportStateToJSON() {
    const backup = {
      cash: this.state.cash,
      goals: this.state.goals,
      transactions: this.state.transactions,
      openaiKey: this.state.openaiKey,
      openaiModel: this.state.openaiModel
    };

    const jsonStr = JSON.stringify(backup, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `franklin_finances_backup_${new Date().toISOString().substring(0,10)}.json`;
    document.body.appendChild(a);
    a.click();
    
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  // B. Importació de còpia de seguretat JSON
  importStateFromJSON(file) {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const importedData = JSON.parse(e.target.result);
        
        // Validació estructural bàsica
        if (!importedData.transactions || !Array.isArray(importedData.transactions) || !importedData.cash) {
          throw new Error("El format del fitxer JSON no és compatible amb Franklin Finances.");
        }

        const confirmOverwrite = confirm("⚠️ ATENCIÓ: Estàs a punt d'importar una còpia de seguretat completa. Això substituirà de cop totes les teves dades actives al dashboard (transaccions, objectius, efectiu i configuracions d'IA). Vols continuar?");
        
        if (confirmOverwrite) {
          this.state.cash = importedData.cash;
          this.state.goals = importedData.goals || [];
          this.state.transactions = importedData.transactions;
          this.state.openaiKey = importedData.openaiKey || '';
          this.state.openaiModel = importedData.openaiModel || 'gpt-4o-mini';
          this.state.chatHistory = []; // Reset del xat actiu
          
          this.saveState();
          this.render();
          this.updateAIChatUI();
          
          alert("🎉 Còpia de seguretat restaurada amb èxit!");
          this.switchTab('resum');
        }
      } catch (err) {
        console.error("Error important JSON:", err);
        alert(`Error: No s'ha pogut importar el fitxer JSON. (${err.message})`);
      }
    };
    reader.readAsText(file);
  },

  // C. Descàrrega directa de la plantilla CSV interactiva en Català (amb UTF-8 BOM per a Excel)
  downloadCSVTemplate() {
    const csvContent = "\ufeffACTIU,TIPUS,ACCIONS,PREU MIG,TOTAL X COMPRA,PREU ARA €,PREU $,TOTAL ACTUAL,RENDIMENT,%,PES CARTERA\n" +
                       "AAPL,Acció,15,165.50,2283.90,188.42,188.42,2600.19,316.29,13.85,10.25\n" +
                       "VWCE,ETF,80,98.50,7880.00,112.40,,8992.00,1112.00,14.11,35.45\n" +
                       "VANG-GLOB,Fons,510.204,24.50,12500.00,28.20,,14387.75,1887.75,15.10,54.30\n";
                       
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = "franklin_cartera_plantilla.csv";
    document.body.appendChild(a);
    a.click();
    
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  // D. Processament i càrrega de fitxers CSV de transaccions o de posicions consolidades
  importTransactionsFromCSV(file) {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target.result;
        const lines = text.split(/\r?\n/);
        if (lines.length < 2) {
          throw new Error("El fitxer CSV està buit o no conté prou línies.");
        }

        // Processar capçalera
        const headers = lines[0].replace(/^\ufeff/, '').split(',').map(h => h.trim().toLowerCase());
        
        // Detectar si és format de posicions actuals (holdings summary) o historial de transaccions
        const isHoldingsFormat = headers.includes('actiu') && headers.includes('accions') && headers.includes('preu mig');

        let importCount = 0;
        const timestamp = Date.now();
        const avui = new Date().toISOString().substring(0, 10);

        if (isHoldingsFormat) {
          // FORMAT A: Resum de Posicions (Holdings Summary)
          const idxActiu = headers.indexOf('actiu');
          const idxTipus = headers.indexOf('tipus'); // Nova columna per diferenciar tipus d'actiu
          const idxAccions = headers.indexOf('accions');
          const idxPreuMig = headers.indexOf('preu mig');
          const idxPreuAraEUR = headers.indexOf('preu ara €');
          const idxPreuUSD = headers.indexOf('preu $');

          if (idxActiu === -1 || idxAccions === -1 || idxPreuMig === -1) {
            throw new Error("Manquen columnes clau en el format de cartera (ACTIU, ACCIONS, PREU MIG).");
          }

          // Recórrer files
          for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            const cols = line.split(',').map(col => col.replace(/^["']|["']$/g, '').trim());
            if (cols.length < 3) continue;

            const symbol = cols[idxActiu].toUpperCase();
            const quantity = parseFloat(cols[idxAccions]);
            const price = parseFloat(cols[idxPreuMig]);

            if (!symbol || isNaN(quantity) || isNaN(price) || quantity <= 0) continue;

            // Determinar divisa
            let currency = 'EUR';
            let exchangeRate = 1.0;
            if (['AAPL', 'NVDA', 'MSFT', 'TSLA'].includes(symbol) || (idxPreuUSD !== -1 && cols[idxPreuUSD] && !isNaN(parseFloat(cols[idxPreuUSD])))) {
              currency = 'USD';
              exchangeRate = 0.92;
            }

            // Mapeig de noms coneguts per donar-li qualitat
            let name = symbol;
            if (symbol === 'AAPL') name = 'Apple Inc.';
            else if (symbol === 'NVDA') name = 'NVIDIA Corporation';
            else if (symbol === 'MSFT') name = 'Microsoft Corporation';
            else if (symbol === 'ASML') name = 'ASML Holding N.V.';
            else if (symbol === 'VWCE') name = 'Vanguard FTSE All-World UCITS ETF';
            else if (symbol === 'CSSPX') name = 'iShares Core S&P 500 UCITS ETF';
            else if (symbol === 'VAN-GL' || symbol === 'VANG-GLOB') name = 'Vanguard Global Stock Index Fund Investor EUR Accumulation';
            else if (symbol === 'VAN-EM' || symbol === 'VANG-EMRG') name = 'Vanguard Emerging Markets Stock Index Fund Investor EUR Accumulation';
            else if (symbol === 'VAN-SC' || symbol === 'VANG-SC') name = 'Vanguard Global Small-Cap Index Fund USD Accumulation';
            else if (symbol === 'CRE-RF') name = 'Creand Renta Fija Mixta, FI R';
            else if (symbol === 'POL-HE') name = 'Polar Capital Healthcare Opportunities Fund Class I';
            else if (symbol === 'AMUN-MSCI') name = 'Amundi Index MSCI World Fund';

            // Determinar tipus d'actiu explicitament o per auto-detecció intel·ligent
            let assetType = 'accion';
            if (idxTipus !== -1 && cols[idxTipus]) {
              const typeRaw = cols[idxTipus].toLowerCase();
              if (typeRaw.includes('etf')) assetType = 'etf';
              else if (typeRaw.includes('fon') || typeRaw.includes('fund')) assetType = 'fons';
              else if (typeRaw.includes('acci') || typeRaw.includes('stock') || typeRaw.includes('share')) assetType = 'accion';
            } else {
              // Auto-detecció per defecte basada en els símbols més populars
              if (['VWCE', 'CSSPX'].includes(symbol)) assetType = 'etf';
              else if (['VANG-GLOB', 'VAN-GL', 'VAN-EM', 'VAN-SC', 'CRE-RF', 'POL-HE', 'AMUN-MSCI'].includes(symbol)) assetType = 'fons';
            }

            // Eliminar transaccions antigues d'aquest mateix símbol per evitar duplicats en consolidar
            this.state.transactions = this.state.transactions.filter(tx => tx.symbol !== symbol);

            const newTx = {
              id: `t_csv_h_${timestamp}_${i}`,
              date: avui,
              type: 'compra',
              assetType,
              symbol,
              name,
              quantity,
              price,
              commission: 0,
              currency,
              exchangeRate,
              notes: 'Importat com a posició consolidada'
            };

            this.state.transactions.push(newTx);

            // Establir preu en viu actualitzat si es troba al CSV
            const livePriceStr = idxPreuAraEUR !== -1 ? cols[idxPreuAraEUR] : '';
            const livePrice = livePriceStr && !isNaN(parseFloat(livePriceStr)) ? parseFloat(livePriceStr) : price;
            
            this.state.livePrices[symbol] = {
              current: livePrice,
              currency: currency,
              change: 0.0
            };

            importCount++;
          }

        } else {
          // FORMAT B: Historial clàssic de Transaccions
          const getIndex = (aliases) => headers.findIndex(h => aliases.some(alias => h.includes(alias)));
          const idxDate = getIndex(['data', 'date']);
          const idxType = getIndex(['tipus', 'type']);
          const idxAsset = getIndex(['actiu', 'asset']);
          const idxSymbol = getIndex(['símbol', 'simbol', 'symbol', 'ticker']);
          const idxName = getIndex(['nom', 'name']);
          const idxQty = getIndex(['quantitat', 'qty', 'quantity']);
          const idxPrice = getIndex(['preu', 'price']);
          const idxComm = getIndex(['comissió', 'comissio', 'commission']);
          const idxCurr = getIndex(['divisa', 'currency']);
          const idxNotes = getIndex(['notes', 'comentaris', 'comment']);

          if (idxDate === -1 || idxType === -1 || idxSymbol === -1 || idxQty === -1 || idxPrice === -1) {
            throw new Error("El fitxer CSV de transaccions no conté les columnes obligatòries (Data, Tipus, Símbol, Quantitat, Preu).");
          }

          for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            const cols = line.split(',').map(col => col.replace(/^["']|["']$/g, '').trim());
            if (cols.length < 5) continue;

            const date = cols[idxDate];
            const type = cols[idxType].toLowerCase();
            const assetTypeRaw = idxAsset !== -1 ? cols[idxAsset].toLowerCase() : 'accion';
            const symbol = cols[idxSymbol].toUpperCase();
            const name = idxName !== -1 ? cols[idxName] : symbol;
            const quantity = parseFloat(cols[idxQty]);
            const price = parseFloat(cols[idxPrice]);
            const commission = idxComm !== -1 ? parseFloat(cols[idxComm] || 0) : 0;
            const currency = idxCurr !== -1 ? cols[idxCurr].toUpperCase() : 'EUR';
            const notes = idxNotes !== -1 ? cols[idxNotes] : 'Importat per CSV';

            if (isNaN(quantity) || isNaN(price) || !date || !symbol) continue;

            let assetType = 'accion';
            if (assetTypeRaw.includes('etf')) assetType = 'etf';
            else if (assetTypeRaw.includes('fon')) assetType = 'fons';

            let opType = 'compra';
            if (type.includes('ven') || type.includes('sell')) opType = 'venda';

            const exchangeRate = currency === 'USD' ? 0.92 : 1.0;

            const newTx = {
              id: `t_csv_tx_${timestamp}_${i}`,
              date,
              type: opType,
              assetType,
              symbol,
              name,
              quantity,
              price,
              commission,
              currency,
              exchangeRate,
              notes
            };

            this.state.transactions.push(newTx);

            if (!this.state.livePrices[symbol]) {
              this.state.livePrices[symbol] = {
                current: price,
                currency: currency,
                change: 0.0
              };
            }

            importCount++;
          }
        }

        if (importCount > 0) {
          this.saveState();
          this.render();
          alert(`🎉 S'han importat amb èxit ${importCount} posicions/transaccions de cartera des del CSV!`);
          this.switchTab(isHoldingsFormat ? 'resum' : 'transaccions');
        } else {
          alert("⚠️ No s'han trobat línies de dades vàlides per importar. Verifica el fitxer.");
        }

      } catch (err) {
        console.error("Error processant fitxer CSV:", err);
        alert(`Error de lectura CSV: ${err.message}`);
      }
    };
    reader.readAsText(file, "UTF-8");
  },

  // E. Exportació dinàmica de les posicions de cartera actives a CSV (amb el format exacte demanat)
  exportHoldingsToCSV() {
    const holdings = this.calculateHoldings();
    const metrics = this.calculateMetrics(holdings);
    
    // Capçaleres exactes demanades (incloent TIPUS per poder diferenciar accions, ETFs i fons)
    let csvContent = "\ufeffACTIU,TIPUS,ACCIONS,PREU MIG,TOTAL X COMPRA,PREU ARA €,PREU $,TOTAL ACTUAL,RENDIMENT,%,PES CARTERA\n";
    
    holdings.forEach(h => {
      const pes = metrics.netWorth > 0 ? ((h.currentValueEUR / metrics.netWorth) * 100) : 0;
      const preuUSD = h.currency === 'USD' ? h.livePrice : '';
      const preuMigOriginal = h.avgPriceEUR / h.exchangeRate;
      
      let tipusStr = 'Acció';
      if (h.assetType === 'etf') tipusStr = 'ETF';
      else if (h.assetType === 'fons') tipusStr = 'Fons';
      
      csvContent += `${h.symbol},` +
                    `${tipusStr},` +
                    `${h.shares.toFixed(4)},` +
                    `${preuMigOriginal.toFixed(2)},` +
                    `${h.totalCost.toFixed(2)},` +
                    `${h.livePriceEUR.toFixed(2)},` +
                    `${preuUSD ? preuUSD.toFixed(2) : ''},` +
                    `${h.currentValueEUR.toFixed(2)},` +
                    `${h.profitEUR.toFixed(2)},` +
                    `${h.profitPercent.toFixed(2)},` +
                    `${pes.toFixed(2)}\n`;
    });
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `franklin_cartera_activa_${new Date().toISOString().substring(0,10)}.csv`;
    document.body.appendChild(a);
    a.click();
    
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  // F. Eliminar completament totes les transaccions d'un actiu de la cartera
  deleteHolding(symbol) {
    if (confirm(`⚠️ ATENCIÓ: Estàs a punt d'eliminar completament l'actiu ${symbol} de la teva cartera. Això esborrarà totes les transaccions de compra/venda vinculades a ell. Vols continuar?`)) {
      this.state.transactions = this.state.transactions.filter(tx => tx.symbol !== symbol);
      this.saveState();
      this.render();
      this.updateAIChatUI();
    }
  },

  // G. Netejar completament totes les dades actives
  clearAllData() {
    if (confirm("⚠️ ATENCIÓ: Estàs a punt d'esborrar absolutament totes les dades del teu dashboard (efectiu, transaccions, objectius, preus de mercat i historial de xat). Aquesta acció no es pot desfer. Vols continuar?")) {
      this.state.cash = { balance: 0.00, currency: 'EUR' };
      this.state.goals = [];
      this.state.transactions = [];
      this.state.livePrices = {};
      this.state.chatHistory = [];
      
      this.saveState();
      this.render();
      this.updateAIChatUI();
      
      alert("🗑️ S'han esborrat correctament totes les dades. La cartera s'ha restablert a zero.");
    }
  },

  // H. Càrrega des de l'àrea d'enganxat de cada pestanya
  importFromTabPasteArea(areaId, assetType) {
    const textarea = document.getElementById(`pasteArea-${areaId}`);
    if (!textarea) return;
    
    const text = textarea.value.trim();
    if (!text) {
      alert("⚠️ Si us plau, enganxa algunes dades primer al quadre de text.");
      return;
    }
    
    this.parseAndImportCSVText(text, assetType);
    textarea.value = '';
  },

  // I. Càrrega des d'un selector de fitxers de pestanya
  importFromTabFileInput(inputEl, assetType) {
    const file = inputEl.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      this.parseAndImportCSVText(text, assetType);
      inputEl.value = '';
    };
    reader.readAsText(file, "UTF-8");
  },

  // J. Processador comú per a les dades importades des d'una pestanya específica (CSV / Text enganxat)
  parseAndImportCSVText(text, assetType) {
    // Definir netejador de nombres general (inclou estripar % i + per robustesa)
    const cleanNumber = (val) => {
      if (!val) return NaN;
      let cleaned = val.replace(/\s/g, '').replace(/[+%]/g, '');
      if (cleaned.includes(',') && cleaned.includes('.')) {
        if (cleaned.indexOf(',') < cleaned.indexOf('.')) {
          cleaned = cleaned.replace(/,/g, '');
        } else {
          cleaned = cleaned.replace(/\./g, '').replace(',', '.');
        }
      } else if (cleaned.includes(',')) {
        cleaned = cleaned.replace(',', '.');
      }
      return parseFloat(cleaned);
    };

    try {
      const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
      if (lines.length === 0) {
        throw new Error("El text o fitxer està buit.");
      }

      // Delimitadors possibles: tabulació, coma, punt i coma
      // Mirem si la primera fila conté capçaleres reconegudes
      const firstLineRaw = lines[0];
      const delimiters = ['\t', ';', ','];
      let chosenDelimiter = ',';
      
      // Triem el delimitador que aparegui més cops a la primera línia
      let maxCount = -1;
      delimiters.forEach(d => {
        const count = (firstLineRaw.split(d).length - 1);
        if (count > maxCount) {
          maxCount = count;
          chosenDelimiter = d;
        }
      });

      const firstLineCols = firstLineRaw.split(chosenDelimiter).map(c => c.replace(/^["']|["']$/g, '').trim().toLowerCase());
      
      // Criteris de reconeixement de capçaleres (incloent columnes del format de fons especial)
      const hasHeader = firstLineCols.some(c => 
        c.includes('actiu') || c.includes('symbol') || c.includes('ticker') || 
        c.includes('accions') || c.includes('unitats') || c.includes('shares') || c.includes('participacions') ||
        c.includes('preu') || c.includes('avg') || c.includes('mig') ||
        c.includes('creix') || c === 'total' || c.includes('nom fons') || c === 'isin'
      );

      let idxSymbol = 0;
      let idxQty = 1;
      let idxPrice = 2;
      let idxLivePrice = -1;
      let idxTipus = -1;
      let dataLines = lines;

      let isSpecialFonsFormat = false;
      let isSimpleFonsFormat = false;
      let fonsTotalIdx = -1, fonsGrowthIdx = -1, fonsNameIdx = -1, fonsIsinIdx = -1;
      let fonsUltimIdx = -1;

      if (hasHeader) {
        dataLines = lines.slice(1);
        
        // Mapeig de capçaleres per al format especial de fons de l'usuari: TOTAL, % CREIX, NOM FONS, ISIN
        fonsTotalIdx = firstLineCols.findIndex(c => c === 'total');
        fonsGrowthIdx = firstLineCols.findIndex(c => c.includes('% creix') || c.includes('creix') || c.includes('%'));
        fonsNameIdx = firstLineCols.findIndex(c => c.includes('nom') || c.includes('name'));
        fonsIsinIdx = firstLineCols.findIndex(c => c.includes('isin'));
        fonsUltimIdx = firstLineCols.findIndex(c => c.includes('ultim') || c.includes('últim') || c.includes('valor'));

        if (assetType === 'fons') {
          if (fonsTotalIdx !== -1 && fonsGrowthIdx !== -1) {
            isSpecialFonsFormat = true;
          } else if (fonsUltimIdx !== -1 && fonsIsinIdx !== -1) {
            isSimpleFonsFormat = true;
          }
        }

        if (!isSpecialFonsFormat && !isSimpleFonsFormat) {
          // Mapeig de capçaleres estàndard intel·ligent amb exclusions per evitar barrejar TOTALS amb unitaris!
          const getIdx = (keywords, excludeKeywords = []) => {
            return firstLineCols.findIndex(c => {
              const matchesKey = keywords.some(k => c.includes(k));
              const matchesExclude = excludeKeywords.some(e => c.includes(e));
              return matchesKey && !matchesExclude;
            });
          };
          
          const sIdx = getIdx(['actiu', 'symbol', 'simbol', 'ticker']);
          if (sIdx !== -1) idxSymbol = sIdx;
          
          const qIdx = getIdx(['accions', 'unitats', 'shares', 'participacions', 'qty', 'quantity', 'nº', 'nombre'], ['preu', 'total', 'actual', 'val', 'mig']);
          if (qIdx !== -1) idxQty = qIdx;
          
          const pIdx = getIdx(['preu mig', 'compra', 'cost', 'avg price', 'wac', 'vna compra', 'preu'], ['total', 'actual', 'ara', 'ara €', 'ara e', 'pes', 'portfolio']);
          if (pIdx !== -1) idxPrice = pIdx;
          
          const lIdx = getIdx(['preu ara', 'actual', 'live', 'vna actual', 'preu $', 'preu usd'], ['total', 'mig', 'compra', 'cost', 'wac']);
          if (lIdx !== -1) idxLivePrice = lIdx;

          const tIdx = getIdx(['tipus', 'type']);
          if (tIdx !== -1) idxTipus = tIdx;
        }
      } else {
        // No header row - analitzem la primera fila de dades de mostra per assignar índexs fallbacks intel·ligents!
        const sampleCols = lines[0].split(chosenDelimiter).map(col => col.replace(/^["']|["']$/g, '').trim());
        
        if (assetType === 'fons') {
          if (sampleCols.length >= 3) {
            const val0 = cleanNumber(sampleCols[0]);
            const val1 = cleanNumber(sampleCols[1]);
            // Si les dues primeres columnes són números, és el format [TOTAL, % CREIX, NOM FONS, ISIN]
            if (!isNaN(val0) && !isNaN(val1)) {
              isSpecialFonsFormat = true;
              fonsTotalIdx = 0;
              fonsGrowthIdx = 1;
              fonsNameIdx = 2;
              fonsIsinIdx = sampleCols.length >= 4 ? 3 : -1;
            } else {
              const val2 = cleanNumber(sampleCols[2]);
              // Si la primera és codi ISIN (normalment té lletres i números i >= 9) i la tercera és número (últim valor)
              if (!isNaN(val2) && sampleCols[0].length >= 9) {
                isSimpleFonsFormat = true;
                fonsIsinIdx = 0;
                fonsNameIdx = 1;
                fonsUltimIdx = 2;
              }
            }
          }
        }

        if (!isSpecialFonsFormat && !isSimpleFonsFormat) {
          idxSymbol = 0;
          idxQty = 1;
          idxPrice = 2;
          idxLivePrice = -1;

          if (sampleCols.length >= 4) {
            const isCol1Numeric = !isNaN(parseFloat(sampleCols[1].replace(',', '.')));
            if (!isCol1Numeric && sampleCols.length >= 4) {
              idxQty = 2;
              idxPrice = 3;
              if (sampleCols.length >= 6) {
                idxLivePrice = 5;
              }
              idxTipus = 1;
            } else {
              if (sampleCols.length >= 5) {
                idxLivePrice = 4;
              } else {
                const p3 = parseFloat(sampleCols[3].replace(',', '.'));
                const q = parseFloat(sampleCols[1].replace(',', '.'));
                const p = parseFloat(sampleCols[2].replace(',', '.'));
                if (!isNaN(p3) && !isNaN(q) && !isNaN(p)) {
                  const estTotal = q * p;
                  if (Math.abs(p3 - estTotal) < (estTotal * 0.05)) {
                    idxLivePrice = -1;
                  } else {
                    idxLivePrice = 3;
                  }
                }
              }
            }
          }
        }
      }

      let importCount = 0;
      const timestamp = Date.now();
      const avui = new Date().toISOString().substring(0, 10);

      dataLines.forEach((line, index) => {
        const cols = line.split(chosenDelimiter).map(col => col.replace(/^["']|["']$/g, '').trim());
        
        if (isSpecialFonsFormat) {
          if (cols.length <= Math.max(fonsTotalIdx, fonsGrowthIdx)) return;
          
          const total = cleanNumber(cols[fonsTotalIdx]);
          const growthPercent = cleanNumber(cols[fonsGrowthIdx]);
          const name = fonsNameIdx !== -1 && cols[fonsNameIdx] ? cols[fonsNameIdx] : 'Fons d\'Inversió';
          const isin = fonsIsinIdx !== -1 && cols[fonsIsinIdx] ? cols[fonsIsinIdx].toUpperCase() : '';
          
          if (isNaN(total) || isNaN(growthPercent) || total <= 0) return;
          
          let symbol = '';
          let finalName = name;
          if (isin) {
            const knownAsset = this.isinDatabase[isin];
            if (knownAsset) {
              symbol = knownAsset.symbol;
              finalName = knownAsset.name;
            } else {
              symbol = isin.slice(0, 6) + isin.slice(-2);
            }
          } else {
            symbol = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 5);
          }
          
          // Reconstrucció matemàtica perfecta: total cost, quantitat, preu
          const growthRate = growthPercent / 100;
          const totalCost = total / (1 + growthRate);
          const price = 10.00;
          const quantity = totalCost / price;
          const livePrice = price * (1 + growthRate);
          
          // Esborrar transaccions prèvies d'aquest símbol per consolidar la posició neta
          this.state.transactions = this.state.transactions.filter(tx => tx.symbol !== symbol);
          
          const newTx = {
            id: `t_tab_fons_spec_${timestamp}_${index}`,
            date: avui,
            type: 'compra',
            assetType: 'fons',
            isin,
            symbol,
            name: finalName,
            quantity,
            price,
            commission: 0,
            currency: 'EUR',
            exchangeRate: 1.0,
            notes: 'Importat especial de fons (TOTAL + % CREIX)'
          };
          
          this.state.transactions.push(newTx);
          
          this.state.livePrices[symbol] = {
            current: livePrice,
            currency: 'EUR',
            change: 0.0
          };
          
          importCount++;
        } else if (isSimpleFonsFormat) {
          if (cols.length <= Math.max(fonsIsinIdx, fonsUltimIdx)) return;
          
          const isin = cols[fonsIsinIdx].trim().toUpperCase();
          const name = fonsNameIdx !== -1 && cols[fonsNameIdx] ? cols[fonsNameIdx].trim() : 'Fons d\'Inversió';
          const ultimValor = cleanNumber(cols[fonsUltimIdx]);
          
          if (!isin || isNaN(ultimValor) || ultimValor <= 0) return;
          
          let symbol = '';
          let finalName = name;
          const knownAsset = this.isinDatabase[isin];
          if (knownAsset) {
            symbol = knownAsset.symbol;
            finalName = knownAsset.name;
          } else {
            symbol = isin.replace(/[^A-Z0-9]/g, '').slice(0, 6) + isin.slice(-2);
          }
          
          // Esborrar transaccions prèvies d'aquest símbol per consolidar la posició neta
          this.state.transactions = this.state.transactions.filter(tx => tx.symbol !== symbol);
          
          const newTx = {
            id: `t_tab_fons_simple_${timestamp}_${index}`,
            date: avui,
            type: 'compra',
            assetType: 'fons',
            isin,
            symbol,
            name: finalName,
            quantity: 1,
            price: ultimValor,
            commission: 0,
            currency: 'EUR',
            exchangeRate: 1.0,
            notes: 'Importat de fons (ISIN + NOM + ÚLTIM VALOR)'
          };
          
          this.state.transactions.push(newTx);
          
          this.state.livePrices[symbol] = {
            current: ultimValor,
            currency: 'EUR',
            change: 0.0
          };
          
          importCount++;
        } else {
          if (cols.length <= Math.max(idxSymbol, idxQty, idxPrice)) return;

          const symbol = cols[idxSymbol].toUpperCase();
          const quantity = cleanNumber(cols[idxQty]);
          const price = cleanNumber(cols[idxPrice]);

          if (!symbol || isNaN(quantity) || isNaN(price) || quantity <= 0 || price <= 0) return;

          // Auto-detecció de tipus d'actiu si s'inclou la columna, altrament respecta assetType
          let rowAssetType = assetType;
          if (idxTipus !== -1 && cols[idxTipus]) {
            const typeRaw = cols[idxTipus].toLowerCase();
            if (typeRaw.includes('etf')) rowAssetType = 'etf';
            else if (typeRaw.includes('fon') || typeRaw.includes('fund')) rowAssetType = 'fons';
            else if (typeRaw.includes('acci') || typeRaw.includes('stock') || typeRaw.includes('share')) rowAssetType = 'accion';
          }

          // Determinar divisa i taxa de canvi
          let currency = 'EUR';
          let exchangeRate = 1.0;
          if (['AAPL', 'NVDA', 'MSFT', 'TSLA'].includes(symbol)) {
            currency = 'USD';
            exchangeRate = 0.92;
          }

          // Mapeig de noms premium
          let name = symbol;
          if (symbol === 'AAPL') name = 'Apple Inc.';
          else if (symbol === 'NVDA') name = 'NVIDIA Corporation';
          else if (symbol === 'MSFT') name = 'Microsoft Corporation';
          else if (symbol === 'ASML') name = 'ASML Holding N.V.';
          else if (symbol === 'VWCE') name = 'Vanguard FTSE All-World UCITS ETF';
          else if (symbol === 'CSSPX') name = 'iShares Core S&P 500 UCITS ETF';
          else if (symbol === 'VAN-GL' || symbol === 'VANG-GLOB') name = 'Vanguard Global Stock Index Fund Investor EUR Accumulation';
          else if (symbol === 'VAN-EM' || symbol === 'VANG-EMRG') name = 'Vanguard Emerging Markets Stock Index Fund Investor EUR Accumulation';
          else if (symbol === 'VAN-SC' || symbol === 'VANG-SC') name = 'Vanguard Global Small-Cap Index Fund USD Accumulation';
          else if (symbol === 'CRE-RF') name = 'Creand Renta Fija Mixta, FI R';
          else if (symbol === 'POL-HE') name = 'Polar Capital Healthcare Opportunities Fund Class I';
          else if (symbol === 'AMUN-MSCI') name = 'Amundi Index MSCI World Fund';

          // Esborrar transaccions prèvies del mateix símbol per consolidar la posició neta
          this.state.transactions = this.state.transactions.filter(tx => tx.symbol !== symbol);

          // Crear la nova transacció de posició consolidada
          const newTx = {
            id: `t_tab_${rowAssetType}_${timestamp}_${index}`,
            date: avui,
            type: 'compra',
            assetType: rowAssetType,
            symbol,
            name,
            quantity,
            price,
            commission: 0,
            currency,
            exchangeRate,
            notes: 'Importat des de pestanya'
          };

          this.state.transactions.push(newTx);

          // Establir cotització simulada "en viu" inicial
          let livePrice = price;
          if (idxLivePrice !== -1 && cols[idxLivePrice]) {
            const lPriceParsed = cleanNumber(cols[idxLivePrice]);
            if (!isNaN(lPriceParsed) && lPriceParsed > 0) {
              const estimatedTotal = quantity * price;
              const isEstimatedTotal = !hasHeader && cols.length === 4 && Math.abs(lPriceParsed - estimatedTotal) < (estimatedTotal * 0.05);
              
              if (!isEstimatedTotal) {
                livePrice = lPriceParsed;
              }
            }
          }

          this.state.livePrices[symbol] = {
            current: livePrice,
            currency: currency,
            change: 0.0
          };

          importCount++;
        }
      });

      if (importCount > 0) {
        this.saveState();
        this.render();
        this.updateAIChatUI();
        alert(`🎉 S'han importat correctament ${importCount} posicions d'actius a la cartera!`);
      } else {
        alert("⚠️ No s'ha pogut importar cap dada. Verifica el format o els valors numèrics.");
      }

    } catch (err) {
      console.error("Error processant dades de la pestanya:", err);
      alert(`⚠️ Error en processar les dades: ${err.message}`);
    }
  },

  // Base de dades d'ISINs populars per a cerca i autoomplert
  isinDatabase: {
    // Accions
    'US0378331005': { symbol: 'AAPL', name: 'Apple Inc.', assetType: 'accion', currency: 'USD', price: 188.42 },
    'US67066G1040': { symbol: 'NVDA', name: 'NVIDIA Corporation', assetType: 'accion', currency: 'USD', price: 940.20 },
    'US5949181045': { symbol: 'MSFT', name: 'Microsoft Corporation', assetType: 'accion', currency: 'USD', price: 420.55 },
    'NL0010273215': { symbol: 'ASML', name: 'ASML Holding N.V.', assetType: 'accion', currency: 'EUR', price: 842.10 },
    'US88160R1014': { symbol: 'TSLA', name: 'Tesla Inc.', assetType: 'accion', currency: 'USD', price: 175.46 },
    'US0231351067': { symbol: 'AMZN', name: 'Amazon.com, Inc.', assetType: 'accion', currency: 'USD', price: 180.12 },
    'US02079K1079': { symbol: 'GOOGL', name: 'Alphabet Inc.', assetType: 'accion', currency: 'USD', price: 173.50 },
    'US30303M1027': { symbol: 'META', name: 'Meta Platforms, Inc.', assetType: 'accion', currency: 'USD', price: 475.20 },
    
    // ETFs
    'IE00B3XXRP09': { symbol: 'VWCE', name: 'Vanguard FTSE All-World UCITS ETF', assetType: 'etf', currency: 'EUR', price: 112.40 },
    'IE00B5BMR087': { symbol: 'CSSPX', name: 'iShares Core S&P 500 UCITS ETF', assetType: 'etf', currency: 'EUR', price: 465.30 },
    'IE00B4L5Y983': { symbol: 'IWDA', name: 'iShares Core MSCI World UCITS ETF', assetType: 'etf', currency: 'EUR', price: 87.20 },
    'IE00B3YCGJ38': { symbol: 'VUSA', name: 'Vanguard S&P 500 UCITS ETF', assetType: 'etf', currency: 'EUR', price: 85.40 },
    
    // Fons
    'LU1353950725': { symbol: 'AXA-GL', name: 'AXA WLD-GL INF SH DUR-AH', assetType: 'fons', currency: 'EUR', price: 126209.00 },
    'ES0174013021': { symbol: 'CRE-RF', name: 'Creand Renta Fija Mixta, FI R', assetType: 'fons', currency: 'EUR', price: 130094.00 },
    'IE00B3K83P04': { symbol: 'POL-HE', name: 'Polar Capital Healthcare Opportunities Fund Class I', assetType: 'fons', currency: 'EUR', price: 93312.00 },
    'IE00B03HCZ61': { symbol: 'VAN-GL', name: 'Vanguard Global Stock Index Fund Investor EUR Accumulation', assetType: 'fons', currency: 'EUR', price: 622938.00 },
    'IE0031786142': { symbol: 'VAN-EM', name: 'Vanguard Emerging Markets Stock Index Fund Investor EUR Accumulation', assetType: 'fons', currency: 'EUR', price: 123432.00 },
    'IE00B42LF923': { symbol: 'VAN-SC', name: 'Vanguard Global Small-Cap Index Fund USD Accumulation', assetType: 'fons', currency: 'EUR', price: 410200.00 },
    'LU0384405600': { symbol: 'VON-CL', name: 'VONT,CLE,TECHN', assetType: 'fons', currency: 'EUR', price: 67982.00 },
    'LU0171307068': { symbol: 'BGF-WH', name: 'BGF WORLD HEALT', assetType: 'fons', currency: 'EUR', price: 67603.00 },
    'LU0232524495': { symbol: 'AB-AM', name: 'AB-AMER, GROW,', assetType: 'fons', currency: 'EUR', price: 104445.00 },
    'LU1295551144': { symbol: 'CAP-NP', name: 'CAP,GR,NEW PER', assetType: 'fons', currency: 'EUR', price: 131406.00 },
    'LU0034353002': { symbol: 'DWS-FR', name: 'DWS FLOAT RATE NOTS', assetType: 'fons', currency: 'EUR', price: 251265.00 },
    'LU0145476817': { symbol: 'GEN-IB', name: 'GENERALI INVEST. BOND', assetType: 'fons', currency: 'EUR', price: 243512.00 },
    'LU0113257694': { symbol: 'SIS-CB', name: 'SISF EUR CORPORATE BOND', assetType: 'fons', currency: 'EUR', price: 86841.00 },
    'LU1670724373': { symbol: 'MG-OI', name: 'M&G OPTIMAL INCOME', assetType: 'fons', currency: 'EUR', price: 51875.80 },
    'LU0599946893': { symbol: 'DWS-CK', name: 'DWS CONCEPT KALDEMORG', assetType: 'fons', currency: 'EUR', price: 88330.00 },
    'IE00B4468526': { symbol: 'POL-TE', name: 'POLAR CAP. GL TECH.R EUR', assetType: 'fons', currency: 'EUR', price: 167268.00 },
    'LU0515768454': { symbol: 'THR-ND', name: 'THREADNEEDLE', assetType: 'fons', currency: 'EUR', price: 105020.00 },
    'LU0203975437': { symbol: 'ROB-GP', name: 'ROBECO GLOBAL PREMIUM', assetType: 'fons', currency: 'EUR', price: 157490.00 }
  },

  // K. Cercar ISIN i autoomplir el formulari de nova transacció
  searchAndAutofillISIN() {
    const searchInput = document.getElementById('txIsinSearch');
    const feedback = document.getElementById('isinSearchFeedback');
    if (!searchInput) return;
    
    const isin = searchInput.value.trim().toUpperCase();
    if (!isin) {
      alert("⚠️ Si us plau, introdueix un codi ISIN per cercar.");
      return;
    }
    
    if (isin.length !== 12) {
      feedback.style.display = 'block';
      feedback.style.color = 'var(--crimson)';
      feedback.innerHTML = `⚠️ Format d'ISIN incorrecte (ha de tenir exactament 12 caràcters).`;
      return;
    }
    
    const asset = this.isinDatabase[isin];
    if (asset) {
      document.getElementById('txIsin').value = isin;
      document.getElementById('txSymbol').value = asset.symbol;
      document.getElementById('txName').value = asset.name;
      document.getElementById('txAssetType').value = asset.assetType;
      document.getElementById('txPrice').value = asset.price;
      document.getElementById('txCurrency').value = asset.currency;
      
      feedback.style.display = 'block';
      feedback.style.color = 'var(--emerald)';
      feedback.innerHTML = `🔍 **Trobat!** S'han autoomplert les dades per a **${asset.name}** (${asset.symbol}).`;
      
      searchInput.value = '';
    } else {
      document.getElementById('txIsin').value = isin;
      
      feedback.style.display = 'block';
      feedback.style.color = 'var(--amber)';
      feedback.innerHTML = `🔍 ISIN no trobat a la base de dades comuna. S'ha copiat el codi a baix perquè puguis introduir la resta **manualment**.`;
    }
  },

  // L. Actualitzar el desplegable d'actius disponibles (accions i ETFs) al formulari
  updateAvailableAssetsDropdown() {
    const select = document.getElementById('txAssetSelect');
    if (!select) return;

    // Reiniciar opcions
    select.innerHTML = '<option value="">— Tria un actiu existent o comú —</option>';

    // 1. Obtenir holdings actius a la cartera
    const holdings = this.calculateHoldings() || [];
    const addedSymbols = new Set();

    // Crear un grup d'opcions per a holdings actius
    const holdingsGroup = document.createElement('optgroup');
    holdingsGroup.label = 'Els teus actius actuals a la cartera';

    holdings.forEach(h => {
      // Filtrar per accions, etfs o fons disponibles a la cartera
      if (h.assetType === 'accion' || h.assetType === 'etf' || h.assetType === 'fons') {
        const opt = document.createElement('option');
        opt.value = JSON.stringify({
          symbol: h.symbol,
          isin: h.isin || '',
          name: h.name,
          assetType: h.assetType,
          price: h.livePrice || h.price || 0,
          currency: h.currency || 'EUR'
        });
        const typeLabel = h.assetType === 'accion' ? 'Acció' : h.assetType === 'etf' ? 'ETF' : 'Fons';
        opt.textContent = `${h.symbol} - ${h.name} (${typeLabel})`;
        holdingsGroup.appendChild(opt);
        addedSymbols.add(h.symbol.toUpperCase());
      }
    });

    if (holdingsGroup.children.length > 0) {
      select.appendChild(holdingsGroup);
    }

    // 2. Afegir altres actius populars de la base d'ISINs no presents a holdings
    const dbStocksGroup = document.createElement('optgroup');
    dbStocksGroup.label = 'Accions populars (Disponibles)';
    const dbEtfsGroup = document.createElement('optgroup');
    dbEtfsGroup.label = 'ETFs populars (Disponibles)';
    const dbFonsGroup = document.createElement('optgroup');
    dbFonsGroup.label = 'Fons d\'Inversió populars (Disponibles)';

    Object.entries(this.isinDatabase).forEach(([isin, asset]) => {
      const sym = asset.symbol.toUpperCase();
      if (addedSymbols.has(sym)) return; // Evitar duplicats

      const opt = document.createElement('option');
      opt.value = JSON.stringify({
        symbol: asset.symbol,
        isin: isin,
        name: asset.name,
        assetType: asset.assetType,
        price: asset.price,
        currency: asset.currency
      });
      const typeLabel = asset.assetType === 'accion' ? 'Acció' : asset.assetType === 'etf' ? 'ETF' : 'Fons';
      opt.textContent = `${asset.symbol} - ${asset.name} (${typeLabel})`;

      if (asset.assetType === 'accion') {
        dbStocksGroup.appendChild(opt);
      } else if (asset.assetType === 'etf') {
        dbEtfsGroup.appendChild(opt);
      } else if (asset.assetType === 'fons') {
        dbFonsGroup.appendChild(opt);
      }
    });

    if (dbStocksGroup.children.length > 0) select.appendChild(dbStocksGroup);
    if (dbEtfsGroup.children.length > 0) select.appendChild(dbEtfsGroup);
    if (dbFonsGroup.children.length > 0) select.appendChild(dbFonsGroup);
  },

  // M. Generar preus històrics deterministes d'un any a partir de l'ISIN i preu actual
  generateFundHistory(isin, currentPrice) {
    let seed = 0;
    const isinStr = isin ? isin.toUpperCase().trim() : 'DEFAULT';
    for (let i = 0; i < isinStr.length; i++) {
      seed = (seed << 5) - seed + isinStr.charCodeAt(i);
      seed |= 0;
    }

    // Generador pseudo-aleatori determinista basat en seed (LCG)
    const random = () => {
      let x = Math.sin(seed++) * 10000;
      return x - Math.floor(x);
    };

    const months = 12;
    const prices = new Array(months);
    prices[months - 1] = currentPrice;

    // Tendència i volatilitat deterministes
    const drift = (random() * 0.12 - 0.03); // d'un -3% a +9% anual
    const volatility = 0.04 + random() * 0.08; // volatilitat del 4% al 12%

    let tempPrice = currentPrice;
    for (let i = months - 2; i >= 0; i--) {
      // Anar enrere en el temps: revertir tendència i volatilitat
      const change = (random() * 2 - 1) * volatility - (drift / 12);
      tempPrice = tempPrice / (1 + change);
      prices[i] = parseFloat(tempPrice.toFixed(2));
    }

    return prices;
  },

  // N. Obrir el modal de l'historial del fons i renderitzar el gràfic de Chart.js
  showFundHistory(symbol, isin) {
    // 1. Obtenir el preu consolidat actual d'aquest fons
    const holdings = this.calculateHoldings();
    const h = holdings.find(item => item.symbol.toUpperCase() === symbol.toUpperCase());
    
    // Si no el troba als holdings actius, mira a la base de dades coneguda o dades en viu
    let currentPrice = 100.00;
    let name = symbol;
    if (h) {
      currentPrice = h.livePrice || (h.avgPriceEUR / h.exchangeRate);
      name = h.name;
    } else {
      const known = this.isinDatabase[isin];
      if (known) {
        currentPrice = known.price;
        name = known.name;
      } else {
        const live = this.state.livePrices[symbol];
        if (live) currentPrice = live.current;
      }
    }

    // 2. Generar dades mensuals dels darrers 12 mesos acabant en el mes actual
    const prices = this.generateFundHistory(isin, currentPrice);

    // 3. Obtenir etiquetes de mesos en català per als darrers 12 mesos
    const mesos = ['Gen', 'Feb', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Oct', 'Nov', 'Des'];
    const avui = new Date();
    const labels = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(avui.getFullYear(), avui.getMonth() - i, 1);
      const anyCurta = d.getFullYear().toString().slice(-2);
      labels.push(`${mesos[d.getMonth()]} ${anyCurta}`);
    }

    // 4. Calcular mètriques clau per a les targetes del modal
    const maxPrice = Math.max(...prices);
    const minPrice = Math.min(...prices);
    const initialPrice = prices[0];
    const annualYield = ((currentPrice - initialPrice) / initialPrice) * 100;

    // 5. Assignar valors numèrics a la interfície
    const titleEl = document.getElementById('historyModalTitle');
    if (titleEl) titleEl.innerText = `${name} (${symbol})`;

    const curPriceEl = document.getElementById('histCurrentPrice');
    if (curPriceEl) curPriceEl.innerText = currentPrice.toLocaleString('ca-ES', { style: 'currency', currency: 'EUR' });

    const yieldEl = document.getElementById('histAnnualYield');
    if (yieldEl) {
      const sign = annualYield >= 0 ? '+' : '';
      yieldEl.innerText = `${sign}${annualYield.toFixed(2)}%`;
      yieldEl.className = annualYield >= 0 ? 'kpi-value ' + (annualYield >= 0 ? 'change-up' : 'change-down') : 'kpi-value change-down';
    }

    const maxEl = document.getElementById('histMaxPrice');
    if (maxEl) maxEl.innerText = maxPrice.toLocaleString('ca-ES', { style: 'currency', currency: 'EUR' });

    const minEl = document.getElementById('histMinPrice');
    if (minEl) minEl.innerText = minPrice.toLocaleString('ca-ES', { style: 'currency', currency: 'EUR' });

    // 6. Obrir el modal de l'historial
    this.openModal('fundHistoryModal');

    // 7. Renderitzar el gràfic de línies de Chart.js
    setTimeout(() => {
      if (window.FranklinCharts) {
        window.FranklinCharts.renderFundHistoryChart('fundHistoryChartCanvas', labels, prices);
      }
    }, 150); // Petit retard per garantir que el canvas modal és visible i té mides correctes
  },

  // Funció per verificar la contrasenya del login de manera asíncrona utilitzant SHA-256
  async handleLogin(event) {
    event.preventDefault();
    const passwordInput = document.getElementById('loginPassword').value;
    const errorEl = document.getElementById('loginError');
    
    // Generar hash SHA-256 criptogràfic mitjançant la Web Crypto API (100% estàtic i local)
    const encoder = new TextEncoder();
    const data = encoder.encode(passwordInput);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    
    // Suportem tant "franklin" com "jolly-franklin" com a contrasenyes vàlides per defecte encriptades
    const validHashes = [
      '7904791f9bb496a3354bf75641e45feb31e881a00cebcb2508e45bd942a6e430', // hash de "franklin"
      '561a57b262737a91235b55abbb14df3c38a60d02c3b59b07fc77d422f1b668ba'  // hash de "jolly-franklin"
    ];
    
    if (validHashes.includes(hashHex)) {
      sessionStorage.setItem('franklin_unlocked', 'true');
      const overlay = document.getElementById('loginOverlay');
      if (overlay) {
        overlay.classList.add('hidden');
      }
      errorEl.style.display = 'none';
      
      // Inicialitzar l'aplicació i pintar
      this.render();
      
      // Activar la simulació si correspon i estava activa
      const savedSim = localStorage.getItem('franklin_sim_active');
      if (savedSim === 'true' || savedSim === null) {
        this.toggleSimulation(true);
      }
    } else {
      errorEl.style.display = 'block';
      document.getElementById('loginPassword').value = '';
    }
  },

  // Funció per tancar la sessió de seguretat
  handleLogout() {
    sessionStorage.removeItem('franklin_unlocked');
    window.location.reload(); // Recarrega per bloquejar instantàniament
  }
};

// Iniciar l'aplicació en carregar la pàgina
window.addEventListener('DOMContentLoaded', () => {
  FranklinApp.init();
});
