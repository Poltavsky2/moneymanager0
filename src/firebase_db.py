import urllib.request
import json
import logging
import sqlite3
import os

logger = logging.getLogger(__name__)

# Personal JSONBlob Cloud for this specific bot deployment
JSONBLOB_URL = "https://jsonblob.com/api/jsonBlob/019f3c12-57d4-7bc7-896b-2ec68b01e163"

if os.environ.get("VERCEL"):
    DB_PATH = "/tmp/finance.db"
else:
    DB_PATH = os.path.join(os.path.dirname(__file__), "finance.db")

def init_local_table():
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS users_data (
                user_key TEXT PRIMARY KEY,
                data_json TEXT NOT NULL
            )
        """)
        conn.commit()
        conn.close()
    except Exception as e:
        logger.error(f"Error initializing local users_data table: {e}")

DEFAULT_ACCOUNTS = [
    { "id": 1, "name": "Дебетовая карта", "type": "expense", "balance": 0.0 },
    { "id": 2, "name": "Свободные инвест-средства", "type": "investment", "balance": 0.0 }
]

DEFAULT_CATEGORIES = [
    { "id": 1, "name": "Продукты", "type": "expense" },
    { "id": 2, "name": "Транспорт", "type": "expense" },
    { "id": 3, "name": "Кафе и рестораны", "type": "expense" },
    { "id": 4, "name": "Жилье и ЖКХ", "type": "expense" },
    { "id": 5, "name": "Развлечения", "type": "expense" },
    { "id": 6, "name": "Здоровье", "type": "expense" },
    { "id": 7, "name": "Другое", "type": "expense" },
    { "id": 8, "name": "Зарплата", "type": "income" },
    { "id": 9, "name": "Трансфер", "type": "income" },
    { "id": 10, "name": "Инвестиции", "type": "income" },
    { "id": 11, "name": "Другое", "type": "income" }
]

def fetch_all_cloud_data() -> dict:
    try:
        req = urllib.request.Request(JSONBLOB_URL, headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode())
            return data if isinstance(data, dict) else {}
    except Exception as e:
        logger.error(f"Error fetching from JSONBlob: {e}")
        return None

def save_all_cloud_data(data: dict):
    try:
        req = urllib.request.Request(
            JSONBLOB_URL,
            data=json.dumps(data).encode("utf-8"),
            headers={"Content-Type": "application/json", "Accept": "application/json"},
            method="PUT"
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            resp.read()
    except Exception as e:
        logger.error(f"Error saving to JSONBlob: {e}")

def get_user_data(user_key: str, firebase_url: str = None) -> dict:
    # 1. Try Cloud
    cloud_data = fetch_all_cloud_data()
    if cloud_data is not None:
        user_data = cloud_data.get(user_key)
        if user_data:
            # Sync to local just in case
            init_local_table()
            try:
                conn = sqlite3.connect(DB_PATH)
                cursor = conn.cursor()
                cursor.execute("INSERT OR REPLACE INTO users_data (user_key, data_json) VALUES (?, ?)", 
                               (user_key, json.dumps(user_data)))
                conn.commit()
                conn.close()
            except:
                pass
            return user_data

    # 2. Local fallback
    init_local_table()
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute("SELECT data_json FROM users_data WHERE user_key = ?", (user_key,))
        row = cursor.fetchone()
        conn.close()
        if row:
            return json.loads(row[0])
    except Exception as e:
        logger.error(f"Error loading user data from local SQLite for {user_key}: {e}")
        
    return {}

def save_user_data(user_key: str, data: dict, firebase_url: str = None):
    # 1. Save Local
    init_local_table()
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute(
            "INSERT OR REPLACE INTO users_data (user_key, data_json) VALUES (?, ?)",
            (user_key, json.dumps(data))
        )
        conn.commit()
        conn.close()
    except Exception as e:
        logger.error(f"Error saving user data to local SQLite for {user_key}: {e}")
        
    # 2. Save Cloud
    cloud_data = fetch_all_cloud_data()
    if cloud_data is None:
        cloud_data = {} # If failed to fetch, overwrite locally cached cloud obj
        
    cloud_data[user_key] = data
    save_all_cloud_data(cloud_data)

def init_user_if_needed(user_key: str, firebase_url: str = None) -> dict:
    data = get_user_data(user_key, firebase_url)
    updated = False
    
    if "accounts" not in data or not data["accounts"]:
        data["accounts"] = DEFAULT_ACCOUNTS
        updated = True
    if "transactions" not in data:
        data["transactions"] = []
        updated = True
    if "assets" not in data:
        data["assets"] = []
        updated = True
    if "categories" not in data or not data["categories"]:
        data["categories"] = DEFAULT_CATEGORIES
        updated = True
        
    if updated:
        save_user_data(user_key, data, firebase_url)
        
    return data
