import sqlite3
import os

if os.environ.get("VERCEL"):
    DB_PATH = "/tmp/finance.db"
else:
    DB_PATH = os.path.join(os.path.dirname(__file__), "finance.db")


def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Create accounts table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        balance REAL DEFAULT 0.0
    )
    """)
    
    # Create transactions table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER,
        amount REAL NOT NULL,
        type TEXT NOT NULL,
        category TEXT NOT NULL,
        description TEXT,
        date TEXT NOT NULL,
        FOREIGN KEY(account_id) REFERENCES accounts(id)
    )
    """)
    
    # Create assets table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS assets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER,
        symbol TEXT NOT NULL,
        quantity REAL NOT NULL DEFAULT 0.0,
        current_price REAL DEFAULT 0.0,
        type TEXT DEFAULT 'shares',
        FOREIGN KEY(account_id) REFERENCES accounts(id)
    )
    """)

    # Create categories table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        UNIQUE(name, type)
    )
    """)
    
    # Create users_data table for key-based profile fallback
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS users_data (
        user_key TEXT PRIMARY KEY,
        data_json TEXT NOT NULL
    )
    """)
    
    # Seed default categories
    cursor.execute("SELECT COUNT(*) FROM categories")
    if cursor.fetchone()[0] == 0:
        default_categories = [
            ("Продукты", "expense"),
            ("Транспорт", "expense"),
            ("Кафе и рестораны", "expense"),
            ("Жилье и ЖКХ", "expense"),
            ("Развлечения", "expense"),
            ("Здоровье", "expense"),
            ("Другое", "expense"),
            ("Зарплата", "income"),
            ("Трансфер", "income"),
            ("Инвестиции", "income"),
            ("Другое", "income")
        ]
        cursor.executemany("INSERT OR IGNORE INTO categories (name, type) VALUES (?, ?)", default_categories)
    
    # Migrate table to add type column if it doesn't exist
    try:
        cursor.execute("ALTER TABLE assets ADD COLUMN type TEXT DEFAULT 'shares'")
    except sqlite3.OperationalError:
        pass
        
    # Ensure existing crypto assets have correct type
    cursor.execute("UPDATE assets SET type = 'crypto' WHERE symbol IN ('BTC', 'ETH') AND type = 'shares'")
        
    # Seed default data if empty
    cursor.execute("SELECT COUNT(*) FROM accounts")
    if cursor.fetchone()[0] == 0:
        cursor.execute("INSERT INTO accounts (name, type, balance) VALUES (?, ?, ?)", ("Дебетовая карта", "expense", 0.0))
        cursor.execute("INSERT INTO accounts (name, type, balance) VALUES (?, ?, ?)", ("Свободные инвест-средства", "investment", 0.0))
        
        # No default assets seeded
        # No default transactions seeded
        
    conn.commit()
    conn.close()

if __name__ == "__main__":
    init_db()
    print("Database initialized successfully.")
