from fastapi import FastAPI, HTTPException, Body, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
import os
import sqlite3
from database import get_db_connection, init_db
import firebase_db

# Initialize database
init_db()

app = FastAPI(title="Linea Finance API")

# CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Models
class TransactionCreate(BaseModel):
    account_id: int
    amount: float
    type: str # "expense", "income"
    category: str
    description: str
    date: str # YYYY-MM-DD

class AssetUpdate(BaseModel):
    symbol: str
    quantity: float
    current_price: float
    type: str = "shares"

class AssetDelete(BaseModel):
    symbol: str

class TransferCreate(BaseModel):
    from_account_id: int
    to_account_id: int
    amount: float
    date: str

class CategoryCreate(BaseModel):
    name: str
    type: str

class CategoryDelete(BaseModel):
    name: str
    type: str

# In-memory cache for live prices
import time
PRICES_CACHE = {
    "data": None,
    "timestamp": 0
}
CACHE_DURATION = 60 # 1 minute cache

# Crypto mappings to Yahoo Finance tickers
CRYPTO_YAHOO_TICKERS = {
    "BTC": "BTC-USD",
    "ETH": "ETH-USD",
    "SOL": "SOL-USD",
    "BNB": "BNB-USD",
    "USDT": "USDT-USD",
    "ADA": "ADA-USD",
    "XRP": "XRP-USD",
    "DOGE": "DOGE-USD",
    "DOT": "DOT-USD",
    "LTC": "LTC-USD",
    "TON": "TON11419-USD",
    "TONCOIN": "TON11419-USD",
    "NOT": "NOT-USD",
    "GRAM": "TON11419-USD",
    "GRAM-USD": "TON11419-USD"
}

def fetch_yahoo_price(ticker: str) -> float:
    import urllib.request
    import json
    import time
    
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}"
    req = urllib.request.Request(url, headers={
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    })
    
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=6) as resp:
                data = json.loads(resp.read().decode())
                result_chart = data.get("chart", {}).get("result")
                if result_chart and result_chart[0] is not None:
                    price = result_chart[0].get("meta", {}).get("regularMarketPrice")
                    if price is not None:
                        return float(price)
        except Exception as e:
            print(f"Yahoo Finance fetch error for {ticker} (attempt {attempt + 1}/3): {e}")
            if attempt < 2:
                time.sleep(0.5)
    return None

COINGECKO_MAPPING = {
    "BTC": "bitcoin",
    "ETH": "ethereum",
    "SOL": "solana",
    "TON": "the-open-network",
    "DOT": "polkadot",
    "ADA": "cardano",
    "XRP": "ripple",
    "DOGE": "dogecoin",
    "BNB": "binancecoin"
}

def fetch_currency_fallback(base: str, target: str) -> float:
    import urllib.request
    import json
    
    base_lower = base.lower()
    target_lower = target.lower()
    
    url = f"https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/{base_lower}.json"
    req = urllib.request.Request(url, headers={
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    })
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode())
            val = data.get(base_lower, {}).get(target_lower)
            if val is not None:
                return float(val)
    except Exception as e:
        print(f"Fallback currency API failed for {base}->{target}: {e}")
    return None

def fetch_crypto_fallback(symbol: str) -> float:
    import urllib.request
    import json
    
    clean_symbol = symbol.strip().upper().replace("-USD", "")
    cg_id = COINGECKO_MAPPING.get(clean_symbol)
    if not cg_id:
        return None
        
    url = f"https://api.coingecko.com/api/v3/simple/price?ids={cg_id}&vs_currencies=usd"
    req = urllib.request.Request(url, headers={
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    })
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode())
            val = data.get(cg_id, {}).get("usd")
            if val is not None:
                return float(val)
    except Exception as e:
        print(f"Fallback crypto API failed for {symbol}: {e}")
    return None

def recalculate_balances(data: dict) -> dict:
    accounts = data.get("accounts", [])
    transactions = data.get("transactions", [])
    
    if not accounts:
        accounts = [
            { "id": 1, "name": "Дебетовая карта", "type": "expense", "balance": 0.0 },
            { "id": 2, "name": "Свободные инвест-средства", "type": "investment", "balance": 0.0 }
        ]
        
    accounts_map = {acc["id"]: acc for acc in accounts}
    for acc in accounts:
        acc["balance"] = 0.0
        
    # Sort transactions by date and id ascending to play chronologically
    sorted_txs = sorted(transactions, key=lambda x: (x.get("date", ""), x.get("id", 0)))
    
    for tx in sorted_txs:
        acc_id = tx.get("account_id")
        amount = tx.get("amount", 0.0)
        tx_type = tx.get("type")
        category = tx.get("category")
        
        if acc_id not in accounts_map:
            continue
            
        acc = accounts_map[acc_id]
        
        if tx_type == "income":
            acc["balance"] += amount
        elif tx_type == "expense":
            acc["balance"] -= amount
        elif tx_type == "transfer":
            if category == "В портфель":
                acc["balance"] -= amount
            elif category == "На карту":
                if 1 in accounts_map:
                    accounts_map[1]["balance"] += amount
            else:
                acc["balance"] -= amount
                other_id = 2 if acc_id == 1 else 1
                if other_id in accounts_map:
                    accounts_map[other_id]["balance"] += amount
                    
    data["accounts"] = accounts
    return data

def get_user_status_remote(user_key: str, firebase_url: str):
    data = firebase_db.init_user_if_needed(user_key, firebase_url)
    data = recalculate_balances(data)
    firebase_db.save_user_data(user_key, data, firebase_url)
    
    # Get cash balances
    accounts = data.get("accounts", [])
    cash_balance = sum(acc["balance"] for acc in accounts if acc["type"] == "expense")
    inv_cash_balance = sum(acc["balance"] for acc in accounts if acc["type"] == "investment")
    
    # Calculate live portfolio value
    try:
        prices_dict = get_realtime_prices(x_user_key=user_key, x_firebase_url=firebase_url)
    except Exception as pe:
        print("Failed to get live prices in get_user_status_remote:", pe)
        prices_dict = {}
        
    assets = data.get("assets", [])
    assets_value = 0.0
    for a in assets:
        symbol = a.get("symbol", "").strip().upper()
        # Find live price, fallback to entry price
        live_price = prices_dict.get(symbol)
        if live_price is None:
            clean_symbol = symbol.replace("-USD", "")
            live_price = prices_dict.get(clean_symbol, a.get("current_price", 0.0))
        assets_value += a.get("quantity", 0.0) * live_price
        
    total_investments = inv_cash_balance + assets_value
    net_worth = cash_balance + total_investments
    
    # Monthly stats (simple sum)
    transactions = data.get("transactions", [])
    monthly_income = sum(t.get("amount", 0.0) for t in transactions if t.get("type") == "income")
    monthly_expense = sum(t.get("amount", 0.0) for t in transactions if t.get("type") == "expense")
    
    return {
        "net_worth": net_worth,
        "cash_balance": cash_balance,
        "investment_balance": total_investments,
        "monthly_income": monthly_income,
        "monthly_expense": monthly_expense,
        "accounts": accounts
    }

def get_user_transactions_remote(user_key: str, firebase_url: str):
    data = firebase_db.init_user_if_needed(user_key, firebase_url)
    transactions = data.get("transactions", [])
    accounts_map = {acc["id"]: acc["name"] for acc in data.get("accounts", [])}
    
    sorted_txs = []
    for tx in transactions:
        tx_copy = tx.copy()
        tx_copy["account_name"] = accounts_map.get(tx.get("account_id"), "Unknown")
        sorted_txs.append(tx_copy)
        
    sorted_txs.sort(key=lambda x: (x.get("date", ""), x.get("id", 0)), reverse=True)
    return sorted_txs

def create_user_transaction_remote(user_key: str, tx: TransactionCreate, firebase_url: str):
    data = firebase_db.init_user_if_needed(user_key, firebase_url)
    
    accounts = data.get("accounts", [])
    target_account = None
    for acc in accounts:
        if acc["id"] == tx.account_id:
            target_account = acc
            break
            
    if not target_account:
        raise HTTPException(status_code=404, detail="Account not found")
        
    current_balance = target_account["balance"]
    
    if tx.type == "income":
        new_balance = current_balance + tx.amount
    elif tx.type == "expense":
        if current_balance < tx.amount:
            missing = tx.amount - current_balance
            raise HTTPException(status_code=400, detail=f"Недостаточно средств на балансе карты. Не хватает {missing:,.2f} ₽.".replace(",", " "))
        new_balance = current_balance - tx.amount
    elif tx.type == "transfer":
        if tx.category == "В портфель":
            if tx.account_id != 1:
                raise HTTPException(status_code=400, detail="Неверный ID счета для покупки актива.")
            if current_balance < tx.amount:
                missing = tx.amount - current_balance
                raise HTTPException(status_code=400, detail=f"Недостаточно средств на балансе карты. Не хватает {missing:,.2f} ₽.".replace(",", " "))
            new_balance = current_balance - tx.amount
        elif tx.category == "На карту":
            new_balance = current_balance
            for acc in accounts:
                if acc["id"] == 1:
                    acc["balance"] += tx.amount
        else:
            if current_balance < tx.amount:
                missing = tx.amount - current_balance
                raise HTTPException(status_code=400, detail=f"Недостаточно средств. Не хватает {missing:,.2f} ₽.".replace(",", " "))
            new_balance = current_balance - tx.amount
            other_id = 2 if tx.account_id == 1 else 1
            for acc in accounts:
                if acc["id"] == other_id:
                    acc["balance"] += tx.amount
    else:
        raise HTTPException(status_code=400, detail="Invalid transaction type")
        
    target_account["balance"] = new_balance
    
    transactions = data.get("transactions", [])
    new_id = max([t.get("id", 0) for t in transactions] + [0]) + 1
    
    transactions.append({
        "id": new_id,
        "account_id": tx.account_id,
        "amount": tx.amount,
        "type": tx.type,
        "category": tx.category,
        "description": tx.description,
        "date": tx.date
    })
    
    firebase_db.save_user_data(user_key, data, firebase_url)
    return {"status": "success", "new_balance": new_balance}

def get_user_assets_remote(user_key: str, firebase_url: str):
    data = firebase_db.init_user_if_needed(user_key, firebase_url)
    assets = data.get("assets", [])
    
    try:
        prices_dict = get_realtime_prices(x_user_key=user_key, x_firebase_url=firebase_url)
    except Exception as pe:
        print("Failed to get live prices in get_user_assets_remote:", pe)
        prices_dict = {}
        
    assets_list = []
    total_portfolio_value = 0.0
    for a in assets:
        a_copy = a.copy()
        symbol = a.get("symbol", "").strip().upper()
        live_price = prices_dict.get(symbol)
        if live_price is None:
            clean_symbol = symbol.replace("-USD", "")
            live_price = prices_dict.get(clean_symbol, a.get("current_price", 0.0))
        a_copy["entry_price"] = a.get("current_price", 0.0)
        a_copy["live_price"] = live_price
        val = a.get("quantity", 0.0) * live_price
        a_copy["total_value"] = val
        assets_list.append(a_copy)
        total_portfolio_value += val
        
    return {
        "assets": assets_list,
        "total_value": total_portfolio_value
    }

def update_user_asset_remote(user_key: str, asset: AssetUpdate, firebase_url: str):
    data = firebase_db.init_user_if_needed(user_key, firebase_url)
    assets = data.get("assets", [])
    
    found = False
    for a in assets:
        if a.get("symbol", "").upper() == asset.symbol.upper():
            a["quantity"] = asset.quantity
            a["current_price"] = asset.current_price
            a["type"] = asset.type
            found = True
            break
            
    if not found:
        new_id = max([a.get("id", 0) for a in assets] + [0]) + 1
        assets.append({
            "id": new_id,
            "account_id": 2,
            "symbol": asset.symbol.upper(),
            "quantity": asset.quantity,
            "current_price": asset.current_price,
            "type": asset.type
        })
        
    firebase_db.save_user_data(user_key, data, firebase_url)
    return {"status": "success"}

def make_user_transfer_remote(user_key: str, transfer: TransferCreate, firebase_url: str):
    data = firebase_db.init_user_if_needed(user_key, firebase_url)
    
    accounts = data.get("accounts", [])
    src_acc = None
    dest_acc = None
    for acc in accounts:
        if acc["id"] == transfer.from_account_id:
            src_acc = acc
        if acc["id"] == transfer.to_account_id:
            dest_acc = acc
            
    if not src_acc or not dest_acc:
        raise HTTPException(status_code=404, detail="Account not found")
        
    src_acc["balance"] -= transfer.amount
    dest_acc["balance"] += transfer.amount
    
    transactions = data.get("transactions", [])
    new_id = max([t.get("id", 0) for t in transactions] + [0]) + 1
    
    transactions.append({
        "id": new_id,
        "account_id": transfer.from_account_id,
        "amount": transfer.amount,
        "type": "transfer",
        "category": "Инвестиции",
        "description": "Перевод в портфель",
        "date": transfer.date
    })
    
    firebase_db.save_user_data(user_key, data, firebase_url)
    return {"status": "success"}

def get_user_categories_remote(user_key: str, firebase_url: str):
    data = firebase_db.init_user_if_needed(user_key, firebase_url)
    return data.get("categories", [])

def create_user_category_remote(user_key: str, cat: CategoryCreate, firebase_url: str):
    data = firebase_db.init_user_if_needed(user_key, firebase_url)
    categories = data.get("categories", [])
    
    for c in categories:
        if c.get("name", "").strip().lower() == cat.name.strip().lower() and c.get("type", "").strip().lower() == cat.type.strip().lower():
            raise HTTPException(status_code=400, detail="Category already exists")
            
    new_id = max([c.get("id", 0) for c in categories] + [0]) + 1
    categories.append({
        "id": new_id,
        "name": cat.name.strip(),
        "type": cat.type.strip()
    })
    
    firebase_db.save_user_data(user_key, data, firebase_url)
    return {"status": "success"}

def delete_user_category_remote(user_key: str, cat: CategoryDelete, firebase_url: str):
    data = firebase_db.init_user_if_needed(user_key, firebase_url)
    categories = data.get("categories", [])
    
    initial_len = len(categories)
    categories = [c for c in categories if not (c.get("name", "").strip().lower() == cat.name.strip().lower() and c.get("type", "").strip().lower() == cat.type.strip().lower())]
    
    if len(categories) == initial_len:
        raise HTTPException(status_code=404, detail="Category not found")
        
    data["categories"] = categories
    firebase_db.save_user_data(user_key, data, firebase_url)
    return {"status": "success"}

def delete_user_asset_remote(user_key: str, symbol: str, firebase_url: str):
    data = firebase_db.init_user_if_needed(user_key, firebase_url)
    assets = data.get("assets", [])
    
    initial_len = len(assets)
    assets = [a for a in assets if a.get("symbol", "").upper() != symbol.upper()]
    
    if len(assets) == initial_len:
        raise HTTPException(status_code=404, detail="Asset not found")
        
    data["assets"] = assets
    firebase_db.save_user_data(user_key, data, firebase_url)
    return {"status": "success"}

def reset_user_db_remote(user_key: str, firebase_url: str):
    seeded_data = {
        "accounts": firebase_db.DEFAULT_ACCOUNTS,
        "categories": firebase_db.DEFAULT_CATEGORIES,
        "transactions": [],
        "assets": []
    }
    firebase_db.save_user_data(user_key, seeded_data, firebase_url)
    return {"status": "success"}

# Endpoints
@app.get("/api/prices")
def get_realtime_prices(symbols: str = None, x_user_key: str = Header(None), x_firebase_url: str = Header(None)):
    global PRICES_CACHE
    from concurrent.futures import ThreadPoolExecutor
    
    extra_symbols = []
    if symbols:
        extra_symbols = [s.strip().upper() for s in symbols.split(",") if s.strip()]
        
    now = time.time()
    if PRICES_CACHE["data"] and (now - PRICES_CACHE["timestamp"] < CACHE_DURATION):
        if not extra_symbols or all(s in PRICES_CACHE["data"] for s in extra_symbols):
            return PRICES_CACHE["data"]
        
    # Default fallback values in case external Yahoo Finance API fails
    default_prices = {
        "BTC_USD": 60000.0,
        "ETH_USD": 3500.0,
        "AAPL_USD": 185.0,
        "TSLA_USD": 175.0,
        "USD_RUB": 90.0,
        "EUR_RUB": 97.2
    }
    
    # 0. Query unique asset symbols and types from database
    unique_symbols = []
    personal_symbols = set()
    if x_user_key:
        try:
            data = firebase_db.init_user_if_needed(x_user_key, x_firebase_url)
            for asset in data.get("assets", []):
                sym = asset.get("symbol", "").strip().upper()
                unique_symbols.append(sym)
                if asset.get("type") in ["real_estate", "deposit"]:
                    personal_symbols.add(sym)
        except Exception as fe:
            print("Firebase query for unique symbols failed in get_realtime_prices:", fe)
    else:
        try:
            conn = get_db_connection()
            cursor = conn.cursor()
            cursor.execute("SELECT DISTINCT symbol, type FROM assets")
            for row in cursor.fetchall():
                sym = row["symbol"].strip().upper()
                unique_symbols.append(sym)
                if row["type"] in ["real_estate", "deposit"]:
                    personal_symbols.add(sym)
            conn.close()
        except Exception as dbe:
            print("Database query for unique asset symbols failed in get_realtime_prices:", dbe)

    # Add extra symbols requested by client
    for sym in extra_symbols:
        if sym not in unique_symbols:
            unique_symbols.append(sym)

    # 1. Compile all tickers to query in parallel
    tickers_to_fetch = {"USDRUB=X", "EURRUB=X", "BTC-USD", "ETH-USD", "AAPL", "TSLA"}
    for symbol in unique_symbols:
        if symbol in personal_symbols:
            continue
        clean_symbol = symbol.replace("-USD", "")
        if clean_symbol in CRYPTO_YAHOO_TICKERS:
            tickers_to_fetch.add(CRYPTO_YAHOO_TICKERS[clean_symbol])
        else:
            tickers_to_fetch.add(symbol)
            tickers_to_fetch.add(f"{symbol}-USD")

    # 2. Fetch all tickers in parallel
    fetched_results = {}
    try:
        with ThreadPoolExecutor(max_workers=10) as executor:
            futures = {ticker: executor.submit(fetch_yahoo_price, ticker) for ticker in tickers_to_fetch}
            for ticker, future in futures.items():
                price = future.result()
                if price is not None:
                    fetched_results[ticker] = price
    except Exception as exc:
        print("Error during parallel Yahoo Finance fetch:", exc)

    usd_rub = fetched_results.get("USDRUB=X") or fetch_currency_fallback("USD", "RUB") or default_prices["USD_RUB"]
    eur_rub = fetched_results.get("EURRUB=X") or fetch_currency_fallback("EUR", "RUB") or default_prices["EUR_RUB"]
    
    btc_usd = fetched_results.get("BTC-USD") or fetch_crypto_fallback("BTC") or default_prices["BTC_USD"]
    eth_usd = fetched_results.get("ETH-USD") or fetch_crypto_fallback("ETH") or default_prices["ETH_USD"]
    aapl_usd = fetched_results.get("AAPL") or default_prices["AAPL_USD"]
    tsla_usd = fetched_results.get("TSLA") or default_prices["TSLA_USD"]
    
    result = {
        "BTC": round(btc_usd * usd_rub, 2),
        "ETH": round(eth_usd * usd_rub, 2),
        "AAPL": round(aapl_usd * usd_rub, 2),
        "TSLA": round(tsla_usd * usd_rub, 2),
        "USD_RUB": round(usd_rub, 2),
        "EUR_RUB": round(eur_rub, 2)
    }
    
    # 3. Process dynamic user assets from DB
    for symbol in unique_symbols:
        if symbol in result:
            continue
            
        price_rub = None
        clean_symbol = symbol.replace("-USD", "")
        if clean_symbol in CRYPTO_YAHOO_TICKERS:
            yahoo_ticker = CRYPTO_YAHOO_TICKERS[clean_symbol]
            price_usd = fetched_results.get(yahoo_ticker) or fetch_crypto_fallback(clean_symbol)
            if price_usd is not None:
                price_rub = price_usd * usd_rub
        else:
            # Check stock asset or fallback raw ticker
            price_usd = fetched_results.get(symbol)
            if price_usd is not None:
                price_rub = price_usd * usd_rub
            else:
                # Check suffix fallback
                price_usd = fetched_results.get(f"{symbol}-USD")
                if price_usd is not None:
                    price_rub = price_usd * usd_rub
                    
        if price_rub is not None:
            result[symbol] = round(price_rub, 2)

    PRICES_CACHE["data"] = result
    PRICES_CACHE["timestamp"] = now
    return result


@app.get("/api/price")
def get_single_price(symbol: str):
    global PRICES_CACHE
    
    symbol = symbol.strip().upper()
    
    # 1. Get USD/RUB rate from cache or API
    usd_rub = 90.0
    if PRICES_CACHE["data"] and PRICES_CACHE["data"].get("USD_RUB"):
        usd_rub = PRICES_CACHE["data"]["USD_RUB"]
    else:
        usd_rub = fetch_yahoo_price("USDRUB=X") or fetch_currency_fallback("USD", "RUB") or 90.0

    # 2. Check if cryptocurrency ticker exists in mapping
    clean_symbol = symbol.replace("-USD", "")
    if clean_symbol in CRYPTO_YAHOO_TICKERS:
        yahoo_ticker = CRYPTO_YAHOO_TICKERS[clean_symbol]
        price_usd = fetch_yahoo_price(yahoo_ticker) or fetch_crypto_fallback(clean_symbol)
        if price_usd is not None:
            return {"symbol": symbol, "price": round(price_usd * usd_rub, 2), "valid": True}
        raise HTTPException(status_code=404, detail=f"Crypto price query failed on Yahoo Finance and CoinGecko for {symbol}")

    # 3. Lookup stock symbol via Yahoo Finance
    price_usd = fetch_yahoo_price(symbol)
    if price_usd is not None:
        return {"symbol": symbol, "price": round(price_usd * usd_rub, 2), "valid": True}
        
    # 4. Fallback search with -USD suffix
    price_usd = fetch_yahoo_price(f"{symbol}-USD")
    if price_usd is not None:
        return {"symbol": symbol, "price": round(price_usd * usd_rub, 2), "valid": True}
        
    raise HTTPException(status_code=404, detail=f"Symbol {symbol} not found on Yahoo Finance")



@app.get("/api/status")
def get_status(x_user_key: str = Header(None), x_firebase_url: str = Header(None)):
    if x_user_key:
        return get_user_status_remote(x_user_key, x_firebase_url)
        
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Get cash account balances (type = expense)
    cursor.execute("SELECT SUM(balance) FROM accounts WHERE type = 'expense'")
    cash_balance = cursor.fetchone()[0] or 0.0
    
    # Get investment account balances (type = investment)
    cursor.execute("SELECT SUM(balance) FROM accounts WHERE type = 'investment'")
    inv_cash_balance = cursor.fetchone()[0] or 0.0
    
    # Calculate current value of assets based on live prices
    try:
        prices_dict = get_realtime_prices()
    except Exception as pe:
        print("Failed to get live prices in get_status:", pe)
        prices_dict = {}
        
    cursor.execute("SELECT symbol, quantity, current_price FROM assets")
    assets_value = 0.0
    for row in cursor.fetchall():
        symbol = row["symbol"].strip().upper()
        # Find live price, fallback to entry price
        live_price = prices_dict.get(symbol)
        if live_price is None:
            # Check clean symbol or fallback
            clean_symbol = symbol.replace("-USD", "")
            live_price = prices_dict.get(clean_symbol, row["current_price"])
        assets_value += row["quantity"] * live_price
        
    total_investments = inv_cash_balance + assets_value
    net_worth = cash_balance + total_investments
    
    # Get individual accounts list
    cursor.execute("SELECT id, name, type, balance FROM accounts")
    accounts = [dict(row) for row in cursor.fetchall()]
    
    # Monthly stats (for current month/year - simple sum)
    cursor.execute("SELECT SUM(amount) FROM transactions WHERE type = 'income'")
    monthly_income = cursor.fetchone()[0] or 0.0
    
    cursor.execute("SELECT SUM(amount) FROM transactions WHERE type = 'expense'")
    monthly_expense = cursor.fetchone()[0] or 0.0
    
    conn.close()
    
    return {
        "net_worth": net_worth,
        "cash_balance": cash_balance,
        "investment_balance": total_investments,
        "monthly_income": monthly_income,
        "monthly_expense": monthly_expense,
        "accounts": accounts
    }

@app.get("/api/transactions")
def get_transactions(x_user_key: str = Header(None), x_firebase_url: str = Header(None)):
    if x_user_key:
        return get_user_transactions_remote(x_user_key, x_firebase_url)
        
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT t.id, t.amount, t.type, t.category, t.description, t.date, a.name as account_name 
        FROM transactions t
        LEFT JOIN accounts a ON t.account_id = a.id
        ORDER BY t.date DESC, t.id DESC
    """)
    rows = cursor.fetchall()
    conn.close()
    
    return [dict(row) for row in rows]

@app.post("/api/transactions")
def create_transaction(tx: TransactionCreate, x_user_key: str = Header(None), x_firebase_url: str = Header(None)):
    if x_user_key:
        return create_user_transaction_remote(x_user_key, tx, x_firebase_url)
        
    conn = get_db_connection()
    cursor = conn.cursor()
    
    try:
        # Check if account exists
        cursor.execute("SELECT balance, type FROM accounts WHERE id = ?", (tx.account_id,))
        account = cursor.fetchone()
        if not account:
            raise HTTPException(status_code=404, detail="Account not found")
        
        current_balance = account["balance"]
        
        # Calculate new balance
        if tx.type == "income":
            new_balance = current_balance + tx.amount
        elif tx.type == "expense":
            if current_balance < tx.amount:
                missing = tx.amount - current_balance
                raise HTTPException(status_code=400, detail=f"Недостаточно средств на балансе карты. Не хватает {missing:,.2f} ₽.".replace(",", " "))
            new_balance = current_balance - tx.amount
        elif tx.type == "transfer":
            if tx.category == "В портфель":
                if tx.account_id != 1:
                    raise HTTPException(status_code=400, detail="Неверный ID счета для покупки актива.")
                if current_balance < tx.amount:
                    missing = tx.amount - current_balance
                    raise HTTPException(status_code=400, detail=f"Недостаточно средств на балансе карты. Не хватает {missing:,.2f} ₽.".replace(",", " "))
                new_balance = current_balance - tx.amount
                # Do NOT update account 2 balance (funds go directly into the asset value)
            elif tx.category == "На карту":
                # Selling asset: return of principal from portfolio (asset) to card (1)
                # Here tx.account_id is 2. Since it comes from asset sale, we do not deduct from account 2 cash balance.
                new_balance = current_balance
                # Add the amount directly to card (1) balance
                cursor.execute("UPDATE accounts SET balance = balance + ? WHERE id = 1", (tx.amount,))
            else:
                # Generic transfer
                if current_balance < tx.amount:
                    missing = tx.amount - current_balance
                    raise HTTPException(status_code=400, detail=f"Недостаточно средств. Не хватает {missing:,.2f} ₽.".replace(",", " "))
                new_balance = current_balance - tx.amount
                if tx.account_id == 1:
                    cursor.execute("UPDATE accounts SET balance = balance + ? WHERE id = 2", (tx.amount,))
                elif tx.account_id == 2:
                    cursor.execute("UPDATE accounts SET balance = balance + ? WHERE id = 1", (tx.amount,))
        else:
            raise HTTPException(status_code=400, detail="Invalid transaction type")
            
        # Update account balance
        cursor.execute("UPDATE accounts SET balance = ? WHERE id = ?", (new_balance, tx.account_id))
        
        # Insert transaction
        cursor.execute("""
            INSERT INTO transactions (account_id, amount, type, category, description, date)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (tx.account_id, tx.amount, tx.type, tx.category, tx.description, tx.date))
        
        conn.commit()
        return {"status": "success", "new_balance": new_balance}
    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()

@app.get("/api/assets")
def get_assets(x_user_key: str = Header(None), x_firebase_url: str = Header(None)):
    if x_user_key:
        return get_user_assets_remote(x_user_key, x_firebase_url)
        
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, symbol, quantity, current_price, type, (quantity * current_price) as total_value FROM assets")
    rows = cursor.fetchall()
    conn.close()
    
    assets_list = [dict(row) for row in rows]
    total_portfolio_value = sum(item["total_value"] for item in assets_list)
    
    return {
        "assets": assets_list,
        "total_value": total_portfolio_value
    }

@app.post("/api/assets")
def update_asset(asset: AssetUpdate, x_user_key: str = Header(None), x_firebase_url: str = Header(None)):
    if x_user_key:
        return update_user_asset_remote(x_user_key, asset, x_firebase_url)
        
    conn = get_db_connection()
    cursor = conn.cursor()
    
    try:
        # Check if asset exists
        cursor.execute("SELECT id, quantity FROM assets WHERE symbol = ?", (asset.symbol,))
        row = cursor.fetchone()
        
        if row:
            # Update
            cursor.execute("""
                UPDATE assets 
                SET quantity = ?, current_price = ?, type = ?
                WHERE symbol = ?
            """, (asset.quantity, asset.current_price, asset.type, asset.symbol))
        else:
            # Insert (assuming default portfolio account_id is 2)
            cursor.execute("""
                INSERT INTO assets (account_id, symbol, quantity, current_price, type)
                VALUES (2, ?, ?, ?, ?)
            """, (asset.symbol, asset.quantity, asset.current_price, asset.type))
            
        conn.commit()
        return {"status": "success"}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()

@app.post("/api/transfer")
def make_transfer(transfer: TransferCreate, x_user_key: str = Header(None), x_firebase_url: str = Header(None)):
    if x_user_key:
        return make_user_transfer_remote(x_user_key, transfer, x_firebase_url)
        
    conn = get_db_connection()
    cursor = conn.cursor()
    
    try:
        # Deduct from source account
        cursor.execute("SELECT balance FROM accounts WHERE id = ?", (transfer.from_account_id,))
        from_acc = cursor.fetchone()
        if not from_acc:
            raise HTTPException(status_code=404, detail="Source account not found")
        
        if from_acc["balance"] < transfer.amount:
            # Let's allow overdraft but warn, or just deduct
            pass
            
        new_from_balance = from_acc["balance"] - transfer.amount
        cursor.execute("UPDATE accounts SET balance = ? WHERE id = ?", (new_from_balance, transfer.from_account_id))
        
        # Add to destination account
        cursor.execute("SELECT balance FROM accounts WHERE id = ?", (transfer.to_account_id,))
        to_acc = cursor.fetchone()
        if not to_acc:
            raise HTTPException(status_code=404, detail="Destination account not found")
            
        new_to_balance = to_acc["balance"] + transfer.amount
        cursor.execute("UPDATE accounts SET balance = ? WHERE id = ?", (new_to_balance, transfer.to_account_id))
        
        # Log transaction as transfer
        cursor.execute("""
            INSERT INTO transactions (account_id, amount, type, category, description, date)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (transfer.from_account_id, transfer.amount, "transfer", "Инвестиции", "Перевод в портфель", transfer.date))
        
        conn.commit()
        return {"status": "success"}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/categories")
def get_categories(x_user_key: str = Header(None), x_firebase_url: str = Header(None)):
    if x_user_key:
        return get_user_categories_remote(x_user_key, x_firebase_url)
        
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, name, type FROM categories")
    rows = cursor.fetchall()
    conn.close()
    return [dict(row) for row in rows]

@app.post("/api/categories")
def create_category(cat: CategoryCreate, x_user_key: str = Header(None), x_firebase_url: str = Header(None)):
    if x_user_key:
        return create_user_category_remote(x_user_key, cat, x_firebase_url)
        
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("INSERT INTO categories (name, type) VALUES (?, ?)", (cat.name.strip(), cat.type.strip()))
        conn.commit()
        return {"status": "success"}
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=400, detail="Category already exists")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()

@app.post("/api/categories/delete")
def delete_category(cat: CategoryDelete, x_user_key: str = Header(None), x_firebase_url: str = Header(None)):
    if x_user_key:
        return delete_user_category_remote(x_user_key, cat, x_firebase_url)
        
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("DELETE FROM categories WHERE name = ? AND type = ?", (cat.name.strip(), cat.type.strip()))
        conn.commit()
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()

@app.get("/api/assets/search")
def search_assets(q: str):
    import urllib.request
    import urllib.parse
    import json
    
    q = q.strip()
    if not q:
        return []
        
    try:
        url = "https://query1.finance.yahoo.com/v1/finance/search?" + urllib.parse.urlencode({"q": q})
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=3) as resp:
            data = json.loads(resp.read().decode())
            quotes = data.get("quotes", [])
            
            results = []
            for quote in quotes:
                symbol = quote.get("symbol")
                name = quote.get("longname") or quote.get("shortname") or symbol
                quote_type = quote.get("quoteType")
                
                # Map quoteType to frontend type
                if quote_type == "CRYPTOCURRENCY":
                    t = "crypto"
                elif quote_type in ["EQUITY", "ETF", "MUTUALFUND"]:
                    t = "shares"
                elif quote_type == "BOND":
                    t = "bonds"
                else:
                    t = "other"
                    
                results.append({
                    "symbol": symbol,
                    "name": name,
                    "type": t
                })
            return results
    except Exception as e:
        print("Asset search error:", e)
        # Return fallback items if Yahoo search fails
        fallback = [
            {"symbol": "SOL-USD", "name": "Solana USD", "type": "crypto"},
            {"symbol": "AAPL", "name": "Apple Inc.", "type": "shares"},
            {"symbol": "BTC-USD", "name": "Bitcoin USD", "type": "crypto"},
            {"symbol": "ETH-USD", "name": "Ethereum USD", "type": "crypto"}
        ]
        return [item for item in fallback if q.lower() in item["symbol"].lower() or q.lower() in item["name"].lower()]

@app.post("/api/assets/delete")
def delete_asset(asset: AssetDelete, x_user_key: str = Header(None), x_firebase_url: str = Header(None)):
    if x_user_key:
        return delete_user_asset_remote(x_user_key, asset.symbol, x_firebase_url)
        
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("DELETE FROM assets WHERE symbol = ?", (asset.symbol.strip().upper(),))
        conn.commit()
        return {"status": "success"}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()

@app.post("/api/reset")
def reset_database(x_user_key: str = Header(None), x_firebase_url: str = Header(None)):
    if x_user_key:
        return reset_user_db_remote(x_user_key, x_firebase_url)
        
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        # Drop tables in proper dependency order
        cursor.execute("DROP TABLE IF EXISTS transactions")
        cursor.execute("DROP TABLE IF EXISTS assets")
        cursor.execute("DROP TABLE IF EXISTS accounts")
        cursor.execute("DROP TABLE IF EXISTS categories")
        conn.commit()
        conn.close()
        
        # Re-initialize database with default seeds
        init_db()
        return {"status": "success", "message": "Database reset successfully."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/auth/login")
def login_user(x_user_key: str = Header(None), x_firebase_url: str = Header(None)):
    if not x_user_key:
        raise HTTPException(status_code=400, detail="User key is required")
    data = firebase_db.get_user_data(x_user_key, x_firebase_url)
    if not data or "accounts" not in data:
        raise HTTPException(status_code=404, detail="Account does not exist")
    return {"status": "success", "message": "User logged in successfully"}

@app.post("/api/auth/register")
def register_user(x_user_key: str = Header(None), x_firebase_url: str = Header(None)):
    if not x_user_key:
        raise HTTPException(status_code=400, detail="User key is required")
    data = firebase_db.get_user_data(x_user_key, x_firebase_url)
    if data and "accounts" in data:
        raise HTTPException(status_code=400, detail="Account already exists for this key")
    firebase_db.init_user_if_needed(x_user_key, x_firebase_url)
    return {"status": "success", "message": "User registered successfully"}

class UserDataSync(BaseModel):
    accounts: list
    transactions: list
    assets: list
    categories: list

@app.post("/api/auth/sync")
def sync_user_data(payload: UserDataSync, x_user_key: str = Header(None), x_firebase_url: str = Header(None)):
    if not x_user_key:
        raise HTTPException(status_code=400, detail="User key is required")
    data = {
        "accounts": payload.accounts,
        "transactions": payload.transactions,
        "assets": payload.assets,
        "categories": payload.categories
    }
    data = recalculate_balances(data)
    firebase_db.save_user_data(x_user_key, data, x_firebase_url)
    return {"status": "success", "message": "User data synced successfully"}


# Serve Frontend
static_dir = os.path.join(os.path.dirname(__file__), "static")
if os.path.exists(static_dir):
    app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")
else:
    @app.get("/")
    def index():
        return {"message": "Static frontend directory not found. Please create 'static' folder."}
