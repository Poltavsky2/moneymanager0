import os
import sys
import json
import logging
import asyncio
import base64
import re
import io
import sqlite3
from datetime import datetime, timedelta

import httpx
from telegram import (
    Update, InlineKeyboardButton, InlineKeyboardMarkup, ReplyKeyboardRemove, WebAppInfo
)
from telegram.ext import (
    Application, CommandHandler, MessageHandler,
    CallbackQueryHandler, ContextTypes, filters
)
from dotenv import load_dotenv

# Set logging
logging.basicConfig(
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    level=logging.INFO
)
logger = logging.getLogger(__name__)

# Load env variables
load_dotenv(override=True)

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "calorie_diary.db")

# ----------------- DB SETUP -----------------

def init_db():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # User settings table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS user_settings (
        user_id INTEGER PRIMARY KEY,
        api_key TEXT,
        api_provider TEXT DEFAULT 'gemini'
    )
    """)
    
    # Diet entries table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS diet_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        meal_type TEXT,
        timestamp INTEGER,
        food_name TEXT,
        utility TEXT,
        description TEXT,
        calories REAL,
        protein REAL,
        fat REAL,
        carbs REAL,
        grams REAL,
        ingredients_json TEXT,
        health_score INTEGER,
        warning_type TEXT,
        water_ml INTEGER DEFAULT 0,
        steps_count INTEGER DEFAULT 0
    )
    """)
    
    # Add migration columns if they don't exist
    try:
        cursor.execute("ALTER TABLE diet_entries ADD COLUMN health_score INTEGER")
    except sqlite3.OperationalError:
        pass
    try:
        cursor.execute("ALTER TABLE diet_entries ADD COLUMN warning_type TEXT")
    except sqlite3.OperationalError:
        pass
    try:
        cursor.execute("ALTER TABLE diet_entries ADD COLUMN water_ml INTEGER DEFAULT 0")
    except sqlite3.OperationalError:
        pass
    try:
        cursor.execute("ALTER TABLE diet_entries ADD COLUMN steps_count INTEGER DEFAULT 0")
    except sqlite3.OperationalError:
        pass
        
    conn.commit()
    conn.close()

def get_user_settings(user_id: int) -> dict:
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("SELECT api_key, api_provider FROM user_settings WHERE user_id = ?", (user_id,))
    row = cursor.fetchone()
    conn.close()
    if row:
        return {"api_key": row[0], "api_provider": row[1]}
    return None

def set_user_api_key(user_id: int, api_key: str, provider: str = 'gemini'):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("""
    INSERT OR REPLACE INTO user_settings (user_id, api_key, api_provider)
    VALUES (?, ?, ?)
    """, (user_id, api_key, provider))
    conn.commit()
    conn.close()

def clear_user_api_key(user_id: int):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("DELETE FROM user_settings WHERE user_id = ?", (user_id,))
    conn.commit()
    conn.close()

def encode_telegram_id(tg_id: int) -> str:
    chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    num = tg_id
    code = ''
    while num > 0:
        code = chars[num % 32] + code
        num = num // 32
    return code.rjust(10, 'A')

def to_firestore_value(val):
    if isinstance(val, str):
        return {"stringValue": val}
    elif isinstance(val, bool):
        return {"booleanValue": val}
    elif isinstance(val, int):
        return {"integerValue": str(val)}
    elif isinstance(val, float):
        return {"doubleValue": val}
    elif isinstance(val, list):
        return {"arrayValue": {"values": [to_firestore_value(x) for x in val]}}
    elif isinstance(val, dict):
        return {"mapValue": {"fields": {k: to_firestore_value(v) for k, v in val.items()}}}
    elif val is None:
        return {"nullValue": None}
    else:
        return {"stringValue": str(val)}

_ensured_profiles: set = set()

def ensure_user_profile(user_id: int, first_name: str = "Telegram User"):
    """Ensure a user profile document exists in Firestore for this Telegram user."""
    firestore_user_id = encode_telegram_id(user_id)
    if firestore_user_id in _ensured_profiles:
        return  # Already ensured this session
    
    project_id = os.environ.get("FIRESTORE_PROJECT_ID", "gen-lang-client-0531427038")
    database_id = os.environ.get("FIRESTORE_DATABASE_ID", "ai-studio-bioprizma-4507c715-35b3-4388-9a86-c14535f1207b")
    api_key = os.environ.get("FIRESTORE_API_KEY", "AIzaSyCPfRCkJzO5Q3EZSxL0f2Q67yMEFqasfhQ")
    
    # Check if profile already exists
    check_url = f"https://firestore.googleapis.com/v1/projects/{project_id}/databases/{database_id}/documents/users/{firestore_user_id}?key={api_key}"
    try:
        resp = httpx.get(check_url, timeout=10.0)
        if resp.status_code == 200:
            _ensured_profiles.add(firestore_user_id)
            return  # Profile already exists
    except Exception:
        pass  # Continue to create
    
    # Create profile using Firestore REST API (PATCH = upsert)
    import time as _time
    now_ms = int(_time.time() * 1000)
    data = {
        "appData": {
            "user": {
                "name": first_name,
                "xp": 0,
                "level": 1,
                "streak": 0,
                "lastActive": now_ms,
                "registeredAt": now_ms
            }
        },
        "lastLoginAt": now_ms
    }
    payload = {"fields": {k: to_firestore_value(v) for k, v in data.items()}}
    
    try:
        resp = httpx.patch(check_url, json=payload, timeout=10.0)
        if resp.status_code == 200:
            logger.info(f"Created Firestore profile for user {firestore_user_id}")
            _ensured_profiles.add(firestore_user_id)
        else:
            logger.warning(f"Could not create Firestore profile: {resp.status_code} - {resp.text}")
    except Exception as e:
        logger.error(f"Error creating Firestore profile: {e}")

def sync_to_firestore(user_id: int, entry_id: str, meal_type: str, timestamp: int, food_name: str, 
                      utility: str, description: str, calories: float, protein: float, 
                      fat: float, carbs: float, grams: float, ingredients_json: str,
                      health_score: int, warning_type: str, water_ml: int = 0, steps_count: int = 0,
                      first_name: str = "Telegram User"):
    # Ensure user profile exists before syncing diet entry
    ensure_user_profile(user_id, first_name)
    
    project_id = os.environ.get("FIRESTORE_PROJECT_ID", "gen-lang-client-0531427038")
    database_id = os.environ.get("FIRESTORE_DATABASE_ID", "ai-studio-bioprizma-4507c715-35b3-4388-9a86-c14535f1207b")
    api_key = os.environ.get("FIRESTORE_API_KEY", "AIzaSyCPfRCkJzO5Q3EZSxL0f2Q67yMEFqasfhQ")
    
    firestore_user_id = encode_telegram_id(user_id)
    url = f"https://firestore.googleapis.com/v1/projects/{project_id}/databases/{database_id}/documents/users/{firestore_user_id}/diet/{entry_id}?key={api_key}"
    
    data = {
        "id": entry_id,
        "mealType": meal_type,
        "grams": float(grams),
        "calories": float(calories),
        "health_score": int(health_score) if health_score is not None else 100,
        "warningType": warning_type or "none",
        "protein": float(protein),
        "fat": float(fat),
        "carbs": float(carbs),
        "timestamp": int(timestamp * 1000), # JS milliseconds
        "description": description or ""
    }
    
    if meal_type not in ["water", "steps"] and food_name:
        data["items"] = [
            {
                "productId": "bot-entry",
                "productName": food_name,
                "grams": float(grams),
                "calories": float(calories),
                "health_score": int(health_score) if health_score is not None else 100,
                "protein": float(protein),
                "fat": float(fat),
                "carbs": float(carbs)
            }
        ]
    
    if water_ml > 0:
        data["water_ml"] = int(water_ml)
    if steps_count > 0:
        data["steps_count"] = int(steps_count)
        
    payload = {
        "fields": {k: to_firestore_value(v) for k, v in data.items()}
    }
    
    try:
        resp = httpx.patch(url, json=payload, timeout=10.0)
        if resp.status_code != 200:
            logger.error(f"Failed to sync to Firestore: {resp.status_code} - {resp.text}")
        else:
            logger.info(f"Successfully synced entry {entry_id} to Firestore for user {firestore_user_id}")
    except Exception as e:
        logger.error(f"Error syncing to Firestore: {e}")

def save_diet_entry(user_id: int, meal_type: str, timestamp: int, food_name: str, 
                    utility: str, description: str, calories: float, protein: float, 
                    fat: float, carbs: float, grams: float, ingredients_json: str,
                    health_score: int, warning_type: str, water_ml: int = 0, steps_count: int = 0):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("""
    INSERT INTO diet_entries (user_id, meal_type, timestamp, food_name, utility, 
                             description, calories, protein, fat, carbs, grams, 
                             ingredients_json, health_score, warning_type, water_ml, steps_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (user_id, meal_type, timestamp, food_name, utility, description, calories, protein, fat, carbs, grams, ingredients_json, health_score, warning_type, water_ml, steps_count))
    row_id = cursor.lastrowid
    conn.commit()
    conn.close()
    
    entry_id = f"tg_entry_{row_id}"
    sync_to_firestore(
        user_id=user_id,
        entry_id=entry_id,
        meal_type=meal_type,
        timestamp=timestamp,
        food_name=food_name,
        utility=utility,
        description=description,
        calories=calories,
        protein=protein,
        fat=fat,
        carbs=carbs,
        grams=grams,
        ingredients_json=ingredients_json,
        health_score=health_score,
        warning_type=warning_type,
        water_ml=water_ml,
        steps_count=steps_count
    )

# Initialize DB on import/run
init_db()

# ----------------- SYSTEM PROMPT -----------------

PROMPT = """Ты — эксперт-нутрициолог и биохимик пищевых производств. Твоя задача — классифицировать пользовательский ввод и провести глубокий анализ состава продукта (по тексту, названию, фото или аудио).

Сначала определи тип ввода: "food" (еда/блюдо), "water" (питьевая вода) или "steps" (шаги/активность/ходьба).

Возврати результат строго в формате JSON.

1. Если тип ввода "water" (пользователь выпил воды):
{
  "type": "water",
  "name": "Питьевая вода",
  "water_ml": 300, // Объем выпитой воды в миллилитрах. Распознай из текста или голоса (например, "300 мл", "стакан" -> 250, "бутылка" -> 500). Если не указано, верни 250.
  "verdict": "Краткое напоминание о пользе гидратации."
}

2. Если тип ввода "steps" (пользователь прошел шаги/расстояние):
{
  "type": "steps",
  "name": "Шаги / Активность",
  "steps_count": 10000, // Количество шагов. Если указано расстояние (например, "прошел 3 км"), переведи в шаги из расчета 1 км = 1300 шагов (3 км -> 3900 шагов).
  "verdict": "Краткий ободряющий вердикт об активности."
}

3. Если тип ввода "food" (обычная еда, продукт или готовое блюдо):
{
  "type": "food",
  "name": "Точное название продукта или блюда.",
  "description": "Исходный текст запроса пользователя (сохрани его как есть) ИЛИ краткое описание того, что ты увидел на фото / услышал в аудио.",
  "category": "Категория блюда/продукта ("product" - монопродукт, "simple_dish" - простое блюдо из 2-3 ингредиентов, "complex_dish" - сложное многокомпонентное блюдо).",
  "nutrition": {
    "calories": 150, // Калории на 100г (или на порцию для готовых блюд)
    "protein": 5.5,
    "fat": 3.2,
    "carbs": 24.0
  },
  "health_score": 85, // Оценка пользы от 0 до 100
  "verdict": "Итоговый вердикт (совет нутрициолога простыми словами).",
  "warning_type": "Тип предупреждения ("danger" - токсично/непищевое, "caution" - непищевое случайно, "info" - БАД/витамины, "none" - обычная еда).",
  "ingredients": [ // Разбор состава на ключевые ингредиенты
    {
      "name": "Название ингредиента",
      "health_impact": "Степень влияния ("low" — полезно, "medium" — нейтрально, "high" — вредно). ВНИМАНИЕ: "low" = полезно, "high" = опасно.",
      "risk_level": 2, // Риск-фактор от 0 до 10
      "description": "Краткое понятное описание влияния на организм."
    }
  ],
  "estimated_weight": 250 // Примерный вес порции в граммах. Если вес указан в описании, используй его.
}

Ответь только валидным JSON без Markdown-разметки или ```json. Все значения должны быть на русском языке.
"""

# ----------------- AI INTEGRATION HELPERS -----------------

def parse_and_clean_json(text: str) -> dict:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\n", "", text)
        text = re.sub(r"\n```$", "", text)
    text = text.strip()
    return json.loads(text)

def validate_food_data(data) -> dict:
    if isinstance(data, list):
        if len(data) > 0 and isinstance(data[0], dict):
            data = data[0]
        else:
            data = {}
    elif not isinstance(data, dict):
        data = {}

    validated = {}
    
    input_type = data.get("type") or "food"
    if input_type not in ["food", "water", "steps"]:
        input_type = "food"
    validated["type"] = input_type
    
    validated["name"] = data.get("name") or ("Питьевая вода" if input_type == "water" else "Шаги" if input_type == "steps" else "Неизвестное блюдо")
    
    if input_type == "water":
        try:
            validated["water_ml"] = int(data.get("water_ml") or 250)
        except:
            validated["water_ml"] = 250
        validated["verdict"] = data.get("verdict") or "Потребление чистой воды полезно для организма."
        return validated
        
    elif input_type == "steps":
        try:
            validated["steps_count"] = int(data.get("steps_count") or 5000)
        except:
            validated["steps_count"] = 5000
        validated["verdict"] = data.get("verdict") or "Активность способствует поддержанию здоровья."
        return validated
        
    category = data.get("category") or "product"
    if category not in ["product", "simple_dish", "complex_dish"]:
        category = "product"
    validated["category"] = category
    
    nutrition = data.get("nutrition") or {}
    validated["nutrition"] = {
        "calories": float(nutrition.get("calories") or 0),
        "protein": float(nutrition.get("protein") or 0),
        "fat": float(nutrition.get("fat") or 0),
        "carbs": float(nutrition.get("carbs") or 0)
    }
    
    try:
        validated["health_score"] = int(data.get("health_score") or 50)
    except:
        validated["health_score"] = 50
        
    validated["verdict"] = data.get("verdict") or "Совет отсутствует"
    validated["description"] = data.get("description") or ""
    
    warning_type = data.get("warning_type") or "none"
    if warning_type not in ["danger", "caution", "info", "none"]:
        warning_type = "none"
    validated["warning_type"] = warning_type
    
    ingredients = []
    for ing in data.get("ingredients", []):
        if isinstance(ing, dict) and ing.get("name"):
            health_impact = ing.get("health_impact") or "medium"
            if health_impact not in ["low", "medium", "high"]:
                health_impact = "medium"
            try:
                risk_level = int(ing.get("risk_level") or 0)
            except:
                risk_level = 0
            ingredients.append({
                "name": ing.get("name"),
                "health_impact": health_impact,
                "risk_level": risk_level,
                "description": ing.get("description") or ""
            })
    validated["ingredients"] = ingredients
    
    try:
        estimated_weight = float(data.get("estimated_weight") or 200)
    except:
        estimated_weight = 200
    validated["estimated_weight"] = estimated_weight
    
    return validated

async def analyze_food_gemini(api_key: str, text: str = None, photo_bytes: bytes = None, voice_bytes: bytes = None) -> dict:
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key={api_key}"
    
    parts = [{"text": PROMPT}]
    if text:
        parts.append({"text": text})
    if photo_bytes:
        parts.append({
            "inlineData": {
                "mimeType": "image/jpeg",
                "data": base64.b64encode(photo_bytes).decode('utf-8')
            }
        })
    if voice_bytes:
        parts.append({
            "inlineData": {
                "mimeType": "audio/ogg",
                "data": base64.b64encode(voice_bytes).decode('utf-8')
            }
        })
        
    payload = {
        "contents": [{"parts": parts}],
        "generationConfig": {
            "responseMimeType": "application/json"
        }
    }
    
    async with httpx.AsyncClient() as client:
        resp = await client.post(url, json=payload, timeout=45.0)
        if resp.status_code != 200:
            raise Exception(f"Gemini API Error (status {resp.status_code}): {resp.text}")
        
        result = resp.json()
        text_response = result['candidates'][0]['content']['parts'][0]['text']
        return parse_and_clean_json(text_response)

async def analyze_food_openai(api_key: str, text: str = None, photo_bytes: bytes = None, voice_bytes: bytes = None) -> dict:
    if voice_bytes:
        # Transcribe audio using Whisper first
        transcribe_url = "https://api.openai.com/v1/audio/transcriptions"
        headers = {"Authorization": f"Bearer {api_key}"}
        files = {
            "file": ("voice.ogg", voice_bytes, "audio/ogg"),
            "model": (None, "whisper-1")
        }
        async with httpx.AsyncClient() as client:
            resp = await client.post(transcribe_url, headers=headers, files=files, timeout=30.0)
            if resp.status_code != 200:
                raise Exception(f"OpenAI Whisper Error (status {resp.status_code}): {resp.text}")
            text = resp.json().get("text", "")
            
    url = "https://api.openai.com/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }
    
    content_list = [{"type": "text", "text": PROMPT}]
    if text:
        content_list.append({"type": "text", "text": f"User food input: {text}"})
    if photo_bytes:
        base64_str = base64.b64encode(photo_bytes).decode('utf-8')
        content_list.append({
            "type": "image_url",
            "image_url": {
                "url": f"data:image/jpeg;base64,{base64_str}"
            }
        })
        
    payload = {
        "model": "gpt-4o-mini",
        "messages": [{"role": "user", "content": content_list}],
        "response_format": {"type": "json_object"},
        "temperature": 0.2
    }
    
    async with httpx.AsyncClient() as client:
        resp = await client.post(url, headers=headers, json=payload, timeout=45.0)
        if resp.status_code != 200:
            raise Exception(f"OpenAI API Error (status {resp.status_code}): {resp.text}")
        
        result = resp.json()
        response_text = result["choices"][0]["message"]["content"]
        return parse_and_clean_json(response_text)

# ----------------- UI / FORMATTING HELPERS -----------------

def format_food_message_html(data: dict) -> str:
    msg = f"🍏 <b>{data['name']}</b>\n"
    category_names = {
        "product": "Продукт / товар",
        "simple_dish": "Простое блюдо",
        "complex_dish": "Сложное блюдо"
    }
    msg += f"📦 <b>Категория</b>: {category_names.get(data['category'], data['category'])}\n"
    msg += f"💯 <b>Оценка пользы</b>: {data['health_score']}/100\n"
    
    if data["warning_type"] != "none":
        warning_names = {
            "danger": "⚠️ ОПАСНОСТЬ (Токсичные/непищевые вещества)",
            "caution": "⚠️ ВНИМАНИЕ (Случайный непищевой объект)",
            "info": "ℹ️ ИНФОРМАЦИЯ (БАД/Витамины)"
        }
        msg += f"🚨 <b>Предупреждение</b>: {warning_names.get(data['warning_type'], data['warning_type'])}\n"
        
    msg += f"💬 <b>Вердикт</b>: <i>{data['verdict']}</i>\n\n"
    
    if data["ingredients"]:
        msg += "🥗 <b>Состав</b>:\n"
        for ing in data["ingredients"]:
            impact = ing["health_impact"]
            # low -> healthy (🟢), medium -> neutral (🟡), high -> dangerous (🔴)
            emoji = "🟢" if impact == "low" else "🟡" if impact == "medium" else "🔴"
            risk_info = f" (Риск: {ing['risk_level']}/10)" if ing['risk_level'] > 0 else ""
            desc = f" — {ing['description']}" if ing['description'] else ""
            msg += f"  {emoji} {ing['name']}{risk_info}{desc}\n"
        msg += "\n"
        
    nut = data["nutrition"]
    msg += "📊 <b>КБЖУ (на 100г)</b>:\n"
    msg += f"🔥 Калории: <b>{nut['calories']:.1f} ккал</b>\n"
    msg += f"🥩 Белки: <b>{nut['protein']:.1f} г</b>\n"
    msg += f"🥑 Жиры: <b>{nut['fat']:.1f} г</b>\n"
    msg += f"🍞 Углеводы: <b>{nut['carbs']:.1f} г</b>\n\n"
    msg += f"🤖 Авто-оценка веса порции: <b>{data['estimated_weight']:.0f} г</b>\n"
    return msg

def format_water_message_html(data: dict) -> str:
    msg = f"💧 <b>{data['name']}</b>\n\n"
    msg += f"🥤 Объем: <b>{data['water_ml']} мл чистой воды</b>\n"
    msg += f"💬 Вердикт: <i>{data['verdict']}</i>\n"
    return msg

def format_steps_message_html(data: dict) -> str:
    msg = f"🏃‍♂️ <b>{data['name']}</b>\n\n"
    msg += f"🚶‍♂️ Шаги: <b>{data['steps_count']} шагов</b>\n"
    msg += f"💬 Вердикт: <i>{data['verdict']}</i>\n"
    return msg

# ----------------- BOT HANDLERS -----------------

def get_main_keyboard():
    load_dotenv(override=True)
    web_app_url = os.environ.get("WEB_APP_URL")
    keyboard = []
    if web_app_url and web_app_url != "https://your-ngrok-subdomain.ngrok-free.app":
        keyboard.append([InlineKeyboardButton("📊 Открыть Bioprizma", web_app=WebAppInfo(url=web_app_url))])
    keyboard.append([InlineKeyboardButton("📝 Добавить запись", callback_data="menu_add_log")])
    keyboard.append([InlineKeyboardButton("⚙️ Настройки", callback_data="menu_settings")])
    return InlineKeyboardMarkup(keyboard)

async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    # Clear states
    context.user_data['state'] = None
    context.user_data['last_analysis'] = None
    context.user_data['diary_flow'] = None
    
    welcome_text = (
        "🍏 <b>Привет! Я твой персональный дневник питания, воды и активности.</b>\n\n"
        "Выберите интересующее действие ниже:"
    )
    await update.message.reply_html(welcome_text, reply_markup=get_main_keyboard())

async def cancel_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data['state'] = None
    context.user_data['last_analysis'] = None
    context.user_data['diary_flow'] = None
    
    welcome_text = (
        "❌ <b>Действие отменено.</b>\n\n"
        "Выберите интересующее действие ниже:"
    )
    await update.message.reply_html(welcome_text, reply_markup=get_main_keyboard())

async def settings_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await show_settings(update, context, from_callback=False)

async def show_settings(query_or_message, context, from_callback=True):
    user_id = query_or_message.from_user.id if from_callback else query_or_message.effective_user.id
    settings = get_user_settings(user_id)
    
    # Check fallback/env keys
    has_system_gemini = bool(os.environ.get("GEMINI_API_KEY") and os.environ.get("GEMINI_API_KEY") != "YOUR_GEMINI_API_KEY_HERE")
    has_system_openai = bool(os.environ.get("OPENAI_API_KEY") and os.environ.get("OPENAI_API_KEY") != "YOUR_OPENAI_API_KEY_HERE")
    
    key_status = "❌ Не установлен"
    provider_status = "Gemini"
    
    if settings and settings.get("api_key"):
        key_status = "✅ Установлен пользователем"
        provider_status = "OpenAI" if settings.get("api_provider") == "openai" else "Gemini"
    elif has_system_gemini:
        key_status = "⚙️ Используется системный ключ (Gemini)"
        provider_status = "Gemini"
    elif has_system_openai:
        key_status = "⚙️ Используется системный ключ (OpenAI)"
        provider_status = "OpenAI"
        
    settings_text = (
        "⚙️ <b>Настройки бота</b>\n\n"
        f"🔑 <b>API-ключ нейросети</b>: {key_status}\n"
        f"🤖 <b>Провайдер по умолчанию</b>: {provider_status}\n\n"
        "Вы можете подключить собственный API-ключ Gemini или OpenAI для индивидуального лимитирования запросов."
    )
    
    keyboard = [
        [InlineKeyboardButton("🔑 Установить API-ключ", callback_data="settings_set_key")],
        [InlineKeyboardButton("🗑 Сбросить API-ключ", callback_data="settings_clear_key")],
        [InlineKeyboardButton("🏠 Главное меню", callback_data="menu_main")]
    ]
    reply_markup = InlineKeyboardMarkup(keyboard)
    
    if from_callback:
        await query_or_message.edit_message_text(settings_text, parse_mode="HTML", reply_markup=reply_markup)
    else:
        await query_or_message.reply_html(settings_text, reply_markup=reply_markup)

async def prompt_add_log(query, context):
    context.user_data['state'] = "AWAITING_FOOD_INPUT"
    prompt_text = (
        "✍️🎙📸 <b>Отправьте описание приема пищи, воды или шагов:</b>\n\n"
        "• <b>Еда</b>: напишите текстом (<i>'съел плов 200г'</i>), надиктуйте голосом или отправьте фото.\n"
        "• <b>Вода</b>: напишите объем (<i>'выпил 300 мл воды'</i>) или надиктуйте голосом.\n"
        "• <b>Шаги</b>: напишите активность (<i>'прошел 10 000 шагов'</i> или <i>'3 км пешком'</i>).\n\n"
        "Вы можете отправить сообщение в чат или вернуться в главное меню."
    )
    keyboard = [
        [InlineKeyboardButton("🏠 Главное меню", callback_data="menu_main")]
    ]
    await query.edit_message_text(prompt_text, parse_mode="HTML", reply_markup=InlineKeyboardMarkup(keyboard))

async def callback_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    
    user_id = query.from_user.id
    data = query.data
    
    if data == "menu_main":
        context.user_data['state'] = None
        context.user_data['last_analysis'] = None
        context.user_data['diary_flow'] = None
        
        welcome_text = (
            "🍏 <b>Привет! Я твой персональный дневник питания, воды и активности.</b>\n\n"
            "Выберите интересующее действие ниже:"
        )
        await query.edit_message_text(welcome_text, parse_mode="HTML", reply_markup=get_main_keyboard())
        
    elif data == "menu_settings":
        await show_settings(query, context, from_callback=True)
        
    elif data == "menu_add_log":
        await prompt_add_log(query, context)
        
    elif data == "settings_set_key":
        context.user_data['state'] = "AWAITING_API_KEY"
        keyboard = [
            [InlineKeyboardButton("⬅️ Назад", callback_data="menu_settings"),
             InlineKeyboardButton("🏠 Главное меню", callback_data="menu_main")]
        ]
        await query.edit_message_text(
            "🔑 <b>Введите ваш API-ключ:</b>\n\n"
            "• Ключи Gemini обычно начинаются с <code>AIzaSy</code>\n"
            "• Ключи OpenAI обычно начинаются с <code>sk-</code>\n\n"
            "Отправьте ключ ответным сообщением или введите /cancel для отмены.",
            parse_mode="HTML",
            reply_markup=InlineKeyboardMarkup(keyboard)
        )
        
    elif data == "settings_clear_key":
        clear_user_api_key(user_id)
        keyboard = [
            [InlineKeyboardButton("🏠 Главное меню", callback_data="menu_main")]
        ]
        await query.edit_message_text("🗑 Ваш пользовательский API-ключ успешно удален.", reply_markup=InlineKeyboardMarkup(keyboard))
        
    elif data == "action_reset":
        context.user_data['last_analysis'] = None
        context.user_data['diary_flow'] = None
        context.user_data['state'] = None
        keyboard = [
            [InlineKeyboardButton("🏠 Главное меню", callback_data="menu_main")]
        ]
        await query.edit_message_text("🔄 Запись сброшена. Вы можете отправить новое описание еды.", reply_markup=InlineKeyboardMarkup(keyboard))
        
    elif data == "action_add_diary":
        last_analysis = context.user_data.get('last_analysis')
        if not last_analysis:
            await query.edit_message_text("⚠️ Ошибка: данные анализа не найдены. Пожалуйста, отправьте запись заново.")
            return
            
        input_type = last_analysis.get("type", "food")
        
        if input_type == "water":
            water_ml = last_analysis["water_ml"]
            save_diet_entry(
                user_id=user_id,
                meal_type="water",
                timestamp=int(datetime.now().timestamp()),
                food_name="Питьевая вода",
                utility=last_analysis["verdict"],
                description=f"Потребление воды: {water_ml} мл",
                calories=0.0,
                protein=0.0,
                fat=0.0,
                carbs=0.0,
                grams=float(water_ml),
                ingredients_json="[]",
                health_score=100,
                warning_type="none",
                water_ml=water_ml,
                steps_count=0
            )
            confirm_text = (
                "💧 <b>Успешно добавлено в дневник!</b>\n\n"
                f"🥤 Объем: <b>{water_ml} мл чистой воды</b>\n"
                f"💬 Вердикт: <i>{last_analysis['verdict']}</i>"
            )
            keyboard = [
                [InlineKeyboardButton("📝 Добавить запись", callback_data="menu_add_log")],
                [InlineKeyboardButton("🏠 Главное меню", callback_data="menu_main")]
            ]
            await query.edit_message_text(confirm_text, parse_mode="HTML", reply_markup=InlineKeyboardMarkup(keyboard))
            context.user_data['state'] = None
            context.user_data['last_analysis'] = None
            context.user_data['diary_flow'] = None
            return
            
        elif input_type == "steps":
            steps_count = last_analysis["steps_count"]
            save_diet_entry(
                user_id=user_id,
                meal_type="steps",
                timestamp=int(datetime.now().timestamp()),
                food_name="Шаги / Активность",
                utility=last_analysis["verdict"],
                description=f"Активность: {steps_count} шагов",
                calories=0.0,
                protein=0.0,
                fat=0.0,
                carbs=0.0,
                grams=0.0,
                ingredients_json="[]",
                health_score=100,
                warning_type="none",
                water_ml=0,
                steps_count=steps_count
            )
            confirm_text = (
                "🏃‍♂️ <b>Успешно добавлено в дневник!</b>\n\n"
                f"🚶‍♂️ Шаги: <b>{steps_count} шагов</b>\n"
                f"💬 Вердикт: <i>{last_analysis['verdict']}</i>"
            )
            keyboard = [
                [InlineKeyboardButton("📝 Добавить запись", callback_data="menu_add_log")],
                [InlineKeyboardButton("🏠 Главное меню", callback_data="menu_main")]
            ]
            await query.edit_message_text(confirm_text, parse_mode="HTML", reply_markup=InlineKeyboardMarkup(keyboard))
            context.user_data['state'] = None
            context.user_data['last_analysis'] = None
            context.user_data['diary_flow'] = None
            return
            
        # For Food, proceed with step-by-step
        context.user_data['diary_flow'] = {}
        keyboard = [
            [InlineKeyboardButton("🌅 Завтрак", callback_data="meal_breakfast"),
             InlineKeyboardButton("☀️ Обед", callback_data="meal_lunch")],
            [InlineKeyboardButton("🌌 Ужин", callback_data="meal_dinner"),
             InlineKeyboardButton("🍎 Перекус", callback_data="meal_snack")],
            [InlineKeyboardButton("🏠 Главное меню", callback_data="menu_main")]
        ]
        await query.edit_message_text("🌅 <b>Шаг 1: Выберите прием пищи:</b>", parse_mode="HTML", reply_markup=InlineKeyboardMarkup(keyboard))
        
    elif data == "back_to_meal":
        keyboard = [
            [InlineKeyboardButton("🌅 Завтрак", callback_data="meal_breakfast"),
             InlineKeyboardButton("☀️ Обед", callback_data="meal_lunch")],
            [InlineKeyboardButton("🌌 Ужин", callback_data="meal_dinner"),
             InlineKeyboardButton("🍎 Перекус", callback_data="meal_snack")],
            [InlineKeyboardButton("🏠 Главное меню", callback_data="menu_main")]
        ]
        await query.edit_message_text("🌅 <b>Шаг 1: Выберите прием пищи:</b>", parse_mode="HTML", reply_markup=InlineKeyboardMarkup(keyboard))
        
    elif data == "back_to_time":
        keyboard = [
            [InlineKeyboardButton("🕒 Сейчас", callback_data="time_now")],
            [InlineKeyboardButton("⏳ 30 мин назад", callback_data="time_30m"),
             InlineKeyboardButton("⏳ 1 час назад", callback_data="time_1h")],
            [InlineKeyboardButton("✏️ Ввести вручную", callback_data="time_manual")],
            [InlineKeyboardButton("⬅️ Назад", callback_data="back_to_meal"),
             InlineKeyboardButton("🏠 Главное меню", callback_data="menu_main")]
        ]
        await query.edit_message_text("🕒 <b>Шаг 2: Выберите время записи:</b>", parse_mode="HTML", reply_markup=InlineKeyboardMarkup(keyboard))
        
    elif data == "back_to_weight_choices":
        await ask_weight_step(query, context)
        
    elif data.startswith("meal_"):
        meal_type = data.replace("meal_", "")
        context.user_data['diary_flow']['meal_type'] = meal_type
        
        keyboard = [
            [InlineKeyboardButton("🕒 Сейчас", callback_data="time_now")],
            [InlineKeyboardButton("⏳ 30 мин назад", callback_data="time_30m"),
             InlineKeyboardButton("⏳ 1 час назад", callback_data="time_1h")],
            [InlineKeyboardButton("✏️ Ввести вручную", callback_data="time_manual")],
            [InlineKeyboardButton("⬅️ Назад", callback_data="back_to_meal"),
             InlineKeyboardButton("🏠 Главное меню", callback_data="menu_main")]
        ]
        await query.edit_message_text("🕒 <b>Шаг 2: Выберите время записи:</b>", parse_mode="HTML", reply_markup=InlineKeyboardMarkup(keyboard))
        
    elif data.startswith("time_"):
        time_type = data.replace("time_", "")
        
        if time_type == "now":
            context.user_data['diary_flow']['timestamp'] = int(datetime.now().timestamp())
            await ask_weight_step(query, context)
        elif time_type == "30m":
            context.user_data['diary_flow']['timestamp'] = int((datetime.now() - timedelta(minutes=30)).timestamp())
            await ask_weight_step(query, context)
        elif time_type == "1h":
            context.user_data['diary_flow']['timestamp'] = int((datetime.now() - timedelta(hours=1)).timestamp())
            await ask_weight_step(query, context)
        elif time_type == "manual":
            context.user_data['state'] = "AWAITING_TIME"
            keyboard = [
                [InlineKeyboardButton("⬅️ Назад", callback_data="back_to_time"),
                 InlineKeyboardButton("🏠 Главное меню", callback_data="menu_main")]
            ]
            await query.edit_message_text(
                "✏️ <b>Введите время приема пищи вручную:</b>\n"
                "Формат: <code>ЧЧ:ММ</code> (например, <code>14:30</code>):",
                parse_mode="HTML",
                reply_markup=InlineKeyboardMarkup(keyboard)
            )
            
    elif data.startswith("weight_"):
        weight_type = data.replace("weight_", "")
        last_analysis = context.user_data.get('last_analysis')
        
        if not last_analysis:
            await query.edit_message_text("⚠️ Ошибка: потеряны данные анализа еды. Попробуйте еще раз.")
            return
            
        if weight_type == "auto":
            grams = last_analysis["estimated_weight"]
        elif weight_type == "manual":
            context.user_data['state'] = "AWAITING_WEIGHT"
            keyboard = [
                [InlineKeyboardButton("⬅️ Назад", callback_data="back_to_weight_choices"),
                 InlineKeyboardButton("🏠 Главное меню", callback_data="menu_main")]
            ]
            await query.edit_message_text(
                "✏️ <b>Введите вес порции вручную:</b>\n"
                "Отправьте число грамм текстом (например, <code>180</code>):",
                parse_mode="HTML",
                reply_markup=InlineKeyboardMarkup(keyboard)
            )
            return
        else:
            try:
                grams = float(weight_type)
            except:
                grams = 200.0
                
        context.user_data['diary_flow']['grams'] = grams
        await save_and_confirm_entry(query, context)

async def ask_weight_step(query, context):
    last_analysis = context.user_data.get('last_analysis')
    est_weight = last_analysis.get("estimated_weight", 200)
    
    keyboard = [
        [InlineKeyboardButton(f"🤖 Авто-оценка ({est_weight:.0f}г)", callback_data="weight_auto")],
        [InlineKeyboardButton("⚖️ 100 г", callback_data="weight_100"),
         InlineKeyboardButton("⚖️ 150 г", callback_data="weight_150"),
         InlineKeyboardButton("⚖️ 200 г", callback_data="weight_200")],
        [InlineKeyboardButton("⚖️ 250 г", callback_data="weight_250"),
         InlineKeyboardButton("⚖️ 300 г", callback_data="weight_300"),
         InlineKeyboardButton("⚖️ 400 г", callback_data="weight_400")],
        [InlineKeyboardButton("✏️ Ввести вручную", callback_data="weight_manual")],
        [InlineKeyboardButton("⬅️ Назад", callback_data="back_to_time"),
         InlineKeyboardButton("🏠 Главное меню", callback_data="menu_main")]
    ]
    
    context.user_data['state'] = "AWAITING_WEIGHT"
    
    await query.edit_message_text(
        "⚖️ <b>Шаг 3: Укажите вес порции в граммах:</b>\n"
        "Выберите кнопку авто-оценки, стандартный вес или отправьте число грамм текстом.",
        parse_mode="HTML",
        reply_markup=InlineKeyboardMarkup(keyboard)
    )

async def save_and_confirm_entry(query_or_message, context, from_text_reply=False):
    user_id = query_or_message.from_user.id
    flow = context.user_data.get('diary_flow')
    last_analysis = context.user_data.get('last_analysis')
    
    if not flow or not last_analysis:
        msg_func = query_or_message.reply_html if from_text_reply else query_or_message.edit_message_text
        await msg_func("⚠️ Ошибка сохранения: данные сессии утеряны.")
        return
        
    grams = flow['grams']
    nut_100g = last_analysis['nutrition']
    
    # Calculate actual nutrition scaled by chosen weight
    factor = grams / 100.0
    actual_cal = nut_100g['calories'] * factor
    actual_prot = nut_100g['protein'] * factor
    actual_fat = nut_100g['fat'] * factor
    actual_carb = nut_100g['carbs'] * factor
    
    meal_names = {
        "breakfast": "🌅 Завтрак",
        "lunch": "☀️ Обед",
        "dinner": "🌌 Ужин",
        "snack": "🍎 Перекус"
    }
    meal_name_rus = meal_names.get(flow['meal_type'], flow['meal_type'])
    time_str = datetime.fromtimestamp(flow['timestamp']).strftime('%H:%M')
    
    # Save to SQLite DB
    save_diet_entry(
        user_id=user_id,
        meal_type=flow['meal_type'],
        timestamp=flow['timestamp'],
        food_name=last_analysis['name'],
        utility=last_analysis['verdict'],
        description=last_analysis.get('description', ''),
        calories=actual_cal,
        protein=actual_prot,
        fat=actual_fat,
        carbs=actual_carb,
        grams=grams,
        ingredients_json=json.dumps(last_analysis['ingredients'], ensure_ascii=False),
        health_score=last_analysis['health_score'],
        warning_type=last_analysis['warning_type']
    )
    
    # Send confirmation
    confirm_text = (
        "🎉 <b>Запись успешно добавлена в дневник!</b>\n\n"
        f"📅 Прием пищи: <b>{meal_name_rus}</b>\n"
        f"🕒 Время: <b>{time_str}</b>\n"
        f"⚖️ Вес порции: <b>{grams:.0f} г</b>\n"
        f"🍏 Продукт/Блюдо: <b>{last_analysis['name']}</b>\n"
        f"💯 Оценка пользы: <b>{last_analysis['health_score']}/100</b>\n\n"
        "📊 <b>Фактическая пищевая ценность порции:</b>\n"
        f"🔥 Калории: <b>{actual_cal:.1f} ккал</b>\n"
        f"🥩 Белки: <b>{actual_prot:.1f} г</b>\n"
        f"🥑 Жиры: <b>{actual_fat:.1f} г</b>\n"
        f"🍞 Углеводы: <b>{actual_carb:.1f} г</b>"
    )
    
    keyboard = [
        [InlineKeyboardButton("📝 Добавить запись", callback_data="menu_add_log")],
        [InlineKeyboardButton("🏠 Главное меню", callback_data="menu_main")]
    ]
    reply_markup = InlineKeyboardMarkup(keyboard)
    
    if from_text_reply:
        await query_or_message.reply_html(confirm_text, reply_markup=reply_markup)
    else:
        # Edit markup/text in query
        await query_or_message.edit_message_text(confirm_text, parse_mode="HTML", reply_markup=reply_markup)
        
    # Clear session values
    context.user_data['state'] = None
    context.user_data['last_analysis'] = None
    context.user_data['diary_flow'] = None

async def user_text_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    state = context.user_data.get('state')
    text = update.message.text.strip()
    
    if state == "AWAITING_API_KEY":
        # Validate / save key
        provider = "gemini"
        if text.startswith("sk-"):
            provider = "openai"
            
        set_user_api_key(user_id, text, provider)
        context.user_data['state'] = None
        await update.message.reply_html(
            f"✅ <b>API-ключ сохранен!</b>\n"
            f"Автоматически определен провайдер: <b>{provider.upper()}</b>."
        )
        return
        
    elif state == "AWAITING_TIME":
        # Check time format HH:MM
        if not re.match(r"^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$", text):
            await update.message.reply_html("⚠️ Неверный формат времени. Введите в формате ЧЧ:ММ (например, 14:30):")
            return
            
        h, m = map(int, text.split(":"))
        now = datetime.now()
        dt = now.replace(hour=h, minute=m, second=0, microsecond=0)
        context.user_data['diary_flow']['timestamp'] = int(dt.timestamp())
        
        # Trigger weight prompt
        last_analysis = context.user_data.get('last_analysis')
        est_weight = last_analysis.get("estimated_weight", 200)
        
        keyboard = [
            [InlineKeyboardButton(f"🤖 Авто-оценка ({est_weight:.0f}г)", callback_data="weight_auto")],
            [InlineKeyboardButton("⚖️ 100 г", callback_data="weight_100"),
             InlineKeyboardButton("⚖️ 150 г", callback_data="weight_150"),
             InlineKeyboardButton("⚖️ 200 г", callback_data="weight_200")],
            [InlineKeyboardButton("⚖️ 250 г", callback_data="weight_250"),
             InlineKeyboardButton("⚖️ 300 г", callback_data="weight_300")],
            [InlineKeyboardButton("⬅️ Назад", callback_data="back_to_time"),
             InlineKeyboardButton("🏠 Главное меню", callback_data="menu_main")]
        ]
        context.user_data['state'] = "AWAITING_WEIGHT"
        await update.message.reply_html(
            "⚖️ <b>Шаг 3: Укажите вес порции в граммах:</b>\n"
            "Выберите кнопку авто-оценки, стандартный вес или отправьте число грамм текстом.",
            reply_markup=InlineKeyboardMarkup(keyboard)
        )
        return
        
    elif state == "AWAITING_WEIGHT":
        try:
            grams = float(text)
            if grams <= 0:
                raise ValueError()
        except ValueError:
            await update.message.reply_html("⚠️ Пожалуйста, введите положительное число (вес в граммах):")
            return
            
        context.user_data['diary_flow']['grams'] = grams
        await save_and_confirm_entry(update.message, context, from_text_reply=True)
        return
        
    # Normal food text input
    await process_food_input(update, context, text=text)

async def user_media_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    # Detect if photo or voice
    photo_bytes = None
    voice_bytes = None
    
    if update.message.photo:
        await update.message.reply_chat_action("upload_photo")
        photo = update.message.photo[-1]
        photo_file = await context.bot.get_file(photo.file_id)
        out = io.BytesIO()
        await photo_file.download_to_memory(out)
        photo_bytes = out.getvalue()
        
    elif update.message.voice:
        await update.message.reply_chat_action("record_voice")
        voice = update.message.voice
        voice_file = await context.bot.get_file(voice.file_id)
        out = io.BytesIO()
        await voice_file.download_to_memory(out)
        voice_bytes = out.getvalue()
        
    else:
        await update.message.reply_html("⚠️ Неподдерживаемый тип сообщения. Пожалуйста, отправьте текст, фото или голосовое.")
        return
        
    await process_food_input(update, context, photo_bytes=photo_bytes, voice_bytes=voice_bytes)

async def process_food_input(update: Update, context: ContextTypes.DEFAULT_TYPE, text: str = None, 
                             photo_bytes: bytes = None, voice_bytes: bytes = None):
    user_id = update.effective_user.id
    
    # Retrieve user settings
    settings = get_user_settings(user_id)
    api_key = settings.get("api_key") if settings else None
    provider = settings.get("api_provider", "gemini") if settings else "gemini"
    
    # Fallback to system keys in .env
    if not api_key:
        system_gemini = os.environ.get("GEMINI_API_KEY")
        system_openai = os.environ.get("OPENAI_API_KEY")
        
        if system_gemini and system_gemini != "YOUR_GEMINI_API_KEY_HERE":
            api_key = system_gemini
            provider = "gemini"
        elif system_openai and system_openai != "YOUR_OPENAI_API_KEY_HERE":
            api_key = system_openai
            provider = "openai"
            
    if not api_key:
        await update.message.reply_html(
            "⚠️ <b>Для анализа питания необходим API-ключ!</b>\n\n"
            "Вы можете подключить собственный API-ключ в настройках бота.\n"
            "Введите команду /settings и нажмите <b>🔑 Установить API-ключ</b>."
        )
        return
        
    status_msg = await update.message.reply_html("⏳ <i>Анализирую данные с помощью ИИ...</i>")
    
    try:
        if provider == "openai":
            raw_data = await analyze_food_openai(api_key, text=text, photo_bytes=photo_bytes, voice_bytes=voice_bytes)
        else:
            raw_data = await analyze_food_gemini(api_key, text=text, photo_bytes=photo_bytes, voice_bytes=voice_bytes)
            
        validated_data = validate_food_data(raw_data)
        
        # Determine routing type
        input_type = validated_data.get("type", "food")
        
        # Save analysis context in session
        context.user_data['last_analysis'] = validated_data
        context.user_data['diary_flow'] = None
        context.user_data['state'] = None
        
        # Formatted response based on input type
        if input_type == "water":
            formatted_html = format_water_message_html(validated_data)
        elif input_type == "steps":
            formatted_html = format_steps_message_html(validated_data)
        else:
            formatted_html = format_food_message_html(validated_data)
        
        keyboard = [
            [InlineKeyboardButton("✅ Добавить в дневник", callback_data="action_add_diary"),
             InlineKeyboardButton("🔄 Сбросить", callback_data="action_reset")],
            [InlineKeyboardButton("🏠 Главное меню", callback_data="menu_main")]
        ]
        
        await status_msg.delete()
        await update.message.reply_html(formatted_html, reply_markup=InlineKeyboardMarkup(keyboard))
        
    except Exception as e:
        logger.error(f"Error processing food input: {e}")
        await status_msg.edit_text(
            f"❌ <b>Произошла ошибка при анализе ИИ</b>\n\n"
            f"Детали ошибки: <code>{str(e)}</code>\n"
            f"Попробуйте еще раз или проверьте корректность API-ключа в /settings.",
            parse_mode="HTML"
        )

# ----------------- MAIN INITIALIZATION -----------------

def main():
    token = os.environ.get("CALORIE_BOT_TOKEN") or os.environ.get("TELEGRAM_BOT_TOKEN")
    if not token or token in ["YOUR_TELEGRAM_BOT_TOKEN_HERE", "YOUR_CALORIE_BOT_TOKEN_HERE"]:
        logger.error("CALORIE_BOT_TOKEN or TELEGRAM_BOT_TOKEN is missing from .env.")
        sys.exit(1)
        
    # Build application
    application = Application.builder().token(token).build()
    
    # Handlers
    application.add_handler(CommandHandler("start", start_command))
    application.add_handler(CommandHandler("help", start_command))
    application.add_handler(CommandHandler("cancel", cancel_command))
    application.add_handler(CommandHandler("settings", settings_command))
    
    application.add_handler(CallbackQueryHandler(callback_handler))
    
    application.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, user_text_handler))
    application.add_handler(MessageHandler(filters.PHOTO | filters.VOICE, user_media_handler))
    
    # Start bot
    logger.info("Starting Calorie Diary Bot...")
    application.run_polling()

if __name__ == "__main__":
    main()
