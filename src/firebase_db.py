import urllib.request
import json
import logging
import sqlite3
import os

logger = logging.getLogger(__name__)

DEFAULT_FIREBASE_URL = "https://finai-premium-default-rtdb.europe-west1.firebasedatabase.app/"

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

def clean_url(url: str) -> str:
    if not url:
        url = DEFAULT_FIREBASE_URL
    url = url.strip()
    if not url.endswith("/"):
        url += "/"
    return url

def get_user_data(user_key: str, firebase_url: str = None) -> dict:
    url = clean_url(firebase_url)
    is_default = (url == clean_url(DEFAULT_FIREBASE_URL))
    
    if not is_default:
        user_url = f"{url}users/{user_key}.json"
        req = urllib.request.Request(user_url)
        try:
            with urllib.request.urlopen(req, timeout=5) as resp:
                data = json.loads(resp.read().decode())
                if data and isinstance(data, dict):
                    return data
        except Exception as e:
            logger.error(f"Error fetching user data from Firebase for {user_key}: {e}. Falling back to SQLite.")

    # SQLite fallback
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
    url = clean_url(firebase_url)
    is_default = (url == clean_url(DEFAULT_FIREBASE_URL))
    
    saved_remote = False
    if not is_default:
        user_url = f"{url}users/{user_key}.json"
        req = urllib.request.Request(
            user_url,
            data=json.dumps(data).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="PUT"
        )
        try:
            with urllib.request.urlopen(req, timeout=5) as resp:
                resp.read()
                saved_remote = True
        except Exception as e:
            logger.error(f"Error saving user data to Firebase for {user_key}: {e}. Saving to SQLite fallback.")
            
    # Always save to SQLite as fallback, or if it is the default URL, or if remote save failed
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
        if not saved_remote:
            raise e

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
