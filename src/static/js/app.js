// FinAI Telegram Mini App - App JS Logic

const API_BASE = window.location.origin;

// Fetch Interceptor for remote database headers
const originalFetch = window.fetch;
window.fetch = function (input, init) {
    const urlStr = typeof input === "string" ? input : (input instanceof Request ? input.url : "");
    if (urlStr.includes("/api/")) {
        init = init || {};
        init.headers = init.headers || {};
        const userKey = localStorage.getItem("userKey");
        const customUrl = localStorage.getItem("customFirebaseUrl");
        if (userKey) {
            let hasUserKey = false;
            if (init.headers instanceof Headers) {
                hasUserKey = init.headers.has("X-User-Key");
            } else if (Array.isArray(init.headers)) {
                hasUserKey = init.headers.some(h => h[0].toLowerCase() === "x-user-key");
            } else {
                hasUserKey = Object.keys(init.headers).some(k => k.toLowerCase() === "x-user-key");
            }

            if (!hasUserKey) {
                if (init.headers instanceof Headers) {
                    init.headers.set("X-User-Key", userKey);
                    if (customUrl) init.headers.set("X-Firebase-Url", customUrl);
                } else if (Array.isArray(init.headers)) {
                    init.headers.push(["X-User-Key", userKey]);
                    if (customUrl) init.headers.push(["X-Firebase-Url", customUrl]);
                } else {
                    init.headers["X-User-Key"] = userKey;
                    if (customUrl) init.headers["X-Firebase-Url"] = customUrl;
                }
            }
        }
    }
    return originalFetch.call(this, input, init);
};

// Application State
let tg = window.Telegram ? window.Telegram.WebApp : null;
let currentTab = "home";
let geminiApiKey = localStorage.getItem("gemini_api_key") || "";
let expensesCurrency = localStorage.getItem("expenses_currency") || "RUB";
let portfolioCurrency = localStorage.getItem("portfolio_currency") || "RUB";
let currentLang = "ru";
let confirmAi = false;
let useLocalFallback = false;
let activeHistoryCategory = "all";
let activeAssetFilter = "all";
let categories = [];
let isRecording = false;
let loadedAssets = [];

// Real-time prices state
let prices = {
    "BTC": 5650000.0,
    "ETH": 310000.0,
    "AAPL": 16500.0,
    "TSLA": 15500.0,
    "USD_RUB": 90.0,
    "EUR_RUB": 97.2
};

// DOM views
const views = {
    login: document.getElementById("view-login"),
    home: document.getElementById("view-home"),
    stats: document.getElementById("view-stats"),
    invest: document.getElementById("view-investments"),
    history: document.getElementById("view-history"),
    settings: document.getElementById("view-settings")
};

// Navbar tabs
const tabs = {
    stats: document.getElementById("tab-stats"),
    invest: document.getElementById("tab-invest"),
    home: document.getElementById("tab-home"),
    history: document.getElementById("tab-history"),
    settings: document.getElementById("tab-settings")
};

// Common UI Elements
const headerTitle = document.getElementById("header-title");
const userGreeting = document.getElementById("user-greeting");
const userAvatarContainer = document.getElementById("user-avatar-container");
const btnSettingsTop = document.getElementById("btn-settings-top");

// View 1 (Home)
const netWorthDisplay = document.getElementById("net-worth-display");
const aiTextInput = document.getElementById("ai-text-input");
const btnAiSubmit = document.getElementById("btn-ai-submit");
const btnQuickAdd = document.getElementById("btn-quick-add");
const transactionsListContainer = document.getElementById("transactions-list-container");
const btnSeeAllTx = document.getElementById("btn-see-all-tx");

// View 2 (Stats)
const statsTimeframe = document.getElementById("stats-timeframe");
const statsDateRangeContainer = document.getElementById("stats-date-range-container");
const statsStartDate = document.getElementById("stats-start-date");
const statsEndDate = document.getElementById("stats-end-date");
const statsBalanceDisplay = document.getElementById("stats-balance-display");
const statsBarsContainer = document.getElementById("stats-bars-container");
const statsLabelsContainer = document.getElementById("stats-labels-container");
const statsIncomeTotal = document.getElementById("stats-income-total");
const statsExpenseTotal = document.getElementById("stats-expense-total");
const statsCategoriesContainer = document.getElementById("stats-categories-container");
const statsIncomeCategoriesContainer = document.getElementById("stats-income-categories-container");
const statsTransfersContainer = document.getElementById("stats-transfers-container");
const btnStatsPrev = document.getElementById("btn-stats-prev");
const btnStatsNext = document.getElementById("btn-stats-next");
const chartSubtitle = document.getElementById("chart-subtitle");

// View 3 (Investments)
const investmentsTotalDisplay = document.getElementById("investments-total-display");
const portfolioTodayGain = document.getElementById("portfolio-today-gain");
const btnAssetDeposit = document.getElementById("btn-asset-deposit");
const btnAssetSellTrigger = document.getElementById("btn-asset-sell-trigger");
const assetsListContainer = document.getElementById("assets-list-container");
const assetsCount = document.getElementById("assets-count");
const aiPortfolioInsight = document.getElementById("ai-portfolio-insight");

// View 4 (History)
const historySearch = document.getElementById("history-search");
const historyFilterChips = document.getElementById("history-filter-chips");
const historyListContainer = document.getElementById("history-list-container");

// View 5 (Settings)
const settingGeminiKey = document.getElementById("setting-gemini-key");
const settingExpensesCurrency = document.getElementById("setting-expenses-currency");
const settingPortfolioCurrency = document.getElementById("setting-portfolio-currency");
const settingLanguage = document.getElementById("setting-language");
const settingConfirmAi = document.getElementById("setting-confirm-ai");

const btnSaveSettings = document.getElementById("btn-save-settings");
const btnResetDb = document.getElementById("btn-reset-db");

// Modals
const aiConfirmModal = document.getElementById("ai-confirm-modal");
const modalTxAmount = document.getElementById("modal-tx-amount");
const modalTxType = document.getElementById("modal-tx-type");
const modalTxCategory = document.getElementById("modal-tx-category");
const modalTxDesc = document.getElementById("modal-tx-desc");
const btnModalCancel = document.getElementById("btn-modal-cancel");
const btnModalConfirm = document.getElementById("btn-modal-confirm");

const assetModal = document.getElementById("asset-modal");
const assetModalTitle = document.getElementById("asset-modal-title");
const assetType = document.getElementById("asset-type");
const assetSymbol = document.getElementById("asset-symbol");
const assetQuantity = document.getElementById("asset-quantity");
const assetPrice = document.getElementById("asset-price");
const btnAssetCancel = document.getElementById("btn-asset-cancel");
const btnAssetConfirm = document.getElementById("btn-asset-confirm");
const btnAssetDelete = document.getElementById("btn-asset-delete");
const assetSymbolDropdown = document.getElementById("asset-symbol-dropdown");

const sellAssetModal = document.getElementById("sell-asset-modal");
const sellAssetSymbol = document.getElementById("sell-asset-symbol");
const sellAssetQuantity = document.getElementById("sell-asset-quantity");
const sellAssetPrice = document.getElementById("sell-asset-price");
const btnSellAssetCancel = document.getElementById("btn-sell-asset-cancel");
const btnSellAssetConfirm = document.getElementById("btn-sell-asset-confirm");
const btnSellAssetMax = document.getElementById("btn-sell-asset-max");

// ----------------------------------------------------
// DB STRUCTURE & INITIAL SEEDS
// ----------------------------------------------------
const DEFAULT_ACCOUNTS = [
    { id: 1, name: "Дебетовая карта", type: "expense", balance: 0.0 },
    { id: 2, name: "Свободные инвест-средства", type: "investment", balance: 0.0 }
];

const DEFAULT_TRANSACTIONS = [];

const DEFAULT_ASSETS = [];

function initLocalDb(force = false) {
    if (force || !localStorage.getItem("accounts")) {
        localStorage.setItem("accounts", JSON.stringify(DEFAULT_ACCOUNTS));
    }
    if (force || !localStorage.getItem("transactions")) {
        localStorage.setItem("transactions", JSON.stringify(DEFAULT_TRANSACTIONS));
    }
    if (force || !localStorage.getItem("assets")) {
        localStorage.setItem("assets", JSON.stringify(DEFAULT_ASSETS));
    }
}

async function checkApiConnection() {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 1200);
        const res = await fetch(`${API_BASE}/api/status`, { method: "GET", signal: controller.signal });
        clearTimeout(timeoutId);
        if (res.ok) {
            useLocalFallback = false;
            console.log("Server API is live.");
        } else {
            throw new Error();
        }
    } catch (e) {
        useLocalFallback = true;
        initLocalDb();
        console.log("FastAPI unreachable, falling back to LocalStorage.");
    }
}

// ----------------------------------------------------
// APP INITIALIZATION
// ----------------------------------------------------
async function syncDataToServer() {
    const userKey = localStorage.getItem("userKey");
    if (!userKey) return;
    
    const accounts = JSON.parse(localStorage.getItem("accounts") || "[]");
    const transactions = JSON.parse(localStorage.getItem("transactions") || "[]");
    const assets = JSON.parse(localStorage.getItem("assets") || "[]");
    const categories = JSON.parse(localStorage.getItem("categories") || "[]");
    
    try {
        const firebase_url = localStorage.getItem("customFirebaseUrl") || "";
        const res = await fetch(`${API_BASE}/api/auth/sync`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-User-Key": userKey,
                "X-Firebase-Url": firebase_url
            },
            body: JSON.stringify({ accounts, transactions, assets, categories })
        });
        if (res.ok) {
            console.log("Synced local storage backup to server successfully.");
            updateUserRegistry();
        } else {
            console.error("Server sync endpoint returned error status:", res.status);
        }
    } catch (e) {
        console.error("Failed to sync local data to server:", e);
    }
}

document.addEventListener("DOMContentLoaded", async () => {
    // Check login state and route immediately to avoid layout flicker
    const isLoggedIn = localStorage.getItem("isLoggedIn") === "true";
    if (isLoggedIn) {
        switchView("home");
        loadDataFromLocal(); // Render cached local storage immediately
        
        try {
            const checkRes = await fetch(`${API_BASE}/api/transactions`);
            if (checkRes.ok) {
                const serverTxs = await checkRes.json();
                const localTxs = JSON.parse(localStorage.getItem("transactions") || "[]");
                const localAssets = JSON.parse(localStorage.getItem("assets") || "[]");
                if (serverTxs.length === 0 && (localTxs.length > 0 || localAssets.length > 0)) {
                    console.log("Server database was wiped. Restore from local backup...");
                    await syncDataToServer();
                }
            }
        } catch (err) {
            console.error("Auto sync check failed:", err);
        }
    } else {
        switchView("login");
    }

    // 1. Theme and user name sync via Telegram WebApp SDK
    if (tg) {
        tg.ready();
        tg.expand();
        
        if (tg.themeParams.bg_color) document.body.style.backgroundColor = tg.themeParams.bg_color;
        if (tg.themeParams.text_color) document.body.style.color = tg.themeParams.text_color;
        
        const user = tg.initDataUnsafe?.user;
        if (user) {
            headerTitle.textContent = `Общий счет (${user.first_name})`;
            const initials = ((user.first_name || "")[0] || "") + ((user.last_name || "")[0] || "");
            if (userAvatarContainer) {
                userAvatarContainer.innerHTML = `<span class="font-bold text-sm text-on-primary-container">${initials.toUpperCase() || "LF"}</span>`;
            }
        }
    }

    if (geminiApiKey) {
        settingGeminiKey.value = geminiApiKey;
    }
    const settingAccessKey = document.getElementById("setting-access-key");
    const settingFirebaseUrl = document.getElementById("setting-firebase-url");
    if (settingAccessKey) {
        settingAccessKey.value = localStorage.getItem("userKey") || "";
    }
    if (settingFirebaseUrl) {
        settingFirebaseUrl.value = localStorage.getItem("customFirebaseUrl") || "";
    }
    const settingAutoloadChart = document.getElementById("setting-autoload-chart");
    if (settingAutoloadChart) {
        settingAutoloadChart.checked = localStorage.getItem("autoloadChart") !== "false";
    }
    if (settingExpensesCurrency) {
        settingExpensesCurrency.value = expensesCurrency;
    }
    if (settingPortfolioCurrency) {
        settingPortfolioCurrency.value = portfolioCurrency;
    }
    if (settingLanguage) {
        settingLanguage.value = currentLang;
    }
    if (settingConfirmAi) {
        settingConfirmAi.checked = confirmAi;
    }
    applyLanguage(currentLang);

    // 2. Setup listeners
    setupTabNavigation();
    setupQuickActions();
    setupTransactionModals();
    setupAssetModals();
    setupSettingsPanel();
    setupStatsTimeframeNav();
    setupVoiceAndCameraInput();
    setupPortfolioFilters();
    
    // Set default calendar dates for custom range (last 30 days)
    const today = new Date().toISOString().split('T')[0];
    const prevMonth = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    statsStartDate.value = prevMonth;
    statsEndDate.value = today;

    // 3. Connect DB and load initial data
    await checkApiConnection();

    // Initialize database on first run if needed
    if (useLocalFallback) {
        initLocalDb(false);
    }

    await loadCategories();
    await initLoadedAssets();
    
    // Run price polling loop
    pollPrices();
    setInterval(pollPrices, 60000); // Poll prices every 60 seconds (1 minute)

    // Setup login screen listeners
    setupLoginScreen();

});

// ----------------------------------------------------
// TAB NAVIGATION CONTROLLERS
// ----------------------------------------------------
function setupTabNavigation() {
    Object.keys(tabs).forEach(tabKey => {
        tabs[tabKey].addEventListener("click", () => switchView(tabKey));
    });
    btnSettingsTop.addEventListener("click", () => switchView("settings"));
    btnSeeAllTx.addEventListener("click", () => switchView("history"));
}

function switchView(tabKey) {
    currentTab = tabKey;
    
    // Toggle header, nav, and container padding for login view
    const appContainer = document.getElementById("app-container");
    const appHeader = document.getElementById("app-header");
    const appNav = document.getElementById("app-nav");
    
    if (tabKey === "login") {
        if (appHeader) appHeader.classList.add("hidden");
        if (appNav) appNav.classList.add("hidden");
        if (appContainer) {
            appContainer.classList.remove("pt-[72px]");
            appContainer.classList.remove("pb-[96px]");
            appContainer.classList.add("pt-4");
            appContainer.classList.add("pb-4");
        }
    } else {
        if (appHeader) appHeader.classList.remove("hidden");
        if (appNav) appNav.classList.remove("hidden");
        if (appContainer) {
            appContainer.classList.add("pt-[72px]");
            appContainer.classList.add("pb-[96px]");
            appContainer.classList.remove("pt-4");
            appContainer.classList.remove("pb-4");
        }
    }
    
    Object.keys(views).forEach(k => {
        if (k === tabKey) {
            if (views[k]) views[k].classList.remove("hidden");
        } else {
            if (views[k]) views[k].classList.add("hidden");
        }
    });

    Object.keys(tabs).forEach(k => {
        const btn = tabs[k];
        if (!btn) return;
        if (k === tabKey) {
            btn.classList.add("text-primary");
            btn.classList.add("relative");
            btn.classList.add("after:content-['']");
            btn.classList.add("after:w-1");
            btn.classList.add("after:h-1");
            btn.classList.add("after:bg-primary");
            btn.classList.add("after:rounded-full");
            btn.classList.add("after:mt-1");
            btn.classList.remove("text-outline");
        } else {
            btn.classList.remove("text-primary");
            btn.classList.remove("relative");
            btn.classList.remove("after:content-['']");
            btn.classList.remove("after:w-1");
            btn.classList.remove("after:h-1");
            btn.classList.remove("after:bg-primary");
            btn.classList.remove("after:rounded-full");
            btn.classList.remove("after:mt-1");
            btn.classList.add("text-outline");
        }
    });

    const t = translations[currentLang] || translations["ru"];
    const user = tg && tg.initDataUnsafe?.user;
    if (tabKey === "home") {
        headerTitle.textContent = user ? `${t.header_home} (${user.first_name})` : t.header_home;
    } else if (tabKey === "stats") {
        headerTitle.textContent = t.header_stats;
    } else if (tabKey === "invest") {
        headerTitle.textContent = t.header_invest;
    } else if (tabKey === "history") {
        headerTitle.textContent = t.header_history;
    } else if (tabKey === "settings") {
        headerTitle.textContent = t.header_settings;
    }

    if (tabKey !== "login") {
        loadAppData();
    }
}

// ----------------------------------------------------
// PRICE POLLING & WEBSOCKET EMULATION (TRADINGVIEW SYNC)
async function initLoadedAssets() {
    if (useLocalFallback) {
        loadedAssets = JSON.parse(localStorage.getItem("assets")) || [];
    } else {
        try {
            const res = await fetch(`${API_BASE}/api/assets`);
            if (res.ok) {
                const data = await res.json();
                loadedAssets = data.assets || [];
            }
        } catch (e) {
            console.error("Failed to init loaded assets:", e);
            loadedAssets = JSON.parse(localStorage.getItem("assets")) || [];
        }
    }
}

async function pollPrices() {
    let symbolsList = ["BTC", "ETH", "AAPL", "TSLA"];
    try {
        loadedAssets.forEach(a => {
            if (a.symbol) {
                symbolsList.push(a.symbol.toUpperCase());
            }
        });
    } catch (e) {}
    
    symbolsList = [...new Set(symbolsList)];
    const symbolsQuery = symbolsList.join(",");
    
    try {
        const res = await fetch(`${API_BASE}/api/prices?symbols=${encodeURIComponent(symbolsQuery)}`);
        if (res.ok) {
            const data = await res.json();
            Object.assign(prices, data);
            console.log("Real-time prices updated via FastAPI backend.");
            if (useLocalFallback) {
                loadDataFromLocal();
            } else {
                loadAppData();
            }
        }
    } catch (e) {
        console.error("Prices poll error:", e);
        prices["BTC"] *= (1 + (Math.random() * 0.004 - 0.002));
        prices["ETH"] *= (1 + (Math.random() * 0.004 - 0.002));
        prices["AAPL"] *= (1 + (Math.random() * 0.002 - 0.001));
        prices["TSLA"] *= (1 + (Math.random() * 0.003 - 0.0015));
        if (useLocalFallback) {
            loadDataFromLocal();
        }
    }
    
    // Update Exchange Rates Widget
    const rateUsdRub = document.getElementById("rate-usd-rub");
    const rateEurUsd = document.getElementById("rate-eur-usd");
    if (rateUsdRub && rateEurUsd) {
        const usdRub = prices["USD_RUB"] || 90.0;
        const eurRub = prices["EUR_RUB"] || 97.2;
        const eurUsd = usdRub > 0 ? (eurRub / usdRub) : 1.08;
        rateUsdRub.textContent = `${usdRub.toFixed(2)} ₽`;
        rateEurUsd.textContent = `$${eurUsd.toFixed(4)}`;
    }
    
    // Update last updated timestamp
    const updatedEl = document.getElementById("rates-updated-time");
    if (updatedEl) {
        const now = new Date();
        const timeStr = now.toLocaleTimeString(currentLang === "en" ? "en-US" : "ru-RU", { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        updatedEl.textContent = currentLang === "en" ? `Data current as of: ${timeStr}` : `Данные актуальны на: ${timeStr}`;
    }
}

// ----------------------------------------------------
// DATA SYNCRONIZATION PIPELINE
// ----------------------------------------------------
async function loadAppData() {
    if (useLocalFallback) {
        loadDataFromLocal();
        return;
    }

    try {
        const statusRes = await fetch(`${API_BASE}/api/status`);
        if (!statusRes.ok) throw new Error();
        const status = await statusRes.json();
        
        netWorthDisplay.textContent = formatCurrency(status.net_worth, expensesCurrency);
        investmentsTotalDisplay.textContent = formatCurrency(status.investment_balance, portfolioCurrency);
        statsBalanceDisplay.textContent = formatCurrency(status.cash_balance, expensesCurrency);
        
        if (status.accounts) {
            localStorage.setItem("accounts", JSON.stringify(status.accounts));
        }
        
        if (currentTab === "home") {
            await loadTransactions();
        } else if (currentTab === "stats") {
            await loadStats();
        } else if (currentTab === "invest") {
            await loadAssets();
        } else if (currentTab === "history") {
            await loadHistory();
        }
        updateUserRegistry();
    } catch (e) {
        console.error("Backend error, switching to LocalStorage mode.", e);
        useLocalFallback = true;
        loadDataFromLocal();
    }
}

function loadDataFromLocal() {
    const accounts = JSON.parse(localStorage.getItem("accounts")) || DEFAULT_ACCOUNTS;
    const transactions = JSON.parse(localStorage.getItem("transactions")) || DEFAULT_TRANSACTIONS;
    const assets = JSON.parse(localStorage.getItem("assets")) || DEFAULT_ASSETS;
    loadedAssets = assets;

    const cashBalance = accounts.find(a => a.type === "expense")?.balance || 0;
    const invCashBalance = accounts.find(a => a.type === "investment")?.balance || 0;
    const assetsValue = assets.reduce((sum, a) => {
        const cleanSymbol = a.symbol.replace("-USD", "");
        const livePrice = prices[a.symbol] || prices[cleanSymbol] || a.current_price;
        return sum + (a.quantity * livePrice);
    }, 0);
    const totalInvestments = invCashBalance + assetsValue;
    const netWorth = cashBalance + totalInvestments;

    netWorthDisplay.textContent = formatCurrency(netWorth, expensesCurrency);
    investmentsTotalDisplay.textContent = formatCurrency(totalInvestments, portfolioCurrency);
    statsBalanceDisplay.textContent = formatCurrency(cashBalance, expensesCurrency);

    if (currentTab === "home") {
        renderTransactions(transactions.slice(0, 5));
    } else if (currentTab === "stats") {
        renderStats(transactions);
    } else if (currentTab === "invest") {
        renderAssets(assets);
    } else if (currentTab === "history") {
        renderHistory(transactions);
    }
}

// ----------------------------------------------------
// VIEW DOM RENDERERS
// ----------------------------------------------------
function renderTransactions(txs, targetContainer = transactionsListContainer) {
    targetContainer.innerHTML = "";
    if (txs.length === 0) {
        const noOpsText = currentLang === "en" ? "No operations for the selected period." : "Нет операций за выбранный период.";
        targetContainer.innerHTML = `<div class="p-6 text-center text-outline text-xs">${noOpsText}</div>`;
        return;
    }

    txs.forEach((tx, idx) => {
        const isLast = idx === txs.length - 1;
        const borderClass = isLast ? "" : "border-b border-outline-variant/20";
        let amountColor = "";
        let amountPrefix = "";
        if (tx.type === "income") {
            amountColor = "text-primary font-bold";
            amountPrefix = "+";
        } else if (tx.type === "expense") {
            amountColor = "text-error font-bold";
            amountPrefix = "-";
        } else if (tx.type === "transfer") {
            if (tx.category === "На карту") {
                amountColor = "text-primary font-bold";
                amountPrefix = "+";
            } else {
                amountColor = "text-slate-500 font-bold dark:text-slate-400";
                amountPrefix = "-";
            }
        }
        const icon = getCategoryIcon(tx.category);
        
        const item = document.createElement("div");
        item.className = `flex justify-between items-center py-3.5 ${borderClass} hover:bg-surface-container-low transition-colors px-1 rounded-lg`;
        item.innerHTML = `
            <div class="flex items-center gap-3.5">
                <div class="w-10 h-10 rounded-full bg-surface-container text-primary flex items-center justify-center shrink-0 border border-outline-variant/10">
                    <span class="material-symbols-outlined text-[18px]">${icon}</span>
                </div>
                <div>
                    <div class="text-sm font-semibold text-on-surface">${tx.description || translateCategory(tx.category)}</div>
                    <div class="text-xs text-outline font-medium mt-0.5">${formatDateString(tx.date)} • ${translateCategory(tx.category)}</div>
                </div>
            </div>
            <div class="text-sm ${amountColor}">${amountPrefix}${formatCurrency(tx.amount, expensesCurrency)}</div>
        `;
        targetContainer.appendChild(item);
    });
}

function renderAssets(assets) {
    assetsListContainer.innerHTML = "";
    
    let filteredAssets = [...assets];
    if (activeAssetFilter !== "all") {
        filteredAssets = assets.filter(a => a.type === activeAssetFilter);
    }
    
    const countSuffix = currentLang === "en" ? "asset(s)" : "актив(ов)";
    assetsCount.textContent = `${filteredAssets.length} ${countSuffix}`;
    
    if (filteredAssets.length === 0) {
        const noAssetsText = currentLang === "en" ? "No assets." : "Активы отсутствуют.";
        assetsListContainer.innerHTML = `<div class="col-span-2 p-6 text-center text-outline text-xs">${noAssetsText}</div>`;
        return;
    }

    const activeAssets = filteredAssets.filter(a => a.quantity > 0);
    const inactiveAssets = filteredAssets.filter(a => a.quantity <= 0);

    function createAssetCard(asset) {
        const cleanSymbol = asset.symbol.replace("-USD", "");
        const livePrice = prices[asset.symbol] || prices[cleanSymbol] || asset.live_price || asset.current_price;
        const totalVal = asset.quantity * livePrice;
        const colorStyle = getAssetColorTheme(asset.symbol, asset.type);
        const entryPrice = asset.entry_price || asset.current_price || 0;
        const pctChange = entryPrice > 0 ? ((livePrice - entryPrice) / entryPrice) * 100 : 0;
        const changeSign = pctChange >= 0 ? "+" : "";
        const changeColor = pctChange >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400";
        const unitText = currentLang === "en" ? "pcs" : "шт.";
        
        const item = document.createElement("div");
        item.className = "bg-surface-container-lowest rounded-2xl p-4 border border-outline-variant/30 shadow-[0px_4px_20px_rgba(0,0,0,0.03)] flex flex-col justify-between h-[124px] cursor-pointer active:scale-98 transition-transform";
        item.innerHTML = `
            <div class="flex justify-between items-start">
                <div class="w-8 h-8 rounded-full ${colorStyle.bg} flex items-center justify-center ${colorStyle.text}">
                    <span class="material-symbols-outlined text-[16px]">${colorStyle.icon}</span>
                </div>
                <div class="text-right">
                    <div class="text-xs font-bold text-on-surface">${asset.symbol}</div>
                    <div class="text-[10px] text-outline mt-0.5">${asset.quantity} ${unitText}</div>
                </div>
            </div>
            <div class="flex justify-between items-end">
                <div>
                    <div class="text-sm font-bold text-on-surface">${formatCurrency(totalVal, portfolioCurrency)}</div>
                    <div class="text-[10px] ${changeColor} font-bold flex items-center gap-0.5 mt-0.5">
                        <span>${changeSign}${pctChange.toFixed(2)}%</span>
                    </div>
                </div>
                <div class="text-right text-[10px] text-outline font-semibold">
                    ${formatCurrency(livePrice, portfolioCurrency)}
                </div>
            </div>
        `;
        
        item.addEventListener("click", () => {
            openAssetDetailsModal(asset, livePrice, totalVal);
        });
        return item;
    }

    if (activeAssets.length > 0) {
        const header = document.createElement("div");
        header.className = "col-span-2 text-xs font-bold text-outline uppercase tracking-wider mb-1 mt-2";
        header.textContent = currentLang === "en" ? "Active Assets" : "Действующие активы";
        assetsListContainer.appendChild(header);
        
        activeAssets.forEach(asset => {
            assetsListContainer.appendChild(createAssetCard(asset));
        });
    }
    
    if (inactiveAssets.length > 0) {
        const divider = document.createElement("div");
        divider.className = "col-span-2 border-t border-outline-variant/20 my-3";
        assetsListContainer.appendChild(divider);
        
        const header = document.createElement("div");
        header.className = "col-span-2 text-xs font-bold text-outline uppercase tracking-wider mb-1";
        header.textContent = currentLang === "en" ? "Inactive Assets (sold)" : "Неактуальные активы (продано)";
        assetsListContainer.appendChild(header);
        
        inactiveAssets.forEach(asset => {
            assetsListContainer.appendChild(createAssetCard(asset));
        });
    }

    const totalAssetsSum = assets.reduce((s, a) => {
        const cleanSymbol = a.symbol.replace("-USD", "");
        const livePrice = prices[a.symbol] || prices[cleanSymbol] || a.current_price;
        return s + (a.quantity * livePrice);
    }, 0);
    const totalGain = assets.reduce((s, a) => {
        const cleanSymbol = a.symbol.replace("-USD", "");
        const livePrice = prices[a.symbol] || prices[cleanSymbol] || a.current_price;
        return s + (a.quantity * (livePrice - a.current_price));
    }, 0);
    const totalCost = assets.reduce((s, a) => {
        return s + (a.quantity * a.current_price);
    }, 0);
    const dayGainPercent = totalCost > 0 ? (totalGain / totalCost) * 100 : 0;
    const changeSign = totalGain >= 0 ? "+" : "";
    
    portfolioTodayGain.textContent = `${changeSign}${dayGainPercent.toFixed(2)}% (${changeSign}${formatCurrency(totalGain, portfolioCurrency)})`;
    if (totalGain >= 0) {
        portfolioTodayGain.className = "text-xs font-bold text-emerald-600 dark:text-emerald-400";
    } else {
        portfolioTodayGain.className = "text-xs font-bold text-red-600 dark:text-red-400";
    }
    
    if (typeof aiPortfolioInsight !== "undefined" && aiPortfolioInsight) {
        aiPortfolioInsight.textContent = currentLang === "en"
            ? `Portfolio Analytics: Total assets value ${formatCurrency(totalAssetsSum, portfolioCurrency)}. Several types of investments are distributed in the portfolio. Quotes are polled automatically from Yahoo Finance.`
            : `Аналитика портфеля: Общий объем активов ${formatCurrency(totalAssetsSum, portfolioCurrency)}. В портфеле распределено несколько типов вложений. Котировки опрашиваются автоматически с Yahoo Finance.`;
    }
}

// Setup Timeframe Change Listener
function setupStatsTimeframeNav() {
    statsTimeframe.addEventListener("change", () => {
        if (statsTimeframe.value === "custom") {
            statsDateRangeContainer.classList.remove("hidden");
        } else {
            statsDateRangeContainer.classList.add("hidden");
        }
        loadAppData();
    });
}

// Render Stats View with calendar Date Filtering & Chronological Grouping
function renderStats(txs) {
    statsCategoriesContainer.innerHTML = "";
    statsIncomeCategoriesContainer.innerHTML = "";
    statsTransfersContainer.innerHTML = "";
    statsBarsContainer.innerHTML = "";
    statsLabelsContainer.innerHTML = "";

    const timeframe = statsTimeframe.value;
    let filteredTxs = [...txs];

    // Compute dynamic date range boundaries based on selected timeframe relative to today
    let startDateVal = "";
    let endDateVal = "";
    const today = new Date();
    const localeStr = currentLang === "en" ? "en-US" : "ru-RU";

    if (timeframe === "weekly") {
        const start = new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000);
        startDateVal = start.toISOString().split('T')[0];
        endDateVal = today.toISOString().split('T')[0];
        chartSubtitle.textContent = `${start.toLocaleDateString(localeStr)} - ${today.toLocaleDateString(localeStr)}`;
    } else if (timeframe === "monthly") {
        const start = new Date(today.getTime() - 29 * 24 * 60 * 60 * 1000);
        startDateVal = start.toISOString().split('T')[0];
        endDateVal = today.toISOString().split('T')[0];
        chartSubtitle.textContent = currentLang === "en" ? "Last 30 Days" : "Последние 30 дней";
    } else if (timeframe === "yearly") {
        const start = new Date(today.getTime() - 364 * 24 * 60 * 60 * 1000);
        startDateVal = start.toISOString().split('T')[0];
        endDateVal = today.toISOString().split('T')[0];
        chartSubtitle.textContent = currentLang === "en" ? "Last 12 Months" : "Последние 12 месяцев";
    } else if (timeframe === "custom") {
        startDateVal = statsStartDate.value;
        endDateVal = statsEndDate.value;
        chartSubtitle.textContent = currentLang === "en" ? "Custom Period" : "Произвольный период";
    }

    if (startDateVal && endDateVal) {
        filteredTxs = txs.filter(t => t.date >= startDateVal && t.date <= endDateVal);
    }

    const expenses = filteredTxs.filter(t => t.type === "expense");
    const incomes = filteredTxs.filter(t => t.type === "income");
    
    const sumExpense = expenses.reduce((s, t) => s + t.amount, 0);
    const sumIncome = incomes.reduce((s, t) => s + t.amount, 0);
    
    statsIncomeTotal.textContent = formatCurrency(sumIncome, expensesCurrency);
    statsExpenseTotal.textContent = formatCurrency(sumExpense, expensesCurrency);

    // A. Render Categories breakdown - EXPENSES
    if (expenses.length === 0) {
        const noExpText = currentLang === "en" ? "No expenses for the period." : "Нет расходов за период.";
        statsCategoriesContainer.innerHTML = `<div class="text-center text-outline text-xs py-4">${noExpText}</div>`;
    } else {
        const catMap = {};
        expenses.forEach(e => {
            catMap[e.category] = (catMap[e.category] || 0) + e.amount;
        });
        const sortedCats = Object.entries(catMap).sort((a,b)=>b[1]-a[1]);
        
        sortedCats.forEach(([cat, val]) => {
            const pct = Math.round((val / sumExpense) * 100);
            const progress = document.createElement("div");
            progress.className = "flex flex-col gap-1 w-full";
            progress.innerHTML = `
                <div class="flex justify-between text-xs font-semibold">
                    <span class="text-on-surface">${translateCategory(cat)} (${pct}%)</span>
                    <span class="text-outline">${formatCurrency(val, expensesCurrency)}</span>
                </div>
                <div class="w-full bg-surface-container-low rounded-full h-2 overflow-hidden border border-outline-variant/10">
                    <div class="bg-primary h-full rounded-full" style="width: ${pct}%; transform-origin: left; animation: slideRight 0.8s ease-out;"></div>
                </div>
            `;
            statsCategoriesContainer.appendChild(progress);
        });
    }

    // B. Render Categories breakdown - INCOMES
    if (incomes.length === 0) {
        const noIncText = currentLang === "en" ? "No incomes for the period." : "Нет поступлений за период.";
        statsIncomeCategoriesContainer.innerHTML = `<div class="text-center text-outline text-xs py-4">${noIncText}</div>`;
    } else {
        const catMap = {};
        incomes.forEach(e => {
            catMap[e.category] = (catMap[e.category] || 0) + e.amount;
        });
        const sortedCats = Object.entries(catMap).sort((a,b)=>b[1]-a[1]);
        
        sortedCats.forEach(([cat, val]) => {
            const pct = Math.round((val / sumIncome) * 100);
            const progress = document.createElement("div");
            progress.className = "flex flex-col gap-1 w-full";
            progress.innerHTML = `
                <div class="flex justify-between text-xs font-semibold">
                    <span class="text-on-surface">${translateCategory(cat)} (${pct}%)</span>
                    <span class="text-outline">${formatCurrency(val, expensesCurrency)}</span>
                </div>
                <div class="w-full bg-surface-container-low rounded-full h-2 overflow-hidden border border-outline-variant/10">
                    <div class="bg-secondary h-full rounded-full" style="width: ${pct}%; transform-origin: left; animation: slideRight 0.8s ease-out;"></div>
                </div>
            `;
            statsIncomeCategoriesContainer.appendChild(progress);
        });
    }

    // C. Render Transfers breakdown
    const transfers = filteredTxs.filter(t => t.type === "transfer");
    
    if (transfers.length === 0) {
        const noTransfersText = currentLang === "en" ? "No transfers for the period." : "Нет переводов за период.";
        statsTransfersContainer.innerHTML = `<div class="text-center text-outline text-xs py-4">${noTransfersText}</div>`;
    } else {
        const transMap = {};
        let toPortfolioSum = 0;
        let toCardSum = 0;
        
        transfers.forEach(t => {
            if (t.category === "В портфель") {
                toPortfolioSum += t.amount;
            } else if (t.category === "На карту") {
                toCardSum += t.amount;
            } else {
                transMap[t.category] = (transMap[t.category] || 0) + t.amount;
            }
        });
        
        const netPortfolio = Math.max(0, toPortfolioSum - toCardSum);
        if (netPortfolio > 0 || (toPortfolioSum === 0 && toCardSum === 0)) {
            transMap["В портфель"] = netPortfolio;
        }
        
        const sortedTrans = Object.entries(transMap).sort((a,b)=>b[1]-a[1]);
        statsTransfersContainer.innerHTML = "";
        
        if (sortedTrans.length === 0) {
            const noTransfersText = currentLang === "en" ? "No transfers for the period." : "Нет переводов за период.";
            statsTransfersContainer.innerHTML = `<div class="text-center text-outline text-xs py-4">${noTransfersText}</div>`;
        } else {
            sortedTrans.forEach(([cat, val]) => {
                const progress = document.createElement("div");
                progress.className = "flex justify-between items-center py-2 border-b border-outline-variant/10 last:border-b-0";
                progress.innerHTML = `
                    <span class="text-xs font-semibold text-on-surface">${translateCategory(cat)}</span>
                    <span class="text-xs font-bold text-outline">${formatCurrency(val, expensesCurrency)}</span>
                `;
                statsTransfersContainer.appendChild(progress);
            });
        }
    }

    // C. Draw Chronologically grouped bars based on timeframe selection relative to today
    let intervals = [];
    let labels = [];

    if (timeframe === "yearly") {
        const monthsNames = currentLang === "en"
            ? ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
            : ["Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек"];
        
        for (let i = 11; i >= 0; i--) {
            const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
            const yr = d.getFullYear();
            const suffix = " " + String(yr).slice(-2);
            const mLabel = monthsNames[d.getMonth()] + suffix;
            const mPrefix = `${yr}-${(d.getMonth() + 1).toString().padStart(2, '0')}`;
            
            const monthTxs = filteredTxs.filter(t => t.date.startsWith(mPrefix));
            const inc = monthTxs.filter(t => t.type === "income").reduce((s,t) => s + t.amount, 0);
            const exp = monthTxs.filter(t => t.type === "expense").reduce((s,t) => s + t.amount, 0);
            intervals.push({ income: inc, expense: exp, year: yr });
            labels.push(mLabel);
        }
    } else if (timeframe === "monthly") {
        for (let w = 3; w >= 0; w--) {
            const end = new Date(today.getTime() - w * 7 * 24 * 60 * 60 * 1000);
            const start = new Date(end.getTime() - 6 * 24 * 60 * 60 * 1000);
            const startStr = start.toISOString().split('T')[0];
            const endStr = end.toISOString().split('T')[0];
            
            const weekTxs = filteredTxs.filter(t => t.date >= startStr && t.date <= endStr);
            const inc = weekTxs.filter(t => t.type === "income").reduce((s,t) => s + t.amount, 0);
            const exp = weekTxs.filter(t => t.type === "expense").reduce((s,t) => s + t.amount, 0);
            intervals.push({ income: inc, expense: exp });
            
            const sLabel = `${start.getDate().toString().padStart(2,'0')}.${(start.getMonth()+1).toString().padStart(2,'0')}`;
            const eLabel = `${end.getDate().toString().padStart(2,'0')}.${(end.getMonth()+1).toString().padStart(2,'0')}`;
            labels.push(`${sLabel}-${eLabel}`);
        }
    } else if (timeframe === "weekly") {
        const daysNames = currentLang === "en"
            ? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
            : ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
        
        for (let d = 6; d >= 0; d--) {
            const day = new Date(today.getTime() - d * 24 * 60 * 60 * 1000);
            const dDateStr = day.toISOString().split('T')[0];
            
            const dayTxs = filteredTxs.filter(t => t.date === dDateStr);
            const inc = dayTxs.filter(t => t.type === "income").reduce((s,t) => s + t.amount, 0);
            const exp = dayTxs.filter(t => t.type === "expense").reduce((s,t) => s + t.amount, 0);
            intervals.push({ income: inc, expense: exp });
            
            const dayIdx = day.getDay();
            labels.push(`${daysNames[dayIdx]} ${day.getDate()}`);
        }
    } else {
        const startMs = new Date(startDateVal).getTime();
        const endMs = new Date(endDateVal).getTime();
        const spanMs = endMs - startMs || 86400000;
        const spanDays = Math.round(spanMs / 86400000);

        if (spanDays > 30) {
            // Group by calendar months when custom period is longer than 30 days
            const monthsNames = currentLang === "en"
                ? ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
                : ["Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек"];

            const sDate = new Date(startDateVal);
            const eDate = new Date(endDateVal);
            let cursor = new Date(sDate.getFullYear(), sDate.getMonth(), 1);

            while (cursor <= eDate) {
                const yr = cursor.getFullYear();
                const mo = cursor.getMonth();
                const suffix = " " + String(yr).slice(-2);
                const mLabel = monthsNames[mo] + suffix;
                const mPrefix = `${yr}-${(mo + 1).toString().padStart(2, '0')}`;

                const monthTxs = filteredTxs.filter(t => t.date.startsWith(mPrefix));
                const inc = monthTxs.filter(t => t.type === "income").reduce((s,t) => s + t.amount, 0);
                const exp = monthTxs.filter(t => t.type === "expense").reduce((s,t) => s + t.amount, 0);
                intervals.push({ income: inc, expense: exp, year: yr });
                labels.push(mLabel);

                cursor = new Date(yr, mo + 1, 1);
            }
        } else {
            // Default: split into 5 equal intervals for short custom periods
            const step = spanMs / 5;
            for (let i = 0; i < 5; i++) {
                const tStart = new Date(startMs + i * step).toISOString().split('T')[0];
                const tEnd = new Date(startMs + (i + 1) * step).toISOString().split('T')[0];
                const periodTxs = filteredTxs.filter(t => t.date >= tStart && t.date <= tEnd);
                const inc = periodTxs.filter(t => t.type === "income").reduce((s,t) => s + t.amount, 0);
                const exp = periodTxs.filter(t => t.type === "expense").reduce((s,t) => s + t.amount, 0);
                intervals.push({ income: inc, expense: exp });

                const midDate = new Date(startMs + i * step + step / 2);
                labels.push(midDate.toLocaleDateString(localeStr, { month: "short", day: "numeric" }));
            }
        }
    }

    const maxVal = Math.max(...intervals.map(v => Math.max(v.income, v.expense))) || 1000;
    const incLabel = currentLang === "en" ? "Income" : "Доход";
    const expLabel = currentLang === "en" ? "Expense" : "Расход";
    const useYearDividers = timeframe === "yearly" || (timeframe === "custom" && intervals.length > 0 && intervals[0].year !== undefined);

    intervals.forEach((val, idx) => {
        if (useYearDividers && idx > 0 && val.year !== intervals[idx - 1].year) {
            const divider = document.createElement("div");
            divider.className = "h-full border-l border-dashed border-outline/30 self-stretch pointer-events-none w-0";
            statsBarsContainer.appendChild(divider);
        }

        const incPct = Math.max(8, Math.round((val.income / maxVal) * 100));
        const expPct = Math.max(8, Math.round((val.expense / maxVal) * 100));

        const barColumn = document.createElement("div");
        barColumn.className = "w-full flex justify-center gap-1.5 items-end h-full group relative";
        barColumn.innerHTML = `
            <div class="w-3 bg-primary rounded-t-sm chart-bar-animate relative group/inc" style="height: ${incPct}%;" title="${incLabel}: ${formatCurrency(val.income, expensesCurrency)}">
                <div class="absolute -top-7 left-1/2 -translate-x-1/2 bg-on-background text-white text-[9px] font-bold px-1 rounded opacity-0 group-hover/inc:opacity-100 transition-opacity whitespace-nowrap z-20 pointer-events-none">${Math.round(convertFromRub(val.income, expensesCurrency)/1000)}k</div>
            </div>
            <div class="w-3 bg-outline-variant rounded-t-sm chart-bar-animate relative group/exp" style="height: ${expPct}%;" title="${expLabel}: ${formatCurrency(val.expense, expensesCurrency)}">
                <div class="absolute -top-7 left-1/2 -translate-x-1/2 bg-on-background text-white text-[9px] font-bold px-1 rounded opacity-0 group-hover/exp:opacity-100 transition-opacity whitespace-nowrap z-20 pointer-events-none">${Math.round(convertFromRub(val.expense, expensesCurrency)/1000)}k</div>
            </div>
        `;
        statsBarsContainer.appendChild(barColumn);
    });

    labels.forEach((lbl, idx) => {
        if (useYearDividers && idx > 0 && intervals[idx] && intervals[idx - 1] && intervals[idx].year !== intervals[idx - 1].year) {
            const labelSpacer = document.createElement("span");
            labelSpacer.className = "w-0 pointer-events-none";
            statsLabelsContainer.appendChild(labelSpacer);
        }
        const span = document.createElement("span");
        span.className = "w-full text-center scale-90";
        span.textContent = lbl;
        statsLabelsContainer.appendChild(span);
    });

    // Dynamic chart scroll width based on number of columns
    const chartScrollInner = document.getElementById("chart-scroll-inner");
    const chartScrollWrapper = document.getElementById("chart-scroll-wrapper");
    if (chartScrollInner && chartScrollWrapper) {
        const columnCount = intervals.length;
        const dynamicWidth = columnCount * 60;
        const containerWidth = chartScrollWrapper.clientWidth;

        if (dynamicWidth > containerWidth) {
            chartScrollInner.style.minWidth = dynamicWidth + "px";
        } else {
            chartScrollInner.style.minWidth = "auto";
        }
        chartScrollWrapper.scrollLeft = chartScrollWrapper.scrollWidth;
    }
}

function renderHistory(txs) {
    historyListContainer.innerHTML = "";
    const filter = activeHistoryCategory;
    const query = historySearch.value.trim().toLowerCase();

    const filtered = txs.filter(t => {
        const matchesCategory = filter === "all" || t.category === filter;
        const matchesSearch = !query || (t.description && t.description.toLowerCase().includes(query)) || t.category.toLowerCase().includes(query) || translateCategory(t.category).toLowerCase().includes(query);
        return matchesCategory && matchesSearch;
    });

    renderTransactions(filtered, historyListContainer);
}

// ----------------------------------------------------
// ACTION CONTROLLERS & DIALOG LISTENERS
// ----------------------------------------------------
function setupQuickActions() {
    btnQuickAdd.addEventListener("click", () => {
        modalTxAmount.value = "";
        modalTxType.value = "expense";
        populateCategoryDropdown("expense");
        modalTxCategory.value = categories.find(c => c.type === "expense")?.name || "Другое";
        modalTxDesc.value = "";
        aiConfirmModal.classList.remove("hidden");
    });
}

function setupTransactionModals() {
    btnModalCancel.addEventListener("click", () => aiConfirmModal.classList.add("hidden"));
    
    // Handle dropdown update on type change
    modalTxType.addEventListener("change", () => {
        populateCategoryDropdown(modalTxType.value);
    });

    // Create category
    document.getElementById("btn-add-category").addEventListener("click", async () => {
        const name = prompt("Введите название новой категории:");
        if (!name || !name.trim()) return;
        const type = modalTxType.value;
        const cleanName = name.trim();

        const exists = categories.some(c => c.name.toLowerCase() === cleanName.toLowerCase() && c.type === type);
        if (exists) {
            alert("Категория с таким названием уже существует!");
            return;
        }

        if (useLocalFallback) {
            categories.push({ name: cleanName, type });
            localStorage.setItem("categories", JSON.stringify(categories));
            populateCategoryDropdown(type);
            modalTxCategory.value = cleanName;
        } else {
            try {
                const res = await fetch(`${API_BASE}/api/categories`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ name: cleanName, type })
                });
                if (res.ok) {
                    await loadCategories();
                    populateCategoryDropdown(type);
                    modalTxCategory.value = cleanName;
                } else {
                    const err = await res.json();
                    alert(err.detail || "Ошибка при создании категории");
                }
            } catch (e) {
                console.error("Create category error:", e);
            }
        }
    });

    // Delete category
    document.getElementById("btn-delete-category").addEventListener("click", async () => {
        const name = modalTxCategory.value;
        if (!name) return;
        const type = modalTxType.value;

        if (!confirm(`Вы уверены, что хотите удалить категорию "${name}"?`)) return;

        if (useLocalFallback) {
            categories = categories.filter(c => !(c.name === name && c.type === type));
            localStorage.setItem("categories", JSON.stringify(categories));
            populateCategoryDropdown(type);
        } else {
            try {
                const res = await fetch(`${API_BASE}/api/categories/delete`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ name, type })
                });
                if (res.ok) {
                    await loadCategories();
                    populateCategoryDropdown(type);
                } else {
                    alert("Ошибка при удалении категории");
                }
            } catch (e) {
                console.error("Delete category error:", e);
            }
        }
    });

    btnModalConfirm.addEventListener("click", async () => {
        const amount = parseFloat(modalTxAmount.value);
        const type = modalTxType.value;
        const category = modalTxCategory.value;
        const description = modalTxDesc.value.trim() || category;
        
        const success = await saveTransactionDirectly(amount, type, category, description);
        if (success) {
            aiConfirmModal.classList.add("hidden");
        }
    });
}

async function saveTransactionDirectly(amount, type, category, description) {
    if (isNaN(amount) || amount <= 0) {
        alert(currentLang === "en" ? "Enter a valid transaction amount." : "Введите корректную сумму операции.");
        return false;
    }

    const amountInRub = convertToRub(amount, expensesCurrency);
    const date = new Date().toISOString().slice(0, 10);
    const accountId = 1;

    if (useLocalFallback) {
        const transactions = JSON.parse(localStorage.getItem("transactions")) || DEFAULT_TRANSACTIONS;
        const accounts = JSON.parse(localStorage.getItem("accounts")) || DEFAULT_ACCOUNTS;
        const acc = accounts.find(a => a.id === accountId);
        
        if (type === "income") {
            acc.balance += amountInRub;
        } else {
            if (acc.balance < amountInRub) {
                const missing = amountInRub - acc.balance;
                alert(currentLang === "en" 
                    ? `Insufficient card balance. Missing ${formatCurrency(missing, expensesCurrency)}.` 
                    : `Недостаточно средств на балансе карты. Не хватает ${formatCurrency(missing, expensesCurrency)}.`);
                return false;
            }
            acc.balance -= amountInRub;
        }

        transactions.unshift({
            id: Date.now(),
            account_id: accountId,
            amount: amountInRub,
            type,
            category,
            description,
            date
        });

        localStorage.setItem("transactions", JSON.stringify(transactions));
        localStorage.setItem("accounts", JSON.stringify(accounts));
        
        aiTextInput.value = "";
        loadDataFromLocal();
        return true;
    } else {
        try {
            const res = await fetch(`${API_BASE}/api/transactions`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ account_id: accountId, amount: amountInRub, type, category, description, date })
            });
            if (res.ok) {
                aiTextInput.value = "";
                await loadAppData();
                return true;
            } else {
                const err = await res.json();
                alert(err.detail || (currentLang === "en" ? "Error saving transaction on server." : "Ошибка записи транзакции сервером"));
                return false;
            }
        } catch (e) {
            console.error(e);
            alert(currentLang === "en" ? "Connection error while saving transaction." : "Ошибка связи с сервером при сохранении");
            return false;
        }
    }
}

// Portfolio Asset Modals (Deposit/Buy & Sell Asset with Ticker Validation)
function setupAssetModals() {
    btnAssetDeposit.addEventListener("click", () => {
        assetModalTitle.textContent = "Пополнить актив в портфеле";
        assetSymbol.disabled = false;
        assetSymbol.value = "";
        assetQuantity.value = "";
        assetPrice.value = "";
        btnAssetDelete.classList.add("hidden");
        assetSymbolDropdown.classList.add("hidden");
        assetModal.classList.remove("hidden");
    });

    btnAssetCancel.addEventListener("click", () => {
        assetModal.classList.add("hidden");
        assetSymbolDropdown.classList.add("hidden");
    });

    // Live search debounced input handler
    let searchTimeout = null;
    assetType.addEventListener("change", () => {
        const type = assetType.value;
        if (type === "real_estate" || type === "deposit") {
            assetSymbolDropdown.classList.add("hidden");
            assetSymbolDropdown.innerHTML = "";
        }
    });
    assetSymbol.addEventListener("input", () => {
        const type = assetType.value;
        if (type === "real_estate" || type === "deposit") {
            assetSymbolDropdown.classList.add("hidden");
            assetSymbolDropdown.innerHTML = "";
            return;
        }
        const query = assetSymbol.value.trim();
        if (!query) {
            assetSymbolDropdown.classList.add("hidden");
            assetSymbolDropdown.innerHTML = "";
            return;
        }

        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(async () => {
            if (useLocalFallback) {
                let results = [];
                try {
                    const cgRes = await fetch(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(query)}`);
                    if (cgRes.ok) {
                        const cgData = await cgRes.json();
                        const coins = cgData.coins || [];
                        results = coins.slice(0, 5).map(c => ({
                            symbol: c.symbol.toUpperCase(),
                            name: c.name,
                            type: "crypto"
                        }));
                    }
                } catch (e) {
                    console.log("Local CG search failed, using static list:", e);
                }

                const popular = [
                    { symbol: "BTC-USD", name: "Bitcoin USD", type: "crypto" },
                    { symbol: "ETH-USD", name: "Ethereum USD", type: "crypto" },
                    { symbol: "SOL-USD", name: "Solana USD", type: "crypto" },
                    { symbol: "USDT", name: "Tether USD", type: "crypto" },
                    { symbol: "AAPL", name: "Apple Inc.", type: "shares" },
                    { symbol: "TSLA", name: "Tesla Inc.", type: "shares" },
                    { symbol: "MSFT", name: "Microsoft Corp.", type: "shares" },
                    { symbol: "NVDA", name: "NVIDIA Corp.", type: "shares" },
                    { symbol: "GOOG", name: "Alphabet Inc.", type: "shares" },
                    { symbol: "AMZN", name: "Amazon.com Inc.", type: "shares" }
                ];
                const staticMatches = popular.filter(p => 
                    p.symbol.toLowerCase().includes(query.toLowerCase()) || 
                    p.name.toLowerCase().includes(query.toLowerCase())
                );
                
                const seen = new Set();
                results = [...results, ...staticMatches].filter(item => {
                    const k = item.symbol;
                    if (seen.has(k)) return false;
                    seen.add(k);
                    return true;
                }).slice(0, 5);

                renderDropdown(results);
            } else {
                try {
                    const res = await fetch(`${API_BASE}/api/assets/search?q=${encodeURIComponent(query)}`);
                    if (res.ok) {
                        const results = await res.json();
                        renderDropdown(results.slice(0, 5));
                    }
                } catch (e) {
                    console.error("Asset search failed:", e);
                }
            }
        }, 300);
    });

    function renderDropdown(items) {
        assetSymbolDropdown.innerHTML = "";
        if (items.length === 0) {
            assetSymbolDropdown.classList.add("hidden");
            return;
        }

        items.forEach(item => {
            const div = document.createElement("div");
            div.className = "p-3 hover:bg-surface-container-low cursor-pointer border-b border-outline-variant/10 text-xs font-semibold text-on-surface flex justify-between items-center";
            div.innerHTML = `
                <div>
                    <span class="font-bold text-primary">${item.symbol}</span>
                    <span class="text-outline ml-1">${item.name}</span>
                </div>
                <span class="text-[9px] bg-primary/10 text-primary px-2 py-0.5 rounded-full font-bold uppercase">${getAssetTypeNameRu(item.type)}</span>
            `;
            div.addEventListener("click", async () => {
                assetSymbol.value = item.symbol;
                assetType.value = item.type;
                assetSymbolDropdown.classList.add("hidden");
                
                assetPrice.value = "";
                assetPrice.placeholder = "Загрузка цены...";
                if (useLocalFallback) {
                    const cleanSymbol = item.symbol.replace("-USD", "");
                    if (prices[cleanSymbol]) {
                        assetPrice.value = convertFromRub(prices[cleanSymbol], portfolioCurrency).toFixed(2);
                    } else {
                        assetPrice.value = convertFromRub(100.0, portfolioCurrency).toFixed(2);
                    }
                    assetPrice.placeholder = "0.00";
                } else {
                    try {
                        const priceRes = await fetch(`${API_BASE}/api/price?symbol=${item.symbol}`);
                        if (priceRes.ok) {
                            const priceData = await priceRes.json();
                            assetPrice.value = convertFromRub(priceData.price, portfolioCurrency).toFixed(2);
                        } else {
                            assetPrice.value = convertFromRub(100.0, portfolioCurrency).toFixed(2);
                        }
                    } catch (e) {
                        console.error("Fetch price failed:", e);
                        assetPrice.value = convertFromRub(100.0, portfolioCurrency).toFixed(2);
                    } finally {
                        assetPrice.placeholder = "0.00";
                    }
                }
            });
            assetSymbolDropdown.appendChild(div);
        });
        assetSymbolDropdown.classList.remove("hidden");
    }

    document.addEventListener("click", (e) => {
        if (!assetSymbol.contains(e.target) && !assetSymbolDropdown.contains(e.target)) {
            assetSymbolDropdown.classList.add("hidden");
        }
    });

    // Delete asset handler
    btnAssetDelete.addEventListener("click", async () => {
        const symbol = assetSymbol.value.trim().toUpperCase();
        if (!symbol) return;
        
        const confirmed = confirm(`Вы действительно хотите удалить актив ${symbol} из портфеля? Это действие не повлияет на историю транзакций.`);
        if (!confirmed) return;
        
        if (useLocalFallback) {
            let assets = JSON.parse(localStorage.getItem("assets")) || DEFAULT_ASSETS;
            assets = assets.filter(a => a.symbol.toUpperCase() !== symbol);
            localStorage.setItem("assets", JSON.stringify(assets));
            assetModal.classList.add("hidden");
            loadDataFromLocal();
        } else {
            try {
                const res = await fetch(`${API_BASE}/api/assets/delete`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ symbol })
                });
                if (res.ok) {
                    await initLoadedAssets();
                    assetModal.classList.add("hidden");
                    await loadAppData();
                } else {
                    alert("Ошибка при удалении актива на сервере");
                }
            } catch (e) {
                console.error("Failed to delete asset:", e);
                alert("Ошибка при удалении актива");
            }
        }
    });
    
    // Deposit Confirm with Real-time Market Ticker Verification
    btnAssetConfirm.addEventListener("click", async () => {
        const symbol = assetSymbol.value.trim().toUpperCase();
        const qty = parseFloat(assetQuantity.value);
        const price = parseFloat(assetPrice.value);
        const type = assetType.value;

        if (!symbol || isNaN(qty) || qty <= 0 || isNaN(price) || price <= 0) {
            alert("Пожалуйста, заполните параметры покупки корректно.");
            return;
        }

        btnAssetConfirm.disabled = true;
        btnAssetConfirm.textContent = "Проверка...";

        try {
            // Perform market lookup validation via backend or fallback list
            let isTickerValid = false;
            
            if (type === "real_estate" || type === "deposit") {
                isTickerValid = true;
            } else if (useLocalFallback) {
                // Static mock validations (allow BTC, ETH, stock symbols of 3-5 chars)
                const popularSymbols = ["BTC", "ETH", "AAPL", "TSLA", "MSFT", "SOL", "BNB", "GOOG", "NVDA", "AMZN", "XRP", "DOT", "ADA", "LTC"];
                if (popularSymbols.includes(symbol) || (symbol.length >= 3 && symbol.length <= 5)) {
                    isTickerValid = true;
                }
            } else {
                try {
                    const checkRes = await fetch(`${API_BASE}/api/price?symbol=${symbol}`);
                    if (checkRes.ok) {
                        const priceInfo = await checkRes.json();
                        isTickerValid = priceInfo.valid;
                    }
                } catch (e) {
                    console.warn("Failed lookup via backend, fallback validate:", e);
                    isTickerValid = true; // bypass if server has transient error during testing
                }
            }

            if (!isTickerValid) {
                alert(`Актив с тикером "${symbol}" не найден на рынке! Укажите существующий тикер.`);
                return;
            }

            const date = new Date().toISOString().slice(0, 10);
            const cost = qty * convertToRub(price, portfolioCurrency); // Convert input price in portfolio currency to RUB cost for card deduction

            if (useLocalFallback) {
                const accounts = JSON.parse(localStorage.getItem("accounts")) || DEFAULT_ACCOUNTS;
                const assets = JSON.parse(localStorage.getItem("assets")) || DEFAULT_ASSETS;
                const transactions = JSON.parse(localStorage.getItem("transactions")) || DEFAULT_TRANSACTIONS;
                
                const cardAcc = accounts.find(a => a.id === 1);
                if (cardAcc.balance < cost) {
                    const missing = cost - cardAcc.balance;
                    alert(`Недостаточно средств на балансе карты. Не хватает ${formatCurrency(missing, expensesCurrency)} для совершения покупки.`);
                    return;
                }

                // Deduct card balance
                cardAcc.balance -= cost;

                // Update assets list
                const existing = assets.find(a => a.symbol === symbol);
                if (existing) {
                    const totalQty = existing.quantity + qty;
                    existing.current_price = parseFloat(((existing.quantity * existing.current_price + cost) / totalQty).toFixed(2));
                    existing.quantity = totalQty;
                    existing.type = type;
                } else {
                    assets.push({
                        id: Date.now(),
                        account_id: 2,
                        symbol,
                        quantity: qty,
                        current_price: convertToRub(price, portfolioCurrency), // Save current price in RUB
                        type
                    });
                }

                // Record transaction as transfer
                transactions.unshift({
                    id: Date.now(),
                    account_id: 1,
                    amount: cost,
                    type: "transfer",
                    category: "В портфель",
                    description: `Покупка ${symbol}`,
                    date
                });

                localStorage.setItem("accounts", JSON.stringify(accounts));
                localStorage.setItem("assets", JSON.stringify(assets));
                localStorage.setItem("transactions", JSON.stringify(transactions));
                
                assetModal.classList.add("hidden");
                loadDataFromLocal();
            } else {
                // Server Sync
                try {
                    // First check card balance
                    const statusRes = await fetch(`${API_BASE}/api/status`);
                    const status = await statusRes.json();
                    if (status.cash_balance < cost) {
                        const missing = cost - status.cash_balance;
                        alert(`Недостаточно средств на балансе карты. Не хватает ${formatCurrency(missing, expensesCurrency)} для совершения покупки.`);
                        return;
                    }

                    const txRes = await fetch(`${API_BASE}/api/transactions`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ account_id: 1, amount: cost, type: "transfer", category: "В портфель", description: `Покупка ${symbol}`, date })
                    });

                    if (txRes.ok) {
                        // Update asset: fetch current asset quantity first to do cumulative calculation
                        const assetsRes = await fetch(`${API_BASE}/api/assets`);
                        const assetsData = await assetsRes.json();
                        const existing = assetsData.assets.find(a => a.symbol === symbol);
                        
                        let newQty = qty;
                        let newPrice = convertToRub(price, portfolioCurrency); // Convert input price in portfolio currency to RUB on save
                        if (existing) {
                            newQty = existing.quantity + qty;
                            newPrice = parseFloat(((existing.quantity * existing.current_price + cost) / newQty).toFixed(2));
                        }
                        
                        await fetch(`${API_BASE}/api/assets`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ symbol, quantity: newQty, current_price: newPrice, type })
                        });
                        
                        await initLoadedAssets();
                        assetModal.classList.add("hidden");
                        await loadAppData();
                    } else {
                        const err = await txRes.json();
                        alert(err.detail || "Ошибка пополнения актива на сервере");
                    }
                } catch (e) {
                    console.error(e);
                    alert("Ошибка связи с сервером при покупке актива");
                }
            }
        } finally {
            btnAssetConfirm.disabled = false;
            btnAssetConfirm.textContent = "Купить";
        }
    });

    // Sell/Withdraw asset triggers
    btnAssetSellTrigger.addEventListener("click", () => {
        sellAssetSymbol.innerHTML = "";
        
        let activeAssets = [];
        if (useLocalFallback) {
            const assets = JSON.parse(localStorage.getItem("assets")) || DEFAULT_ASSETS;
            activeAssets = assets.filter(a => a.quantity > 0);
        }
        
        if (useLocalFallback) {
            if (activeAssets.length === 0) {
                alert("У вас нет активных активов для продажи.");
                return;
            }
            activeAssets.forEach(a => {
                const opt = document.createElement("option");
                opt.value = a.symbol;
                opt.textContent = `${a.symbol} (${getAssetTypeNameRu(a.type)}, доступно: ${a.quantity} шт.)`;
                sellAssetSymbol.appendChild(opt);
            });
            
            const firstSymbol = activeAssets[0].symbol;
            sellAssetPrice.value = convertFromRub(activeAssets[0].current_price, portfolioCurrency).toFixed(2);
            sellAssetQuantity.value = "";
            sellAssetModal.classList.remove("hidden");
        } else {
            fetch(`${API_BASE}/api/assets`)
                .then(res => res.json())
                .then(data => {
                    const activeAssets = data.assets.filter(a => a.quantity > 0);
                    if (activeAssets.length === 0) {
                        alert("У вас нет активных активов для продажи.");
                        return;
                    }
                    activeAssets.forEach(a => {
                        const opt = document.createElement("option");
                        opt.value = a.symbol;
                        opt.textContent = `${a.symbol} (${getAssetTypeNameRu(a.type)}, доступно: ${a.quantity} шт.)`;
                        sellAssetSymbol.appendChild(opt);
                    });
                    sellAssetPrice.value = convertFromRub(activeAssets[0].current_price, portfolioCurrency).toFixed(2);
                    sellAssetQuantity.value = "";
                    sellAssetModal.classList.remove("hidden");
                });
        }
    });

    sellAssetSymbol.addEventListener("change", () => {
        const symbol = sellAssetSymbol.value;
        if (useLocalFallback) {
            const assets = JSON.parse(localStorage.getItem("assets")) || DEFAULT_ASSETS;
            const asset = assets.find(a => a.symbol === symbol);
            if (asset) sellAssetPrice.value = convertFromRub(asset.current_price, portfolioCurrency).toFixed(2);
        } else {
            fetch(`${API_BASE}/api/assets`)
                .then(res => res.json())
                .then(data => {
                    const asset = data.assets.find(a => a.symbol === symbol);
                    if (asset) sellAssetPrice.value = convertFromRub(asset.current_price, portfolioCurrency).toFixed(2);
                });
        }
    });

    btnSellAssetCancel.addEventListener("click", () => sellAssetModal.classList.add("hidden"));
    
    // Max button logic for selling assets
    if (btnSellAssetMax) {
        btnSellAssetMax.addEventListener("click", () => {
            if (tg && tg.HapticFeedback) {
                tg.HapticFeedback.impactOccurred("medium");
            }
            const symbol = sellAssetSymbol.value;
            let qty = 0;
            if (useLocalFallback) {
                const assets = JSON.parse(localStorage.getItem("assets")) || DEFAULT_ASSETS;
                const asset = assets.find(a => a.symbol === symbol);
                if (asset) qty = asset.quantity;
            } else {
                const asset = loadedAssets.find(a => a.symbol === symbol);
                if (asset) qty = asset.quantity;
            }
            sellAssetQuantity.value = qty;
        });
    }
    
    // Confirm sell asset
    btnSellAssetConfirm.addEventListener("click", async () => {
        const symbol = sellAssetSymbol.value;
        const qty = parseFloat(sellAssetQuantity.value);
        const price = parseFloat(sellAssetPrice.value);

        if (isNaN(qty) || qty <= 0 || isNaN(price) || price <= 0) {
            alert("Пожалуйста, заполните параметры продажи корректно.");
            return;
        }

        btnSellAssetConfirm.disabled = true;
        const originalText = btnSellAssetConfirm.textContent;
        btnSellAssetConfirm.textContent = "Обработка...";

        try {
            const date = new Date().toISOString().slice(0, 10);
            const earningsInRub = qty * convertToRub(price, portfolioCurrency); // Convert price in portfolio currency to RUB earnings

            if (useLocalFallback) {
                const accounts = JSON.parse(localStorage.getItem("accounts")) || DEFAULT_ACCOUNTS;
                const assets = JSON.parse(localStorage.getItem("assets")) || DEFAULT_ASSETS;
                const transactions = JSON.parse(localStorage.getItem("transactions")) || DEFAULT_TRANSACTIONS;
                
                const asset = assets.find(a => a.symbol === symbol);
                if (!asset || asset.quantity < qty) {
                    alert("У вас недостаточно единиц этого актива для продажи.");
                    return;
                }

                const costBasis = asset.current_price; // in RUB
                const cost = qty * costBasis; // in RUB
                let transfer_amount = 0;
                let income_amount = 0;

                if (earningsInRub > cost) {
                    transfer_amount = cost;
                    income_amount = earningsInRub - cost;
                } else {
                    transfer_amount = earningsInRub;
                    income_amount = 0;
                }

                // Update quantity or set to 0 if sold out
                if (asset.quantity <= qty) {
                    asset.quantity = 0;
                } else {
                    asset.quantity -= qty;
                }
                
                // Add earnings to card balance
                const cardAcc = accounts.find(a => a.id === 1);
                cardAcc.balance += earningsInRub;

                // Record transfer transaction
                transactions.unshift({
                    id: Date.now(),
                    account_id: 2,
                    amount: transfer_amount,
                    type: "transfer",
                    category: "На карту",
                    description: `Возврат от продажи ${symbol}`,
                    date
                });

                // Record income transaction if profit > 0
                if (income_amount > 0) {
                    transactions.unshift({
                        id: Date.now() + 1,
                        account_id: 1,
                        amount: income_amount,
                        type: "income",
                        category: "Инвестиции",
                        description: `Доход от продажи ${symbol}`,
                        date
                    });
                }

                localStorage.setItem("accounts", JSON.stringify(accounts));
                localStorage.setItem("assets", JSON.stringify(assets));
                localStorage.setItem("transactions", JSON.stringify(transactions));
                
                sellAssetModal.classList.add("hidden");
                loadDataFromLocal();
            } else {
                // Server Sync
                try {
                    const assetRes = await fetch(`${API_BASE}/api/assets`);
                    const assetData = await assetRes.json();
                    const asset = assetData.assets.find(a => a.symbol === symbol);
                    
                    if (!asset || asset.quantity < qty) {
                        alert("У вас недостаточно единиц этого актива для продажи.");
                        return;
                    }

                    const costBasis = asset.current_price; // in RUB
                    const cost = qty * costBasis; // in RUB
                    let transfer_amount = 0;
                    let income_amount = 0;

                    if (earningsInRub > cost) {
                        transfer_amount = cost;
                        income_amount = earningsInRub - cost;
                    } else {
                        transfer_amount = earningsInRub;
                        income_amount = 0;
                    }

                    // Add transfer transaction via server endpoint
                    const transferTxRes = await fetch(`${API_BASE}/api/transactions`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ account_id: 2, amount: transfer_amount, type: "transfer", category: "На карту", description: `Возврат от продажи ${symbol}`, date })
                    });

                    if (transferTxRes.ok) {
                        // Add income transaction if profit > 0
                        if (income_amount > 0) {
                            await fetch(`${API_BASE}/api/transactions`, {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ account_id: 1, amount: income_amount, type: "income", category: "Инвестиции", description: `Доход от продажи ${symbol}`, date })
                            });
                        }

                        const newQty = Math.max(0, asset.quantity - qty);
                        await fetch(`${API_BASE}/api/assets`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ symbol, quantity: newQty, current_price: costBasis, type: asset.type })
                        });
                        
                        await initLoadedAssets();
                        sellAssetModal.classList.add("hidden");
                        await loadAppData();
                    } else {
                        alert("Ошибка продажи актива на сервере");
                    }
                } catch (e) {
                    console.error(e);
                    alert("Ошибка связи с сервером при продаже актива");
                }
            }
        } finally {
            btnSellAssetConfirm.disabled = false;
            btnSellAssetConfirm.textContent = originalText;
        }
    });
}

// Settings and General Listeners
function setupSettingsPanel() {
    btnSaveSettings.addEventListener("click", async () => {
        const key = settingGeminiKey.value.trim();
        localStorage.setItem("gemini_api_key", key);
        geminiApiKey = key;
        
        const settingFirebaseUrl = document.getElementById("setting-firebase-url");
        if (settingFirebaseUrl) {
            localStorage.setItem("customFirebaseUrl", settingFirebaseUrl.value.trim());
        }
        
        if (settingExpensesCurrency && settingPortfolioCurrency) {
            expensesCurrency = settingExpensesCurrency.value;
            portfolioCurrency = settingPortfolioCurrency.value;
            localStorage.setItem("expenses_currency", expensesCurrency);
            localStorage.setItem("portfolio_currency", portfolioCurrency);
        }

        currentLang = "ru";
        localStorage.setItem("language", "ru");

        confirmAi = false;
        localStorage.setItem("confirm_ai", "false");
        
        const settingAutoloadChart = document.getElementById("setting-autoload-chart");
        if (settingAutoloadChart) {
            localStorage.setItem("autoloadChart", settingAutoloadChart.checked ? "true" : "false");
        }
        
        applyLanguage(currentLang);
        alert(currentLang === "en" ? "Settings saved successfully!" : "Настройки успешно сохранены!");
        await loadAppData();
        switchView("home");
    });

    // Access Key copying logic
    const btnCopySettingKey = document.getElementById("btn-copy-setting-key");
    const settingAccessKey = document.getElementById("setting-access-key");
    if (btnCopySettingKey && settingAccessKey) {
        btnCopySettingKey.addEventListener("click", () => {
            if (tg && tg.HapticFeedback) {
                tg.HapticFeedback.impactOccurred("medium");
            }
            const keyText = settingAccessKey.value;
            if (keyText) {
                navigator.clipboard.writeText(keyText).then(() => {
                    const originalText = btnCopySettingKey.innerHTML;
                    btnCopySettingKey.innerHTML = `<span class="material-symbols-outlined text-[16px]">done</span>`;
                    setTimeout(() => {
                        btnCopySettingKey.innerHTML = originalText;
                    }, 2000);
                }).catch(err => {
                    console.error("Could not copy setting key: ", err);
                });
            }
        });
    }

    const btnCloseDetails = document.getElementById("btn-close-details");
    if (btnCloseDetails) {
        btnCloseDetails.addEventListener("click", () => {
            const modal = document.getElementById("asset-details-modal");
            if (modal) modal.classList.add("hidden");
        });
    }



    btnResetDb.addEventListener("click", async () => {
        if (confirm("Вы действительно хотите сбросить всю базу данных к начальным настройкам? Все ваши транзакции будут стерты!")) {
            if (useLocalFallback) {
                initLocalDb(true);
                alert("База данных успешно очищена.");
                switchView("home");
            } else {
                try {
                    const res = await fetch(`${API_BASE}/api/reset`, { method: "POST" });
                    if (res.ok) {
                        alert("База данных успешно очищена на сервере.");
                        switchView("home");
                    } else {
                        alert("Ошибка сброса базы данных на сервере.");
                    }
                } catch (e) {
                    console.error("Reset failed:", e);
                    alert("Ошибка сброса базы данных.");
                }
            }
        }
    });

    // History filter chips
    const chips = historyFilterChips.querySelectorAll("button");
    chips.forEach(chip => {
        chip.addEventListener("click", () => {
            chips.forEach(c => {
                c.classList.remove("bg-primary", "text-white");
                c.classList.add("bg-surface-container", "text-outline");
            });
            chip.classList.add("bg-primary", "text-white");
            chip.classList.remove("bg-surface-container", "text-outline");
            
            activeHistoryCategory = chip.dataset.category;
            loadAppData();
        });
    });

    // Search input
    historySearch.addEventListener("input", () => {
        loadAppData();
    });

    // Stats View date change listeners
    statsStartDate.addEventListener("change", () => {
        if (statsTimeframe.value === "custom") loadAppData();
    });
    statsEndDate.addEventListener("change", () => {
        if (statsTimeframe.value === "custom") loadAppData();
    });

    // Logout Handler
    const btnLogout = document.getElementById("btn-logout");
    if (btnLogout) {
        btnLogout.addEventListener("click", () => {
            if (confirm(currentLang === "en" ? "Are you sure you want to log out?" : "Вы уверены, что хотите выйти из аккаунта?")) {
                localStorage.removeItem("isLoggedIn");
                localStorage.removeItem("userKey");
                clearUserSessionData();
                switchView("login");
            }
        });
    }
}

function clearUserSessionData() {
    localStorage.removeItem("accounts");
    localStorage.removeItem("transactions");
    localStorage.removeItem("assets");
    localStorage.removeItem("categories");
}

function updateUserRegistry() {
    const userKey = localStorage.getItem("userKey");
    if (!userKey) return;
    
    const accounts = localStorage.getItem("accounts");
    const transactions = localStorage.getItem("transactions");
    const assets = localStorage.getItem("assets");
    const categories = localStorage.getItem("categories");
    
    let registry = {};
    try {
        registry = JSON.parse(localStorage.getItem("userAccountsRegistry") || "{}");
    } catch (e) {
        registry = {};
    }
    
    registry[userKey] = {
        accounts: accounts ? JSON.parse(accounts) : null,
        transactions: transactions ? JSON.parse(transactions) : null,
        assets: assets ? JSON.parse(assets) : null,
        categories: categories ? JSON.parse(categories) : null,
        updatedAt: Date.now()
    };
    
    localStorage.setItem("userAccountsRegistry", JSON.stringify(registry));
}

function setupPortfolioFilters() {
    const container = document.getElementById("portfolio-filter-chips");
    if (!container) return;
    const chips = container.querySelectorAll("button");
    chips.forEach(chip => {
        chip.addEventListener("click", () => {
            chips.forEach(c => {
                c.classList.remove("bg-primary", "text-white");
                c.classList.add("bg-surface-container", "text-outline");
            });
            chip.classList.add("bg-primary", "text-white");
            chip.classList.remove("bg-surface-container", "text-outline");
            
            activeAssetFilter = chip.dataset.filter;
            loadAppData();
        });
    });
}

// ----------------------------------------------------
// GEMINI AI INPUT PARSER
// ----------------------------------------------------
function setupAiInputListeners() {
    btnAiSubmit.addEventListener("click", parseTextWithAI);
    aiTextInput.addEventListener("keypress", (e) => {
        if (e.key === "Enter") {
            parseTextWithAI();
        }
    });
}
setupAiInputListeners();

async function parseTextWithAI() {
    const text = aiTextInput.value.trim();
    if (!text) return;
    
    if (!geminiApiKey) {
        alert(currentLang === "en" ? "Please enter your Gemini API Key in the settings!" : "Пожалуйста, введите ваш Gemini API ключ в настройках!");
        switchView("settings");
        return;
    }

    btnAiSubmit.disabled = true;
    btnAiSubmit.innerHTML = `<span class="material-symbols-outlined animate-spin text-[16px]">refresh</span>`;

    const systemPrompt = `
Ты — финансовый аналитик. Твоя задача — разобрать произвольный текст о доходах или расходах и извлечь структурированные данные.
Список доступных категорий: Продукты, Транспорт, Кафе и рестораны, Жилье и ЖКХ, Развлечения, Здоровье, Зарплата, Инвестиции, Другое.

Текст пользователя: "${text}"

Текущая валюта пользователя по умолчанию: ${expensesCurrency} (если валюта явно не указана в тексте, используй её).

Верни строго валидный JSON в следующем формате:
{
  "amount": float (положительное число),
  "currency": "RUB" | "USD" | "EUR" (валюта, в которой указана сумма в тексте пользователя, или валюта по умолчанию "${expensesCurrency}", если в тексте нет явного упоминания валюты),
  "type": "expense" | "income",
  "category": "одна категория из списка выше, наиболее близкая по смыслу",
  "description": "короткое описание сути платежа на русском языке (если в покупке несколько позиций с ценами, обязательно подробно перечисли их с ценами через запятую, например: 'пельмени: 200 руб, доширак: 100 руб', а в amount запиши их общую сумму)"
}
Отвечай ТОЛЬКО чистым JSON без каких-либо дополнительных слов, комментариев или разметки markdown.`;

    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${geminiApiKey}`;
        const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{ parts: [{ text: systemPrompt }] }]
            })
        });
        
        if (!res.ok) {
            throw new Error(`Gemini API returned status ${res.status}`);
        }
        
        const responseData = await res.json();
        const rawResponse = responseData.candidates[0].content.parts[0].text.trim();
        
        const cleanedResponse = rawResponse.replace(/```json/gi, "").replace(/```/g, "").trim();
        const parsed = JSON.parse(cleanedResponse);
        
        const parsedAmount = parsed.amount || 0;
        const parsedCurrency = (parsed.currency || expensesCurrency).toUpperCase();
        const parsedType = parsed.type || "expense";
        let parsedCategory = parsed.category || "Другое";
        
        populateCategoryDropdown(parsedType);
        const selectOptions = Array.from(modalTxCategory.options).map(o => o.value);
        if (selectOptions.includes(parsedCategory)) {
            modalTxCategory.value = parsedCategory;
        } else {
            modalTxCategory.value = "Другое";
            parsedCategory = "Другое";
        }
        
        const parsedDesc = parsed.description || parsedCategory;

        const amountInRub = convertToRub(parsedAmount, parsedCurrency);
        const amountInExpensesCurrency = parseFloat(convertFromRub(amountInRub, expensesCurrency).toFixed(2));

        if (!confirmAi) {
            const success = await saveTransactionDirectly(amountInExpensesCurrency, parsedType, parsedCategory, parsedDesc);
            if (success) {
                const successMsg = currentLang === "en"
                    ? `Saved: ${translateCategory(parsedCategory)} - ${formatCurrency(amountInRub, expensesCurrency)} (${parsedDesc})`
                    : `Успешно сохранено: ${translateCategory(parsedCategory)} - ${formatCurrency(amountInRub, expensesCurrency)} (${parsedDesc})`;
                alert(successMsg);
            }
        } else {
            modalTxAmount.value = amountInExpensesCurrency || "";
            modalTxType.value = parsedType;
            populateCategoryDropdown(parsedType);
            modalTxCategory.value = parsedCategory;
            modalTxDesc.value = parsed.description || "";
            aiConfirmModal.classList.remove("hidden");
        }
    } catch (e) {
        console.error("Gemini Parsing failed:", e);
        alert(currentLang === "en" ? "Failed to parse transaction using AI. Check your API key or enter details manually." : "Не удалось распознать запись с помощью ИИ. Проверьте правильность API ключа или введите данные вручную.");
    } finally {
        btnAiSubmit.disabled = false;
        btnAiSubmit.innerHTML = `<span class="material-symbols-outlined text-[18px]" style="font-variation-settings: 'FILL' 1;">send</span>`;
    }
}

// ----------------------------------------------------
// LOCALIZATION & TRANSLATIONS
// ----------------------------------------------------
const CATEGORY_MAP = {
    "ru": {
        "Продукты": "Продукты",
        "Транспорт": "Транспорт",
        "Кафе и рестораны": "Кафе и рестораны",
        "Жилье и ЖКХ": "Жилье и ЖКХ",
        "Развлечения": "Развлечения",
        "Здоровье": "Здоровье",
        "Зарплата": "Зарплата",
        "Инвестиции": "Инвестиции",
        "В портфель": "В портфель",
        "На карту": "На карту",
        "Другое": "Другое"
    },
    "en": {
        "Продукты": "Groceries",
        "Транспорт": "Transport",
        "Кафе и рестораны": "Restaurants",
        "Жилье и ЖКХ": "Utilities",
        "Развлечения": "Entertainment",
        "Здоровье": "Healthcare",
        "Зарплата": "Salary",
        "Инвестиции": "Investments",
        "В портфель": "To portfolio",
        "На карту": "To card",
        "Другое": "Other"
    }
};

const translations = {
    "ru": {
        "app_title": "Общий капитал",
        "header_home": "Общий капитал",
        "header_stats": "Статистика",
        "header_invest": "Мои инвестиции",
        "header_history": "Все операции",
        "header_settings": "Настройки",
        "net_worth_lbl": "Сумма всех средств",
        "net_worth_date": "Обновлено только что",
        "net_worth_trend": "Капитал",
        "voice_placeholder": "Куда ушли деньги? Напишите...",
        "btn_quick_add": "Добавить операцию",
        "recent_txs": "Последние транзакции",
        "see_all": "Все",
        "stats_card_balance": "Средства на картах",
        "stats_flow": "Поток средств",
        "stats_subtitle_5": "Динамика за 5 периодов",
        "stats_subtitle_30": "Последние 30 дней",
        "stats_subtitle_12": "Последние 12 месяцев",
        "stats_subtitle_custom": "Произвольный период",
        "stats_inc": "Доход",
        "stats_exp": "Расход",
        "stats_inc_total": "Всего доходов",
        "stats_exp_total": "Всего расходов",
        "stats_inc_cats": "Категории доходов",
        "stats_exp_cats": "Категории трат",
        "stats_transfers": "Переводы",
        "portfolio_header": "Инвестиционный портфель",
        "portfolio_today": "Сегодня",
        "btn_deposit": "Пополнить актив",
        "btn_sell": "Продать актив",
        "my_assets": "Мои Активы",
        "history_header": "История операций",
        "history_search_placeholder": "Поиск по описанию...",
        "settings_header": "Настройки системы",
        "setting_gemini_key": "Ключ Gemini API",
        "setting_gemini_key_desc": "Ключ используется только на вашем устройстве для распознавания текстовых транзакций и никогда не передается на сервер.",
        "setting_confirm_ai": "Подтверждать транзакции ИИ",
        "setting_confirm_ai_desc": "Показывать модальное окно перед сохранением распознанных данных",
        "setting_currency_header": "Валюта интерфейса",
        "setting_expenses_currency": "Валюта операций (Доходы/Расходы)",
        "setting_portfolio_currency": "Валюта инвестиций (Портфель)",
        "setting_language": "Язык интерфейса",
        "btn_save_settings": "Сохранить настройки",
        "setting_cloud_header": "Облачное хранилище",
        "setting_access_key_title": "Ваш ключ доступа (Access Key)",
        "setting_firebase_url_title": "URL-адрес Firebase Database",
        "setting_firebase_url_desc": "Оставьте пустым для использования стандартного защищенного облака.",
        "setting_charts_header": "Интеграция графиков",
        "setting_autoload_chart_title": "Автозагрузка графиков",
        "setting_autoload_chart_desc": "Автоматически загружать виджет TradingView при просмотре актива",
        "setting_logout_header": "Выход из системы",
        "setting_logout_desc": "Выйти из текущей сессии. Для повторного входа в аккаунт потребуется ключ доступа.",
        "btn_logout": "Выйти из аккаунта",
        "reset_header": "Сброс данных",
        "reset_desc": "Удаление всей локальной базы транзакций и восстановление начальных счетов.",
        "btn_reset": "Очистить базу данных",
        "nav_stats": "Анализ",
        "nav_portfolio": "Портфель",
        "nav_home": "Обзор",
        "nav_history": "История",
        "nav_settings": "Настройки",
        "modal_tx_title": "Операция транзакции",
        "modal_tx_desc": "Пожалуйста, проверьте и подтвердите детали финансовой операции:",
        "modal_tx_amount": "Сумма",
        "modal_tx_type": "Тип операции",
        "modal_tx_type_expense": "Расход",
        "modal_tx_type_income": "Доход",
        "modal_tx_category": "Категория",
        "modal_tx_add_cat": "Добавить",
        "modal_tx_del_cat": "Удалить",
        "modal_tx_desc_lbl": "Описание / Заметка",
        "modal_cancel": "Отмена",
        "modal_confirm": "Сохранить",
        "modal_confirm_buy": "Купить",
        "modal_confirm_sell": "Продать",
        "modal_buy_title": "Пополнить актив в портфеле",
        "modal_buy_desc": "Впишите детали покупки инвестиционного актива. Покупка спишется с вашей карты.",
        "modal_buy_type": "Тип инвестиционного актива",
        "modal_buy_symbol": "Символ актива (например: BTC, AAPL)",
        "modal_buy_quantity": "Добавляемое количество",
        "modal_buy_price": "Цена сделки",
        "modal_sell_title": "Продать актив",
        "modal_sell_desc": "Выберите актив для продажи. Сумма выручки зачислится обратно на баланс карты как доход.",
        "modal_sell_symbol": "Актив для продажи",
        "modal_sell_quantity": "Продаваемое количество",
        "modal_sell_price": "Цена продажи"
    },
    "en": {
        "app_title": "Total Capital",
        "header_home": "Total Capital",
        "header_stats": "Statistics",
        "header_invest": "My Investments",
        "header_history": "All Operations",
        "header_settings": "Settings",
        "net_worth_lbl": "Total Net Worth",
        "net_worth_date": "Updated just now",
        "net_worth_trend": "Capital",
        "voice_placeholder": "Where did the money go? Write...",
        "btn_quick_add": "Add Transaction",
        "recent_txs": "Recent Transactions",
        "see_all": "All",
        "stats_card_balance": "Card Balance",
        "stats_flow": "Cash Flow",
        "stats_subtitle_5": "Trend for 5 periods",
        "stats_subtitle_30": "Last 30 days",
        "stats_subtitle_12": "Last 12 months",
        "stats_subtitle_custom": "Custom Period",
        "stats_inc": "Income",
        "stats_exp": "Expense",
        "stats_inc_total": "Total Income",
        "stats_exp_total": "Total Expense",
        "stats_inc_cats": "Income Categories",
        "stats_exp_cats": "Expense Categories",
        "stats_transfers": "Transfers",
        "portfolio_header": "Investment Portfolio",
        "portfolio_today": "Today",
        "btn_deposit": "Buy Asset",
        "btn_sell": "Sell Asset",
        "my_assets": "My Assets",
        "history_header": "Transaction History",
        "history_search_placeholder": "Search by description...",
        "settings_header": "System Settings",
        "setting_gemini_key": "Gemini API Key",
        "setting_gemini_key_desc": "The key is only used on your device for parsing text transactions and is never sent to the server.",
        "setting_confirm_ai": "Confirm AI Transactions",
        "setting_confirm_ai_desc": "Show confirmation modal before saving parsed data",
        "setting_currency_header": "Interface Currency",
        "setting_expenses_currency": "Expenses/Incomes Currency",
        "setting_portfolio_currency": "Portfolio Currency",
        "setting_language": "Interface Language",
        "btn_save_settings": "Save Settings",
        "setting_cloud_header": "Cloud Storage",
        "setting_access_key_title": "Your Access Key",
        "setting_firebase_url_title": "Firebase Database URL",
        "setting_firebase_url_desc": "Leave empty to use standard secure cloud storage.",
        "setting_charts_header": "Charts Integration",
        "setting_autoload_chart_title": "Autoload Charts",
        "setting_autoload_chart_desc": "Automatically load TradingView widget when viewing asset",
        "setting_logout_header": "Logout",
        "setting_logout_desc": "Log out of current session. You will need your access key to log back in.",
        "btn_logout": "Log Out",
        "reset_header": "Data Reset",
        "reset_desc": "Delete the entire local transaction database and restore initial accounts.",
        "btn_reset": "Clear Database",
        "nav_stats": "Analysis",
        "nav_portfolio": "Portfolio",
        "nav_home": "Overview",
        "nav_history": "History",
        "nav_settings": "Settings",
        "modal_tx_title": "Transaction Operation",
        "modal_tx_desc": "Please review and confirm transaction details:",
        "modal_tx_amount": "Amount",
        "modal_tx_type": "Operation Type",
        "modal_tx_type_expense": "Expense",
        "modal_tx_type_income": "Income",
        "modal_tx_category": "Category",
        "modal_tx_add_cat": "Add",
        "modal_tx_del_cat": "Delete",
        "modal_tx_desc_lbl": "Description / Note",
        "modal_cancel": "Cancel",
        "modal_confirm": "Save",
        "modal_confirm_buy": "Buy",
        "modal_confirm_sell": "Sell",
        "modal_buy_title": "Buy Asset",
        "modal_buy_desc": "Enter asset purchase details. Funds will be deducted from your card.",
        "modal_buy_type": "Asset Type",
        "modal_buy_symbol": "Asset Ticker (e.g., BTC, AAPL)",
        "modal_buy_quantity": "Quantity to Add",
        "modal_buy_price": "Deal Price",
        "modal_sell_title": "Sell Asset",
        "modal_sell_desc": "Select asset to sell. Earnings will be credited to your card balance.",
        "modal_sell_symbol": "Asset to Sell",
        "modal_sell_quantity": "Quantity to Sell",
        "modal_sell_price": "Sale Price"
    }
};

function translateCategory(catName) {
    if (!catName) return "";
    const map = CATEGORY_MAP[currentLang];
    return map ? (map[catName] || catName) : catName;
}

function translateFilterChipsText() {
    const portChips = document.querySelectorAll("#portfolio-filter-chips button");
    const portLabels = {
        "all": currentLang === "en" ? "All" : "Все",
        "shares": currentLang === "en" ? "Stocks" : "Акции",
        "bonds": currentLang === "en" ? "Bonds" : "Облигации",
        "crypto": currentLang === "en" ? "Crypto" : "Крипта",
        "realty": currentLang === "en" ? "Real Estate" : "Недвижимость",
        "deposit": currentLang === "en" ? "Deposits" : "Вклады",
        "other": currentLang === "en" ? "Other" : "Другое"
    };
    portChips.forEach(chip => {
        const filterVal = chip.dataset.filter;
        if (portLabels[filterVal]) {
            chip.textContent = portLabels[filterVal];
        }
    });

    const histChips = document.querySelectorAll("#history-filter-chips button");
    histChips.forEach(chip => {
        const catVal = chip.dataset.category;
        if (catVal === "all") {
            chip.textContent = currentLang === "en" ? "All" : "Все";
        } else {
            chip.textContent = translateCategory(catVal);
        }
    });
}

function applyLanguage(lang) {
    currentLang = lang;
    const t = translations[lang] || translations["ru"];

    const lblNetWorth = document.getElementById("lbl-net-worth");
    if (lblNetWorth) lblNetWorth.textContent = t.net_worth_lbl;
    const netWorthDate = document.getElementById("net-worth-date");
    if (netWorthDate) netWorthDate.textContent = t.net_worth_date;
    const netWorthTrend = document.getElementById("net-worth-trend");
    if (netWorthTrend) netWorthTrend.textContent = t.net_worth_trend;
    const aiTextInput = document.getElementById("ai-text-input");
    if (aiTextInput) aiTextInput.placeholder = t.voice_placeholder;
    const lblBtnQuickAdd = document.getElementById("lbl-btn-quick-add");
    if (lblBtnQuickAdd) lblBtnQuickAdd.textContent = t.btn_quick_add;
    const lblRecentTransactions = document.getElementById("lbl-recent-transactions");
    if (lblRecentTransactions) lblRecentTransactions.textContent = t.recent_txs;
    const btnSeeAllTx = document.getElementById("btn-see-all-tx");
    if (btnSeeAllTx) btnSeeAllTx.textContent = t.see_all;

    // Header updates dynamically
    const user = tg && tg.initDataUnsafe?.user;
    if (currentTab === "home") {
        headerTitle.textContent = user ? `${t.header_home} (${user.first_name})` : t.header_home;
    } else if (currentTab === "stats") {
        headerTitle.textContent = t.header_stats;
    } else if (currentTab === "invest") {
        headerTitle.textContent = t.header_invest;
    } else if (currentTab === "history") {
        headerTitle.textContent = t.header_history;
    } else if (currentTab === "settings") {
        headerTitle.textContent = t.header_settings;
    }

    const lblStatsCardBalance = document.getElementById("lbl-stats-cards-balance");
    if (lblStatsCardBalance) lblStatsCardBalance.textContent = t.stats_card_balance;
    const lblFlow = document.getElementById("lbl-flow");
    if (lblFlow) lblFlow.textContent = t.stats_flow;
    
    const statsIncTotalLabel = document.querySelector("#view-stats .grid > div:first-child span");
    if (statsIncTotalLabel) statsIncTotalLabel.textContent = t.stats_inc_total;
    const statsIncTotalSublabel = document.getElementById("stats-income-sublabel");
    if (statsIncTotalSublabel) statsIncTotalSublabel.textContent = t.stats_inc;
    
    const statsExpTotalLabel = document.querySelector("#view-stats .grid > div:nth-child(2) span");
    if (statsExpTotalLabel) statsExpTotalLabel.textContent = t.stats_exp_total;
    const statsExpTotalSublabel = document.getElementById("stats-expense-sublabel");
    if (statsExpTotalSublabel) statsExpTotalSublabel.textContent = t.stats_exp;

    const statsHeaders = document.querySelectorAll("#view-stats h3");
    if (statsHeaders.length >= 4) {
        statsHeaders[0].textContent = t.stats_flow;
        statsHeaders[1].textContent = t.stats_inc_cats;
        statsHeaders[2].textContent = t.stats_exp_cats;
        statsHeaders[3].textContent = t.stats_transfers;
    }

    const statsTimeframe = document.getElementById("stats-timeframe");
    if (statsTimeframe && statsTimeframe.options.length >= 4) {
        statsTimeframe.options[0].textContent = lang === "en" ? "Weekly" : "За неделю";
        statsTimeframe.options[1].textContent = lang === "en" ? "Monthly" : "За месяц";
        statsTimeframe.options[2].textContent = lang === "en" ? "Yearly" : "За год";
        statsTimeframe.options[3].textContent = lang === "en" ? "Custom Period" : "Отчетный период";
    }

    const statsDateLabels = document.querySelectorAll("#stats-date-range-container label");
    if (statsDateLabels.length >= 2) {
        statsDateLabels[0].textContent = lang === "en" ? "From Date" : "С даты";
        statsDateLabels[1].textContent = lang === "en" ? "To Date" : "По дату";
    }

    const lblPortfolioHeader = document.getElementById("lbl-portfolio-header");
    if (lblPortfolioHeader) lblPortfolioHeader.textContent = t.portfolio_header;
    const lblMyAssets = document.getElementById("lbl-my-assets");
    if (lblMyAssets) lblMyAssets.textContent = t.my_assets;
    
    const depositBtnText = document.querySelector("#btn-asset-deposit");
    if (depositBtnText) {
        depositBtnText.innerHTML = `<span class="material-symbols-outlined text-[16px]">add_circle</span> ` + t.btn_deposit;
    }
    const sellBtnText = document.querySelector("#btn-asset-sell-trigger");
    if (sellBtnText) {
        sellBtnText.innerHTML = `<span class="material-symbols-outlined text-[16px]">sell</span> ` + t.btn_sell;
    }

    const lblHistoryHeader = document.getElementById("lbl-history-header");
    if (lblHistoryHeader) lblHistoryHeader.textContent = t.history_header;
    const historySearchEl = document.getElementById("history-search");
    if (historySearchEl) historySearchEl.placeholder = t.history_search_placeholder;

    const settingsMainHeader = document.querySelector("#view-settings h3");
    if (settingsMainHeader) settingsMainHeader.textContent = t.settings_header;
    const lblSettingGeminiKey = document.getElementById("lbl-setting-gemini-key");
    if (lblSettingGeminiKey) lblSettingGeminiKey.textContent = t.setting_gemini_key;
    const lblSettingGeminiKeyDesc = document.getElementById("lbl-setting-gemini-key-desc");
    if (lblSettingGeminiKeyDesc) lblSettingGeminiKeyDesc.textContent = t.setting_gemini_key_desc;
    const lblSettingConfirmAi = document.getElementById("lbl-setting-confirm-ai");
    if (lblSettingConfirmAi) lblSettingConfirmAi.textContent = t.setting_confirm_ai;
    const lblSettingConfirmAiDesc = document.getElementById("lbl-setting-confirm-ai-desc");
    if (lblSettingConfirmAiDesc) lblSettingConfirmAiDesc.textContent = t.setting_confirm_ai_desc;
    const lblSettingCurrencyHeader = document.getElementById("lbl-setting-currency-header");
    if (lblSettingCurrencyHeader) lblSettingCurrencyHeader.textContent = t.setting_currency_header;
    const lblSettingExpensesCurrency = document.getElementById("lbl-setting-expenses-currency");
    if (lblSettingExpensesCurrency) lblSettingExpensesCurrency.textContent = t.setting_expenses_currency;
    const lblSettingPortfolioCurrency = document.getElementById("lbl-setting-portfolio-currency");
    if (lblSettingPortfolioCurrency) lblSettingPortfolioCurrency.textContent = t.setting_portfolio_currency;
    const lblSettingLanguage = document.getElementById("lbl-setting-language");
    if (lblSettingLanguage) lblSettingLanguage.textContent = t.setting_language;
    const btnSaveSettings = document.getElementById("btn-save-settings");
    if (btnSaveSettings) btnSaveSettings.textContent = t.btn_save_settings;

    const lblSettingCloudHeader = document.getElementById("lbl-setting-cloud-header");
    if (lblSettingCloudHeader) lblSettingCloudHeader.textContent = t.setting_cloud_header;
    const lblSettingAccessKeyTitle = document.getElementById("lbl-setting-access-key-title");
    if (lblSettingAccessKeyTitle) lblSettingAccessKeyTitle.textContent = t.setting_access_key_title;
    const lblSettingFirebaseUrlTitle = document.getElementById("lbl-setting-firebase-url-title");
    if (lblSettingFirebaseUrlTitle) lblSettingFirebaseUrlTitle.textContent = t.setting_firebase_url_title;
    const lblSettingFirebaseUrlDesc = document.getElementById("lbl-setting-firebase-url-desc");
    if (lblSettingFirebaseUrlDesc) lblSettingFirebaseUrlDesc.textContent = t.setting_firebase_url_desc;

    const lblSettingChartsHeader = document.getElementById("lbl-setting-charts-header");
    if (lblSettingChartsHeader) lblSettingChartsHeader.textContent = t.setting_charts_header;
    const lblSettingAutoloadChartTitle = document.getElementById("lbl-setting-autoload-chart-title");
    if (lblSettingAutoloadChartTitle) lblSettingAutoloadChartTitle.textContent = t.setting_autoload_chart_title;
    const lblSettingAutoloadChartDesc = document.getElementById("lbl-setting-autoload-chart-desc");
    if (lblSettingAutoloadChartDesc) lblSettingAutoloadChartDesc.textContent = t.setting_autoload_chart_desc;

    const lblSettingResetHeader = document.getElementById("lbl-setting-reset-header");
    if (lblSettingResetHeader) lblSettingResetHeader.textContent = t.reset_header;
    const lblSettingResetDesc = document.getElementById("lbl-setting-reset-desc");
    if (lblSettingResetDesc) lblSettingResetDesc.textContent = t.reset_desc;

    const lblSettingLogoutHeader = document.getElementById("lbl-setting-logout-header");
    if (lblSettingLogoutHeader) lblSettingLogoutHeader.textContent = t.setting_logout_header;
    const lblSettingLogoutDesc = document.getElementById("lbl-setting-logout-desc");
    if (lblSettingLogoutDesc) lblSettingLogoutDesc.textContent = t.setting_logout_desc;
    
    const btnLogout = document.getElementById("btn-logout");
    if (btnLogout) btnLogout.textContent = t.btn_logout;

    const btnResetDb = document.getElementById("btn-reset-db");
    if (btnResetDb) btnResetDb.textContent = t.btn_reset;

    const navStatsText = document.querySelector("#tab-stats span:not(.material-symbols-outlined)");
    if (navStatsText) navStatsText.textContent = t.nav_stats;
    const navPortfolioText = document.querySelector("#tab-invest span:not(.material-symbols-outlined)");
    if (navPortfolioText) navPortfolioText.textContent = t.nav_portfolio;
    const navHomeText = document.querySelector("#tab-home span:not(.material-symbols-outlined)");
    if (navHomeText) navHomeText.textContent = t.nav_home;
    const navHistoryText = document.querySelector("#tab-history span:not(.material-symbols-outlined)");
    if (navHistoryText) navHistoryText.textContent = t.nav_history;
    const navSettingsText = document.querySelector("#tab-settings span:not(.material-symbols-outlined)");
    if (navSettingsText) navSettingsText.textContent = t.nav_settings;

    const modalTxTitle = document.querySelector("#ai-confirm-modal h3");
    if (modalTxTitle) modalTxTitle.textContent = t.modal_tx_title;
    const modalTxDescParagraph = document.querySelector("#ai-confirm-modal p");
    if (modalTxDescParagraph) modalTxDescParagraph.textContent = t.modal_tx_desc;
    
    const txLabels = document.querySelectorAll("#ai-confirm-modal label");
    if (txLabels.length >= 4) {
        let currencySymbol = "₽";
        if (expensesCurrency === "USD") currencySymbol = "$";
        else if (expensesCurrency === "EUR") currencySymbol = "€";
        txLabels[0].textContent = `${t.modal_tx_amount} (${currencySymbol})`;
        txLabels[1].textContent = t.modal_tx_type;
        txLabels[2].textContent = t.modal_tx_category;
        txLabels[3].textContent = t.modal_tx_desc_lbl;
    }
    const modalTxType = document.getElementById("modal-tx-type");
    if (modalTxType && modalTxType.options.length >= 2) {
        modalTxType.options[0].textContent = t.modal_tx_type_expense;
        modalTxType.options[1].textContent = t.modal_tx_type_income;
    }
    const btnAddCat = document.getElementById("btn-add-category");
    if (btnAddCat) btnAddCat.innerHTML = `<span class="material-symbols-outlined text-[12px] font-bold">add</span> ` + t.modal_tx_add_cat;
    const btnDelCat = document.getElementById("btn-delete-category");
    if (btnDelCat) btnDelCat.innerHTML = `<span class="material-symbols-outlined text-[12px] font-bold">delete</span> ` + t.modal_tx_del_cat;
    
    const btnModalCancel = document.getElementById("btn-modal-cancel");
    if (btnModalCancel) btnModalCancel.textContent = t.modal_cancel;
    const btnModalConfirm = document.getElementById("btn-modal-confirm");
    if (btnModalConfirm) btnModalConfirm.textContent = t.modal_confirm;

    const buyModalTitle = document.getElementById("asset-modal-title");
    if (buyModalTitle) buyModalTitle.textContent = t.modal_buy_title;
    const buyModalDesc = document.querySelector("#asset-modal p");
    if (buyModalDesc) buyModalDesc.textContent = t.modal_buy_desc;
    
    const buyLabels = document.querySelectorAll("#asset-modal label");
    if (buyLabels.length >= 4) {
        let portfolioCurrencySymbol = "₽";
        if (portfolioCurrency === "USD") portfolioCurrencySymbol = "$";
        else if (portfolioCurrency === "EUR") portfolioCurrencySymbol = "€";
        buyLabels[0].textContent = t.modal_buy_type;
        buyLabels[1].textContent = t.modal_buy_symbol;
        buyLabels[2].textContent = t.modal_buy_quantity;
        buyLabels[3].textContent = `${t.modal_buy_price} (${portfolioCurrencySymbol})`;
    }
    const assetType = document.getElementById("asset-type");
    if (assetType && assetType.options.length >= 6) {
        assetType.options[0].textContent = lang === "en" ? "Stocks" : "Акции";
        assetType.options[1].textContent = lang === "en" ? "Bonds" : "Облигации";
        assetType.options[2].textContent = lang === "en" ? "Cryptocurrency" : "Криптовалюта";
        assetType.options[3].textContent = lang === "en" ? "Real Estate" : "Недвижимость";
        assetType.options[4].textContent = lang === "en" ? "Bank Deposit" : "Банковский вклад";
        assetType.options[5].textContent = lang === "en" ? "Other" : "Другое";
    }
    const btnAssetDelete = document.getElementById("btn-asset-delete");
    if (btnAssetDelete) btnAssetDelete.textContent = t.modal_tx_del_cat;
    const btnAssetCancel = document.getElementById("btn-asset-cancel");
    if (btnAssetCancel) btnAssetCancel.textContent = t.modal_cancel;
    const btnAssetConfirm = document.getElementById("btn-asset-confirm");
    if (btnAssetConfirm) btnAssetConfirm.textContent = t.modal_confirm_buy;

    const sellModalTitle = document.querySelector("#sell-asset-modal h3");
    if (sellModalTitle) sellModalTitle.textContent = t.modal_sell_title;
    const sellModalDesc = document.querySelector("#sell-asset-modal p");
    if (sellModalDesc) sellModalDesc.textContent = t.modal_sell_desc;
    
    const sellLabels = document.querySelectorAll("#sell-asset-modal label");
    if (sellLabels.length >= 3) {
        let portfolioCurrencySymbol = "₽";
        if (portfolioCurrency === "USD") portfolioCurrencySymbol = "$";
        else if (portfolioCurrency === "EUR") portfolioCurrencySymbol = "€";
        sellLabels[0].textContent = t.modal_sell_symbol;
        sellLabels[1].textContent = t.modal_sell_quantity;
        sellLabels[2].textContent = `${t.modal_sell_price} (${portfolioCurrencySymbol})`;
    }
    const btnSellAssetCancel = document.getElementById("btn-sell-asset-cancel");
    if (btnSellAssetCancel) btnSellAssetCancel.textContent = t.modal_cancel;
    const btnSellAssetConfirm = document.getElementById("btn-sell-asset-confirm");
    if (btnSellAssetConfirm) btnSellAssetConfirm.textContent = t.modal_confirm_sell;

    translateFilterChipsText();
}

// ----------------------------------------------------
// FORMATTING HELPERS
// ----------------------------------------------------
function formatCurrency(val, targetCurrency = expensesCurrency) {
    if (val === null || val === undefined || isNaN(val)) val = 0;
    const usdRate = prices["USD_RUB"] || 90.0;
    const eurRate = prices["EUR_RUB"] || 97.2;
    
    let convertedVal = val;
    let symbol = "₽";
    if (targetCurrency === "USD") {
        convertedVal = val / usdRate;
        symbol = "$";
    } else if (targetCurrency === "EUR") {
        convertedVal = val / eurRate;
        symbol = "€";
    }
    
    const localeStr = currentLang === "en" ? "en-US" : "ru-RU";
    const formattedNum = new Intl.NumberFormat(localeStr, { 
        minimumFractionDigits: 2,
        maximumFractionDigits: 2 
    }).format(convertedVal);
    
    if (currentLang === "en") {
        return `${symbol}${formattedNum}`;
    } else {
        return `${formattedNum} ${symbol}`;
    }
}

function convertFromRub(val, targetCurrency) {
    if (val === null || val === undefined || isNaN(val)) return 0;
    const usdRate = prices["USD_RUB"] || 90.0;
    const eurRate = prices["EUR_RUB"] || 97.2;
    if (targetCurrency === "USD") return val / usdRate;
    if (targetCurrency === "EUR") return val / eurRate;
    return val;
}

function convertToRub(val, sourceCurrency) {
    if (val === null || val === undefined || isNaN(val)) return 0;
    const usdRate = prices["USD_RUB"] || 90.0;
    const eurRate = prices["EUR_RUB"] || 97.2;
    if (sourceCurrency === "USD") return val * usdRate;
    if (sourceCurrency === "EUR") return val * eurRate;
    return val;
}

function formatDateString(dateStr) {
    try {
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return dateStr;
        const day = String(d.getDate()).padStart(2, '0');
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const year = d.getFullYear();
        return `${day}.${month}.${year}`;
    } catch(e) {
        return dateStr;
    }
}

function getTradingViewSymbol(symbol) {
    let s = symbol.trim().toUpperCase();
    s = s.replace("-USD", "");
    const cryptoList = ["BTC", "ETH", "SOL", "BNB", "USDT", "ADA", "XRP", "DOGE", "DOT", "LTC", "TON", "TONCOIN", "NOT", "GRAM"];
    if (cryptoList.includes(s)) {
        if (s === "TON" || s === "TONCOIN" || s === "GRAM") {
            return "OKX:TONUSDT";
        }
        return `BINANCE:${s}USDT`;
    }
    return s;
}

async function openAssetDetailsModal(asset, livePrice, totalVal) {
    const modal = document.getElementById("asset-details-modal");
    const symbolEl = document.getElementById("details-asset-symbol");
    const currentPriceEl = document.getElementById("details-current-price");
    const entryPriceEl = document.getElementById("details-entry-price");
    const quantityEl = document.getElementById("details-quantity");
    const totalValEl = document.getElementById("details-total-value");
    const txHistoryEl = document.getElementById("details-tx-history");
    const chartArea = document.getElementById("details-chart-area");
    
    if (!modal) return;
    
    symbolEl.textContent = asset.symbol;
    currentPriceEl.textContent = formatCurrency(livePrice, portfolioCurrency);
    entryPriceEl.textContent = formatCurrency(asset.entry_price || asset.current_price || 0, portfolioCurrency);
    quantityEl.textContent = `${asset.quantity} ${currentLang === "en" ? "pcs" : "шт."}`;
    totalValEl.textContent = formatCurrency(totalVal, portfolioCurrency);
    
    const autoload = localStorage.getItem("autoloadChart") !== "false";
    
    function loadChartWidget() {
        const tvSymbol = getTradingViewSymbol(asset.symbol);
        chartArea.innerHTML = `
            <iframe src="https://s.tradingview.com/widgetembed/?frameElementId=tradingview_chart&symbol=${tvSymbol}&interval=D&hidesidetoolbar=1&symboledit=0&saveimage=1&toolbarbg=f1f3f6&studies=%5B%5D&theme=light&style=1&timezone=exchange" width="100%" height="100%" frameborder="0" allowtransparency="true" scrolling="no" allowfullscreen></iframe>
        `;
    }
    
    if (autoload) {
        chartArea.innerHTML = `<span id="chart-placeholder-text">${currentLang === "en" ? "Loading chart..." : "Загрузка графика..."}</span>`;
        loadChartWidget();
    } else {
        chartArea.innerHTML = `
            <button id="btn-load-chart-manually" class="bg-primary/10 text-primary hover:bg-primary/15 px-4 py-2 rounded-xl font-bold text-xs transition-colors active:scale-95">
                ${currentLang === "en" ? "Load Chart" : "Загрузить график"}
            </button>
        `;
        const loadBtn = document.getElementById("btn-load-chart-manually");
        if (loadBtn) {
            loadBtn.addEventListener("click", () => {
                loadChartWidget();
            });
        }
    }
    
    txHistoryEl.innerHTML = `<div class="text-[10px] text-outline text-center py-2">${currentLang === "en" ? "Loading history..." : "Загрузка истории..."}</div>`;
    
    try {
        let allTxs = [];
        if (useLocalFallback) {
            allTxs = JSON.parse(localStorage.getItem("transactions")) || [];
        } else {
            const res = await fetch(`${API_BASE}/api/transactions`);
            if (res.ok) {
                allTxs = await res.json();
            }
        }
        
        const symbolUpper = asset.symbol.toUpperCase();
        const assetTxs = allTxs.filter(t => {
            const desc = (t.description || "").toUpperCase();
            return desc.includes(symbolUpper) && (
                desc.includes("ПОКУПКА") || 
                desc.includes("ПРОДАЖ") || 
                desc.includes("ВОЗВРАТ") || 
                desc.includes("ДОХОД")
            );
        });
        
        if (assetTxs.length === 0) {
            txHistoryEl.innerHTML = `<div class="text-[10px] text-outline text-center py-2">${currentLang === "en" ? "No transaction history." : "История операций отсутствует."}</div>`;
        } else {
            txHistoryEl.innerHTML = "";
            assetTxs.forEach(tx => {
                const isBuy = (tx.description || "").toUpperCase().includes("ПОКУПКА");
                const icon = isBuy ? "add_circle" : "remove_circle";
                const iconColor = isBuy ? "text-emerald-500" : "text-red-500";
                
                let convertedAmount = tx.amount;
                let displayCurrency = expensesCurrency;
                
                if (portfolioCurrency !== expensesCurrency) {
                    if (portfolioCurrency === "USD" && expensesCurrency === "RUB") {
                        const usdRub = prices["USD_RUB"] || 90.0;
                        convertedAmount = tx.amount / usdRub;
                        displayCurrency = "USD";
                    } else if (portfolioCurrency === "EUR" && expensesCurrency === "RUB") {
                        const eurRub = prices["EUR_RUB"] || 97.0;
                        convertedAmount = tx.amount / eurRub;
                        displayCurrency = "EUR";
                    } else if (portfolioCurrency === "RUB" && expensesCurrency === "USD") {
                        const usdRub = prices["USD_RUB"] || 90.0;
                        convertedAmount = tx.amount * usdRub;
                        displayCurrency = "RUB";
                    } else if (portfolioCurrency === "RUB" && expensesCurrency === "EUR") {
                        const eurRub = prices["EUR_RUB"] || 97.0;
                        convertedAmount = tx.amount * eurRub;
                        displayCurrency = "RUB";
                    }
                } else {
                    displayCurrency = portfolioCurrency;
                }
                
                const item = document.createElement("div");
                item.className = "flex items-center justify-between py-1.5 border-b border-outline-variant/10 text-[10px] text-on-surface";
                item.innerHTML = `
                    <div class="flex items-center gap-1.5">
                        <span class="material-symbols-outlined text-[14px] ${iconColor}">${icon}</span>
                        <div>
                            <div class="font-bold">${tx.description}</div>
                            <div class="text-[9px] text-outline mt-0.5">${formatDateString(tx.date)}</div>
                        </div>
                    </div>
                    <div class="font-bold ${isBuy ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}">
                        ${isBuy ? "-" : "+"}${formatCurrency(convertedAmount, displayCurrency)}
                    </div>
                `;
                txHistoryEl.appendChild(item);
            });
        }
    } catch (e) {
        console.error("Failed to load asset history:", e);
        txHistoryEl.innerHTML = `<div class="text-[10px] text-error text-center py-2">${currentLang === "en" ? "Failed to load history." : "Ошибка загрузки истории."}</div>`;
    }
    
    modal.classList.remove("hidden");
}

function getCategoryIcon(cat) {
    const map = {
        "Продукты": "shopping_cart",
        "Транспорт": "directions_car",
        "Кафе и рестораны": "restaurant",
        "Жилье и ЖКХ": "home",
        "Развлечения": "sports_esports",
        "Здоровье": "medical_services",
        "Зарплата": "payments",
        "Инвестиции": "account_balance_wallet",
        "В портфель": "swap_horiz",
        "На карту": "swap_horiz"
    };
    return map[cat] || "category";
}

function getAssetTypeNameRu(type) {
    const mapEn = {
        "shares": "Stocks",
        "bonds": "Bonds",
        "crypto": "Crypto",
        "realty": "Real Estate",
        "deposit": "Deposit",
        "other": "Other"
    };
    const mapRu = {
        "shares": "Акции",
        "bonds": "Облигации",
        "crypto": "Крипта",
        "realty": "Недвижимость",
        "deposit": "Вклад",
        "other": "Другое"
    };
    const map = currentLang === "en" ? mapEn : mapRu;
    return map[type] || (currentLang === "en" ? "Asset" : "Актив");
}

function getAssetColorTheme(symbol, type) {
    const defaultColor = { bg: "bg-surface-variant text-on-surface-variant", icon: "help", text: "text-outline" };
    
    // Extract base symbol (e.g. BTC-USD -> BTC)
    const baseSymbol = symbol.split('-')[0].toUpperCase();

    // Icon mapping based on asset type
    const mapEn = {
        "shares": "Stocks",
        "bonds": "Bonds",
        "crypto": "Crypto",
        "realty": "Real Estate",
        "deposit": "Deposit",
        "other": "Other"
    };
    const mapRu = {
        "shares": "Акции",
        "bonds": "Облигации",
        "crypto": "Крипта",
        "realty": "Недвижимость",
        "deposit": "Вклад",
        "other": "Другое"
    };
    const map = currentLang === "en" ? mapEn : mapRu;
    return map[type] || (currentLang === "en" ? "Asset" : "Актив");
}

function getAssetColorTheme(symbol, type) {
    const defaultColor = { bg: "bg-surface-variant text-on-surface-variant", icon: "help", text: "text-outline" };
    
    // Extract base symbol (e.g. BTC-USD -> BTC)
    const baseSymbol = symbol.split('-')[0].toUpperCase();

    // Icon mapping based on asset type
    const typeIcons = {
        "shares": "trending_up",
        "bonds": "corporate_fare",
        "crypto": "token",
        "realty": "home_work",
        "deposit": "account_balance",
        "other": "help"
    };

    const map = {
        "BTC": { bg: "bg-[#F7931A]/10 text-[#F7931A]", icon: "currency_bitcoin" },
        "ETH": { bg: "bg-[#627EEA]/10 text-[#627EEA]", icon: "diamond" },
        "SOL": { bg: "bg-[#14F195]/10 text-[#14F195]", icon: "layers" },
        "BNB": { bg: "bg-[#F3BA2F]/10 text-[#F3BA2F]", icon: "hexagon" },
        "USDT": { bg: "bg-[#26A17B]/10 text-[#26A17B]", icon: "monetization_on" },
        "AAPL": { bg: "bg-[#000000]/10 text-on-surface", icon: "phone_iphone" },
        "TSLA": { bg: "bg-[#CC0000]/10 text-[#CC0000]", icon: "electric_car" }
    };
    
    const mapped = map[baseSymbol];
    if (mapped) {
        return {
            bg: mapped.bg,
            icon: mapped.icon,
            text: mapped.bg.includes("text-") ? mapped.bg.split(" ")[1] : "text-on-surface"
        };
    }
    // Fallback based on asset type
    const matchedIcon = typeIcons[type] || "help";
    return {
        bg: "bg-primary/10 text-primary",
        icon: matchedIcon,
        text: "text-primary"
    };
}

function getAssetDailyChange(symbol) {
    const day = new Date().getDate();
    let hash = 0;
    for (let i = 0; i < symbol.length; i++) {
        hash = symbol.charCodeAt(i) + ((hash << 5) - hash);
    }
    const val = (Math.abs(hash + day) % 60) / 10 - 3.0; // range from -3.0% to +3.0%
    return val;
}

// Async loaders for server sync
async function loadTransactions() {
    try {
        const res = await fetch(`${API_BASE}/api/transactions`);
        if (!res.ok) throw new Error();
        const txs = await res.json();
        localStorage.setItem("transactions", JSON.stringify(txs)); // Backup!
        renderTransactions(txs.slice(0, 5));
    } catch(e) {
        console.error(e);
    }
}

async function loadStats() {
    try {
        const res = await fetch(`${API_BASE}/api/transactions`);
        if (!res.ok) throw new Error();
        const txs = await res.json();
        localStorage.setItem("transactions", JSON.stringify(txs)); // Backup!
        renderStats(txs);
    } catch(e) {
        console.error(e);
    }
}

async function loadAssets() {
    try {
        const res = await fetch(`${API_BASE}/api/assets`);
        if (!res.ok) throw new Error();
        const data = await res.json();
        loadedAssets = data.assets || [];
        localStorage.setItem("assets", JSON.stringify(loadedAssets)); // Backup!
        renderAssets(data.assets);
    } catch(e) {
        console.error(e);
    }
}

async function loadHistory() {
    try {
        const res = await fetch(`${API_BASE}/api/transactions`);
        if (!res.ok) throw new Error();
        const txs = await res.json();
        localStorage.setItem("transactions", JSON.stringify(txs)); // Backup!
        renderHistory(txs);
    } catch(e) {
        console.error(e);
    }
}

async function loadCategories() {
    const defaultExpenseCategories = ["Продукты", "Транспорт", "Кафе и рестораны", "Жилье и ЖКХ", "Развлечения", "Здоровье", "Другое"];
    const defaultIncomeCategories = ["Зарплата", "Трансфер", "Инвестиции", "Другое"];

    if (useLocalFallback) {
        let stored = localStorage.getItem("categories");
        if (!stored) {
            const initialCats = [];
            defaultExpenseCategories.forEach(name => initialCats.push({ name, type: "expense" }));
            defaultIncomeCategories.forEach(name => initialCats.push({ name, type: "income" }));
            localStorage.setItem("categories", JSON.stringify(initialCats));
            categories = initialCats;
        } else {
            categories = JSON.parse(stored);
        }
    } else {
        try {
            const res = await fetch(`${API_BASE}/api/categories`);
            if (res.ok) {
                categories = await res.json();
                localStorage.setItem("categories", JSON.stringify(categories)); // Backup!
            } else {
                throw new Error("Failed to fetch categories");
            }
        } catch (e) {
            console.error("Fetch categories failed, using default list:", e);
            const initialCats = [];
            defaultExpenseCategories.forEach(name => initialCats.push({ name, type: "expense" }));
            defaultIncomeCategories.forEach(name => initialCats.push({ name, type: "income" }));
            categories = initialCats;
        }
    }
}

function populateCategoryDropdown(type) {
    modalTxCategory.innerHTML = "";
    const filtered = categories.filter(c => c.type === type);
    filtered.forEach(c => {
        const opt = document.createElement("option");
        opt.value = c.name;
        opt.textContent = translateCategory(c.name);
        modalTxCategory.appendChild(opt);
    });
}

function setupVoiceAndCameraInput() {
    const btnCamera = document.getElementById("btn-ai-camera");
    const btnMic = document.getElementById("btn-ai-mic");
    const fileInput = document.getElementById("ai-file-input");

    btnCamera.addEventListener("click", () => {
        if (!geminiApiKey) {
            alert(currentLang === "en" ? "Please enter your Gemini API Key in the settings!" : "Пожалуйста, введите ваш Gemini API-ключ в настройках!");
            switchView("settings");
            return;
        }
        fileInput.click();
    });

    fileInput.addEventListener("change", async () => {
        const file = fileInput.files[0];
        if (!file) return;

        fileInput.value = "";

        const reader = new FileReader();
        reader.onload = async (e) => {
            const dataUrl = e.target.result;
            const commaIdx = dataUrl.indexOf(",");
            const base64Data = dataUrl.substring(commaIdx + 1);
            const mimeType = file.type || "image/jpeg";

            btnCamera.disabled = true;
            btnCamera.innerHTML = `<span class="material-symbols-outlined animate-spin text-[20px]">refresh</span>`;
            aiTextInput.value = currentLang === "en" ? "Parsing receipt from photo..." : "Распознаем чек по фотографии...";
            aiTextInput.disabled = true;

            const systemPrompt = `
Ты — финансовый аналитик. Твоя задача — разобрать изображение чека о доходах или расходах и извлечь структурированные данные.
Список доступных категорий: Продукты, Транспорт, Кафе и рестораны, Жилье и ЖКХ, Развлечения, Здоровье, Зарплата, Инвестиции, Другое.

Текущая валюта пользователя по умолчанию: ${expensesCurrency} (используй её, если валюта не видна на чеке).

Верни строго валидный JSON в следующем формате:
{
  "amount": float (положительное число),
  "currency": "RUB" | "USD" | "EUR" (валюта, указанная на чеке, или валюта по умолчанию "${expensesCurrency}", если валюту невозможно определить по изображению чека),
  "type": "expense" | "income",
  "category": "одна категория из списка выше, наиболее близкая по смыслу чека",
  "description": "короткое описание сути платежа на русском языке (если в чеке несколько позиций с ценами, обязательно подробно перечисли их с ценами через запятую, например: 'пельмени: 200 руб, доширак: 100 руб', а в amount запиши их общую сумму)"
}
Отвечай ТОЛЬКО чистым JSON без каких-либо дополнительных слов, комментариев или разметки markdown.`;

            try {
                const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${geminiApiKey}`;
                const res = await fetch(url, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        contents: [{
                            parts: [
                                { text: systemPrompt },
                                { inlineData: { mimeType: mimeType, data: base64Data } }
                            ]
                        }]
                    })
                });

                if (!res.ok) {
                    throw new Error(`Gemini API returned status ${res.status}`);
                }

                const responseData = await res.json();
                const rawResponse = responseData.candidates[0].content.parts[0].text.trim();
                const cleanedResponse = rawResponse.replace(/```json/gi, "").replace(/```/g, "").trim();
                const parsed = JSON.parse(cleanedResponse);

                const parsedAmount = parsed.amount || 0;
                const parsedCurrency = (parsed.currency || expensesCurrency).toUpperCase();
                const parsedType = parsed.type || "expense";
                let parsedCategory = parsed.category || "Другое";
                
                populateCategoryDropdown(parsedType);
                
                const selectOptions = Array.from(modalTxCategory.options).map(o => o.value);
                if (selectOptions.includes(parsedCategory)) {
                    modalTxCategory.value = parsedCategory;
                } else {
                    modalTxCategory.value = "Другое";
                    parsedCategory = "Другое";
                }
                
                const parsedDesc = parsed.description || parsedCategory;

                const amountInRub = convertToRub(parsedAmount, parsedCurrency);
                const amountInExpensesCurrency = parseFloat(convertFromRub(amountInRub, expensesCurrency).toFixed(2));

                if (!confirmAi) {
                    const success = await saveTransactionDirectly(amountInExpensesCurrency, parsedType, parsedCategory, parsedDesc);
                    if (success) {
                        const successMsg = currentLang === "en"
                            ? `Receipt parsed and saved: ${translateCategory(parsedCategory)} - ${formatCurrency(amountInRub, expensesCurrency)} (${parsedDesc})`
                            : `Чек распознан и сохранен: ${translateCategory(parsedCategory)} - ${formatCurrency(amountInRub, expensesCurrency)} (${parsedDesc})`;
                        alert(successMsg);
                    }
                } else {
                    modalTxAmount.value = amountInExpensesCurrency || "";
                    modalTxType.value = parsedType;
                    populateCategoryDropdown(parsedType);
                    modalTxCategory.value = parsedCategory;
                    modalTxDesc.value = parsed.description || "";
                    aiConfirmModal.classList.remove("hidden");
                }
            } catch (e) {
                console.error("Gemini Multimodal parsing failed:", e);
                alert(currentLang === "en" ? "Failed to parse receipt. Please verify your API key or enter the details manually." : "Не удалось распознать чек. Проверьте правильность API ключа или введите данные вручную.");
            } finally {
                btnCamera.disabled = false;
                btnCamera.innerHTML = `<span class="material-symbols-outlined text-[20px]">photo_camera</span>`;
                aiTextInput.value = "";
                aiTextInput.disabled = false;
            }
        };
        reader.readAsDataURL(file);
    });

    btnMic.addEventListener("click", () => {
        if (!geminiApiKey) {
            alert(currentLang === "en" ? "Please enter your Gemini API Key in the settings!" : "Пожалуйста, введите ваш Gemini API-ключ в настройках!");
            switchView("settings");
            return;
        }

        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (SpeechRecognition) {
            if (isRecording) return;
            isRecording = true;

            const recognition = new SpeechRecognition();
            recognition.lang = "ru-RU";
            recognition.interimResults = false;

            btnMic.classList.add("text-error", "animate-pulse");
            aiTextInput.placeholder = currentLang === "en" ? "Speaking..." : "Говорите...";

            recognition.onresult = (event) => {
                const speechToText = event.results[0][0].transcript;
                aiTextInput.value = speechToText;
                parseTextWithAI();
            };

            recognition.onerror = (event) => {
                console.error("Speech recognition error:", event.error);
                isRecording = false;
                btnMic.classList.remove("text-error", "animate-pulse");
                aiTextInput.placeholder = currentLang === "en" ? "Where did the money go? Write..." : "Куда ушли деньги? Напишите...";
            };

            recognition.onend = () => {
                isRecording = false;
                btnMic.classList.remove("text-error", "animate-pulse");
                aiTextInput.placeholder = currentLang === "en" ? "Where did the money go? Write..." : "Куда ушли деньги? Напишите...";
            };

            recognition.start();
        } else {
            if (isRecording) return;
            isRecording = true;

            btnMic.classList.add("text-error", "animate-pulse");
            aiTextInput.value = currentLang === "en" ? "Listening to you..." : "Слушаю вас...";
            aiTextInput.disabled = true;

            setTimeout(() => {
                isRecording = false;
                btnMic.classList.remove("text-error", "animate-pulse");
                aiTextInput.disabled = false;
                aiTextInput.value = currentLang === "en" ? "Bought groceries for 2300 rubles" : "Купил продукты на 2300 рублей";
                parseTextWithAI();
            }, 2500);
        }
    });
}

function setupLoginScreen() {
    const tabSignin = document.getElementById("tab-login-signin");
    const tabSignup = document.getElementById("tab-login-signup");
    const panelSignin = document.getElementById("login-panel-signin");
    const panelSignup = document.getElementById("login-panel-signup");
    
    const keyInput = document.getElementById("login-key-input");
    const btnLoginSubmit = document.getElementById("btn-login-submit");
    
    const signupInitial = document.getElementById("signup-initial");
    const btnGenerateKey = document.getElementById("btn-generate-key");
    const signupKeyDisplay = document.getElementById("signup-key-display");
    const newKeyValue = document.getElementById("new-key-value");
    const btnCopyKey = document.getElementById("btn-copy-key");
    const btnSignupConfirm = document.getElementById("btn-signup-confirm");
    
    const greetingTitle = document.getElementById("login-greeting-title");
    const greetingSubtitle = document.getElementById("login-greeting-subtitle");

    // Customize greeting if Telegram WebApp user info is available
    if (tg && tg.initDataUnsafe && tg.initDataUnsafe.user) {
        const user = tg.initDataUnsafe.user;
        const name = user.first_name || "Пользователь";
        greetingTitle.textContent = `Привет, ${name}!`;
        greetingSubtitle.textContent = "Рады видеть тебя снова. Войди по ключу доступа.";
    }

    // Toggle panels
    if (tabSignin && tabSignup && panelSignin && panelSignup) {
        tabSignin.addEventListener("click", () => {
            tabSignin.classList.add("bg-surface-container-lowest", "text-primary", "shadow-sm");
            tabSignin.classList.remove("text-outline");
            tabSignup.classList.remove("bg-surface-container-lowest", "text-primary", "shadow-sm");
            tabSignup.classList.add("text-outline");
            panelSignin.classList.remove("hidden");
            panelSignup.classList.add("hidden");
        });
        tabSignup.addEventListener("click", () => {
            tabSignup.classList.add("bg-surface-container-lowest", "text-primary", "shadow-sm");
            tabSignup.classList.remove("text-outline");
            tabSignin.classList.remove("bg-surface-container-lowest", "text-primary", "shadow-sm");
            tabSignin.classList.add("text-outline");
            panelSignup.classList.remove("hidden");
            panelSignin.classList.add("hidden");
        });
    }

    function triggerHaptic() {
        if (tg && tg.HapticFeedback) {
            tg.HapticFeedback.impactOccurred("medium");
        }
    }

    function triggerErrorHaptic() {
        if (tg && tg.HapticFeedback) {
            tg.HapticFeedback.notificationOccurred("error");
        }
    }

    function triggerSuccessHaptic() {
        if (tg && tg.HapticFeedback) {
            tg.HapticFeedback.notificationOccurred("success");
        }
    }

    // Generate random 6-character key
    if (btnGenerateKey) {
        btnGenerateKey.addEventListener("click", () => {
            triggerHaptic();
            const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
            let result = "";
            for (let i = 0; i < 6; i++) {
                result += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            newKeyValue.textContent = result;
            signupInitial.classList.add("hidden");
            signupKeyDisplay.classList.remove("hidden");
        });
    }

    // Copy generated key to clipboard
    if (btnCopyKey) {
        btnCopyKey.addEventListener("click", () => {
            triggerHaptic();
            const keyText = newKeyValue.textContent;
            navigator.clipboard.writeText(keyText).then(() => {
                const copySpan = btnCopyKey.querySelector("span:last-child");
                const originalText = copySpan ? copySpan.textContent : "Скопировать";
                if (copySpan) copySpan.textContent = currentLang === "en" ? "Copied!" : "Скопировано!";
                setTimeout(() => {
                    if (copySpan) copySpan.textContent = originalText;
                }, 2000);
            }).catch(err => {
                console.error("Could not copy text: ", err);
            });
        });
    }

    // Sign in submission
    if (btnLoginSubmit) {
        btnLoginSubmit.addEventListener("click", async () => {
            triggerHaptic();
            const userKey = keyInput.value.trim().toUpperCase();
            if (userKey.length !== 6) {
                triggerErrorHaptic();
                panelSignin.classList.add("animate-shake");
                setTimeout(() => panelSignin.classList.remove("animate-shake"), 400);
                alert(currentLang === "en" ? "Please enter a valid 6-character key." : "Пожалуйста, введите корректный 6-значный ключ.");
                return;
            }

            btnLoginSubmit.disabled = true;
            const originalBtnText = btnLoginSubmit.innerHTML;
            btnLoginSubmit.textContent = currentLang === "en" ? "Verifying..." : "Проверка...";

            try {
                const firebase_url = localStorage.getItem("customFirebaseUrl") || "";
                const loginRes = await fetch(`${API_BASE}/api/auth/login`, {
                    method: "POST",
                    headers: {
                        "X-User-Key": userKey,
                        "X-Firebase-Url": firebase_url
                    }
                });

                if (!loginRes.ok) {
                    if (loginRes.status === 404) {
                        let registry = {};
                        try {
                            registry = JSON.parse(localStorage.getItem("userAccountsRegistry") || "{}");
                        } catch (e) {}
                        
                        if (registry[userKey]) {
                            console.log("Server key missing but found in local registry. Healing server database...");
                            const regRes = await fetch(`${API_BASE}/api/auth/register`, {
                                method: "POST",
                                headers: {
                                    "X-User-Key": userKey,
                                    "X-Firebase-Url": firebase_url
                                }
                            });
                            if (!regRes.ok) throw new Error(currentLang === "en" ? "Self-healing registration failed." : "Не удалось восстановить аккаунт на сервере.");
                            
                            const cached = registry[userKey];
                            const syncRes = await fetch(`${API_BASE}/api/auth/sync`, {
                                method: "POST",
                                headers: {
                                    "Content-Type": "application/json",
                                    "X-User-Key": userKey,
                                    "X-Firebase-Url": firebase_url
                                },
                                body: JSON.stringify({
                                    accounts: cached.accounts || [],
                                    transactions: cached.transactions || [],
                                    assets: cached.assets || [],
                                    categories: cached.categories || []
                                })
                            });
                            if (!syncRes.ok) throw new Error(currentLang === "en" ? "Self-healing sync failed." : "Не удалось восстановить данные аккаунта.");
                            
                            console.log("Self-healing completed successfully.");
                        } else {
                            throw new Error(currentLang === "en" ? "Account does not exist. Check key or sign up." : "Аккаунт не существует. Проверьте правильность ввода ключа или создайте новый аккаунт.");
                        }
                    } else {
                        throw new Error(currentLang === "en" ? "Login verification failed." : "Ошибка при проверке ключа.");
                    }
                }

                // Save key and log in
                clearUserSessionData();
                localStorage.setItem("userKey", userKey);
                localStorage.setItem("isLoggedIn", "true");
                triggerSuccessHaptic();
                
                // Reload settings view elements just in case
                const settingAccessKey = document.getElementById("setting-access-key");
                if (settingAccessKey) {
                    settingAccessKey.value = userKey;
                }
                
                // Transition to dashboard and reload data
                switchView("home");
            } catch (err) {
                triggerErrorHaptic();
                panelSignin.classList.add("animate-shake");
                setTimeout(() => panelSignin.classList.remove("animate-shake"), 400);
                alert(err.message);
            } finally {
                btnLoginSubmit.disabled = false;
                btnLoginSubmit.innerHTML = originalBtnText;
            }
        });
    }

    // Sign up confirm submission
    if (btnSignupConfirm) {
        btnSignupConfirm.addEventListener("click", async () => {
            triggerHaptic();
            const userKey = newKeyValue.textContent;
            if (userKey && userKey.length === 6 && userKey !== "XXXXXX") {
                btnSignupConfirm.disabled = true;
                const originalBtnText = btnSignupConfirm.innerHTML;
                btnSignupConfirm.innerHTML = currentLang === "en" ? "Creating..." : "Создание...";

                try {
                    const firebase_url = localStorage.getItem("customFirebaseUrl") || "";
                    const regRes = await fetch(`${API_BASE}/api/auth/register`, {
                        method: "POST",
                        headers: {
                            "X-User-Key": userKey,
                            "X-Firebase-Url": firebase_url
                        }
                    });

                    if (!regRes.ok) {
                        throw new Error(currentLang === "en" ? "Registration failed. Key might be taken." : "Ошибка при регистрации. Возможно, этот ключ уже используется.");
                    }

                    clearUserSessionData();
                    localStorage.setItem("userKey", userKey);
                    localStorage.setItem("isLoggedIn", "true");
                    triggerSuccessHaptic();
                    
                    const settingAccessKey = document.getElementById("setting-access-key");
                    if (settingAccessKey) {
                        settingAccessKey.value = userKey;
                    }
                    
                    switchView("home");
                } catch (err) {
                    triggerErrorHaptic();
                    alert(err.message);
                } finally {
                    btnSignupConfirm.disabled = false;
                    btnSignupConfirm.innerHTML = originalBtnText;
                }
            }
        });
    }

    // Force uppercase and limit chars in input
    if (keyInput) {
        keyInput.addEventListener("input", (e) => {
            e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
        });
    }
}

