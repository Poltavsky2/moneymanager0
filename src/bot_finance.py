import os
import sys
import json
import logging
import asyncio
import base64
import re
import csv
import html
from io import StringIO
from datetime import datetime

import httpx
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

from telegram import (
    Update, ReplyKeyboardMarkup, KeyboardButton,
    InlineKeyboardButton, InlineKeyboardMarkup, ReplyKeyboardRemove
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

# Add current dir to path to import database/firebase_db
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
import firebase_db

CURRENCY_SYMBOLS = {
    "RUB": "₽",
    "USD": "$",
    "EUR": "€",
    "KZT": "₸",
    "BYN": "Br",
    "UAH": "₴"
}

AI_QUESTIONS = {
    "ai_q_1": "Куда у меня уходят деньги?",
    "ai_q_2": "Почему у меня минус в этом месяце?",
    "ai_q_3": "Какие у меня плохие финансовые привычки?",
    "ai_q_4": "На что я трачу больше всего?",
    "ai_q_5": "Что можно сократить?"
}

CATEGORY_EMOJIS = {
    "еда": "🍔",
    "продукты": "🛒",
    "супермаркеты": "🛒",
    "транспорт": "🚗",
    "такси": "🚕",
    "авто": "🚗",
    "кафе и рестораны": "🍔",
    "кафе": "🍔",
    "рестораны": "🍕",
    "жилье и жкх": "🏠",
    "жилье": "🏠",
    "жкх": "🏠",
    "развлечения": "🎬",
    "кино": "🎬",
    "игры": "🎮",
    "хобби": "🎨",
    "здоровье": "💊",
    "аптека": "💊",
    "медицина": "🏥",
    "одежда": "👕",
    "обувь": "👟",
    "покупки": "🛍️",
    "шопинг": "🛍️",
    "красота": "💅",
    "салон": "💅",
    "косметика": "💄",
    "подарки": "🎁",
    "спорт": "🏋️‍♂️",
    "фитнес": "🏋️‍♂️",
    "путешествия": "✈️",
    "билеты": "🎫",
    "кредит": "💳",
    "долги": "💳",
    "зарплата": "💼",
    "подработка": "💰",
    "работа": "💼",
    "трансфер": "🔄",
    "инвестиции": "📈",
    "доход": "💸",
    "другое": "💸"
}

SYSTEM_PARSING_PROMPT = """You are a financial parser assistant.
Extract transaction details from user message (text, voice transcript, or image).
You must output a JSON object containing a "transactions" key with a LIST of transaction objects.
If the user mentions multiple distinct spending items (e.g., "такси 300, пельмени 200, кино 500"), you MUST create a separate transaction object for EACH item in the list.

Each transaction object in the "transactions" list must contain:
- amount: float (positive number)
- type: "expense" or "income"
- category: string (try to match to user's categories or suggest a logical one)
- description: string (short comment, e.g., "такси", "пельмени", "билет в кино")
- confidence: float (between 0.0 and 1.0)

User's categories:
Expenses: {expense_categories}
Income: {income_categories}

Return ONLY raw JSON with the "transactions" key."""

# ----------------- EMOJI HELPER -----------------

def get_category_emoji(category: str, tx_type: str = "expense") -> str:
    cat_lower = category.strip().lower()
    for key, emoji in CATEGORY_EMOJIS.items():
        if key in cat_lower or cat_lower in key:
            return emoji
    return "💰" if tx_type == "income" else "💸"

# ----------------- DB HELPERS -----------------

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

def get_user_data_by_id(user_id: int) -> dict:
    user_key = str(user_id)
    local_data = firebase_db.get_user_data(user_key, None)
    firebase_url = local_data.get("settings", {}).get("firebase_url", None) if local_data else None
    return firebase_db.init_user_if_needed(user_key, firebase_url)

def save_user_data_by_id(user_id: int, data: dict):
    user_key = str(user_id)
    data = recalculate_balances(data)
    firebase_url = data.get("settings", {}).get("firebase_url", None)
    firebase_db.save_user_data(user_key, data, firebase_url)

# ----------------- PARSING & AI HELPERS -----------------

def clean_and_parse_json(text: str) -> dict:
    clean_text = text.strip()
    if clean_text.startswith("```json"):
        clean_text = clean_text[7:]
    elif clean_text.startswith("```"):
        clean_text = clean_text[3:]
    if clean_text.endswith("```"):
        clean_text = clean_text[:-3]
    clean_text = clean_text.strip()
    
    start = clean_text.find('{')
    end = clean_text.rfind('}')
    if start != -1 and end != -1:
        clean_text = clean_text[start:end+1]
        
    return json.loads(clean_text, strict=False)

def format_amount(amount: float, currency: str = "RUB") -> str:
    symbol = CURRENCY_SYMBOLS.get(currency, currency)
    formatted = f"{amount:,.2f}"
    return f"{formatted} {symbol}"


def get_fallback_parse(text: str, categories: list) -> dict:
    cleaned_text = re.sub(r'(\d)\s+(\d)', r'\1\2', text)
    numbers = re.findall(r'\d+(?:\.\d+)?', cleaned_text)
    
    amount = 0.0
    if numbers:
        try:
            amount = float(numbers[0])
        except ValueError:
            pass
            
    tx_type = "expense"
    income_keywords = ["зарплата", "доход", "получил", "пришло", "плюс", "нашел", "подарок", "salary", "income"]
    for kw in income_keywords:
        if kw in text.lower():
            tx_type = "income"
            break
            
    detected_category = None
    for cat in categories:
        if cat.get("type") == tx_type:
            name = cat.get("name", "").lower()
            if name in text.lower() or text.lower() in name:
                detected_category = cat.get("name")
                break
                
    if not detected_category:
        detected_category = "Другое"
        
    description = text[:100]
    
    return {
        "transactions": [{
            "amount": amount,
            "type": tx_type,
            "category": detected_category,
            "description": description,
            "confidence": 0.5
        }]
    }

async def call_ai_api(prompt: str, api_key: str, system_instruction: str = None, mime_type: str = None, file_bytes: bytes = None, response_json: bool = False) -> str:
    """Call AI API with automatic retry on 429 Too Many Requests."""
    max_retries = 3
    base_delay = 5  # seconds
    is_openai = api_key.startswith("sk-")
    for attempt in range(max_retries + 1):
        try:
            if is_openai:
                url = "https://api.openai.com/v1/chat/completions"
                headers = {
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {api_key}"
                }
                messages = []
                if system_instruction:
                    messages.append({"role": "system", "content": system_instruction})
                if file_bytes and mime_type:
                    if mime_type.startswith("image/"):
                        base64_img = base64.b64encode(file_bytes).decode("utf-8")
                        messages.append({
                            "role": "user",
                            "content": [
                                {"type": "text", "text": prompt},
                                {"type": "image_url", "image_url": {"url": f"data:{mime_type};base64,{base64_img}"}}
                            ]
                        })
                    elif mime_type.startswith("audio/"):
                        whisper_url = "https://api.openai.com/v1/audio/transcriptions"
                        whisper_headers = {"Authorization": f"Bearer {api_key}"}
                        files = {"file": ("voice.ogg", file_bytes, mime_type)}
                        data = {"model": "whisper-1"}
                        async with httpx.AsyncClient() as client:
                            w_resp = await client.post(whisper_url, headers=whisper_headers, files=files, data=data, timeout=30.0)
                            w_resp.raise_for_status()
                            transcript = w_resp.json().get("text", "")
                        messages.append({"role": "user", "content": f"{prompt}\n\n[Транскрипт аудио]: {transcript}"})
                else:
                    messages.append({"role": "user", "content": prompt})
                payload = {
                    "model": "gpt-4o-mini",
                    "messages": messages
                }
                if response_json:
                    payload["response_format"] = {"type": "json_object"}
                async with httpx.AsyncClient() as client:
                    resp = await client.post(url, headers=headers, json=payload, timeout=30.0)
                    resp.raise_for_status()
                    return resp.json()["choices"][0]["message"]["content"]
            elif api_key.startswith("gsk_"):
                url = "https://api.groq.com/openai/v1/chat/completions"
                headers = {
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json"
                }
                messages = []
                if system_instruction:
                    messages.append({"role": "system", "content": system_instruction})
                
                model = "llama-3.3-70b-versatile"
                
                if file_bytes and mime_type:
                    if mime_type.startswith("image/"):
                        messages.append({"role": "user", "content": f"{prompt}\\n[Изображение пропущено: Groq отключили поддержку визуальных моделей]"})
                    elif mime_type.startswith("audio/"):
                        whisper_url = "https://api.groq.com/openai/v1/audio/transcriptions"
                        whisper_headers = {"Authorization": f"Bearer {api_key}"}
                        files = {"file": ("voice.ogg", file_bytes, mime_type)}
                        data = {"model": "whisper-large-v3"}
                        async with httpx.AsyncClient() as client:
                            w_resp = await client.post(whisper_url, headers=whisper_headers, files=files, data=data, timeout=30.0)
                            w_resp.raise_for_status()
                            transcript = w_resp.json().get("text", "")
                        messages.append({"role": "user", "content": f"{prompt}\n\n[Транскрипт аудио]: {transcript}"})
                else:
                    messages.append({"role": "user", "content": prompt})
                
                payload = {
                    "model": model,
                    "messages": messages
                }
                if response_json:
                    payload["response_format"] = {"type": "json_object"}
                async with httpx.AsyncClient() as client:
                    resp = await client.post(url, headers=headers, json=payload, timeout=30.0)
                    resp.raise_for_status()
                    return resp.json()["choices"][0]["message"]["content"]

            elif api_key.startswith("csk-"):
                url = "https://api.cerebras.ai/v1/chat/completions"
                headers = {
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json"
                }
                messages = []
                if system_instruction:
                    messages.append({"role": "system", "content": system_instruction})
                
                model = "llama3.1-70b"
                
                if file_bytes and mime_type:
                    if mime_type.startswith("image/"):
                        messages.append({"role": "user", "content": f"{prompt}\n[Изображение пропущено: Cerebras API пока не поддерживает анализ картинок]"})
                    elif mime_type.startswith("audio/"):
                        messages.append({"role": "user", "content": f"{prompt}\n[Голосовое сообщение пропущено: Cerebras API пока не поддерживает транскрибацию аудио]"})
                else:
                    messages.append({"role": "user", "content": prompt})
                
                payload = {
                    "model": model,
                    "messages": messages
                }
                if response_json:
                    payload["response_format"] = {"type": "json_object"}
                async with httpx.AsyncClient() as client:
                    resp = await client.post(url, headers=headers, json=payload, timeout=30.0)
                    resp.raise_for_status()
                    return resp.json()["choices"][0]["message"]["content"]
            else:
                if api_key.startswith("AQ"):
                    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key={api_key}"
                else:
                    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={api_key}"
                headers = {"Content-Type": "application/json"}
                parts = []
                if system_instruction:
                    parts.append({"text": f"SYSTEM INSTRUCTION: {system_instruction}\n\n"})
                parts.append({"text": prompt})
                if file_bytes and mime_type:
                    base64_data = base64.b64encode(file_bytes).decode("utf-8")
                    parts.append({
                        "inlineData": {
                            "mimeType": mime_type,
                            "data": base64_data
                        }
                    })
                payload = {
                    "contents": [{"parts": parts}]
                }
                if response_json:
                    payload["generationConfig"] = {
                        "responseMimeType": "application/json"
                    }
                async with httpx.AsyncClient() as client:
                    resp = await client.post(url, headers=headers, json=payload, timeout=60.0)
                    resp.raise_for_status()
                    return resp.json()["candidates"][0]["content"]["parts"][0]["text"]
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 429 and attempt < max_retries:
                delay = base_delay * (2 ** attempt)
                logger.warning(f"AI API rate limit (429). Retry {attempt + 1}/{max_retries} in {delay}s...")
                await asyncio.sleep(delay)
                continue
            raise
        except Exception:
            if attempt < max_retries:
                delay = base_delay * (2 ** attempt)
                logger.warning(f"AI API error. Retry {attempt + 1}/{max_retries} in {delay}s...")
                await asyncio.sleep(delay)
                continue
            raise
# ----------------- TELEGRAM BOT FLOW -----------------

async def send_main_menu(message, edit_query=None):
    text = (
        "🤖 <b>Главное меню финансового бота:</b>\n\n"
        "Выберите нужное действие ниже:"
    )
    keyboard = InlineKeyboardMarkup([
        [
            InlineKeyboardButton("➕ Добавить операцию", callback_data="menu_add"),
            InlineKeyboardButton("📜 Последние операции", callback_data="menu_recent")
        ],
        [
            InlineKeyboardButton("📊 Статистика", callback_data="menu_stats"),
            InlineKeyboardButton("🤖 AI-анализ", callback_data="menu_ai")
        ],
        [
            InlineKeyboardButton("🏷 Категории", callback_data="menu_categories"),
            InlineKeyboardButton("⚙️ Настройки", callback_data="menu_settings")
        ]
    ])
    
    if edit_query:
        await edit_query.edit_message_text(text, reply_markup=keyboard, parse_mode="HTML")
    else:
        await message.reply_text(text, reply_markup=keyboard, parse_mode="HTML")

async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    get_user_data_by_id(user_id)
    
    await send_main_menu(update.message)
    context.user_data.clear()

async def menu_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await send_main_menu(update.effective_message or update.message)

async def cancel_state_inline(query, context):
    queue = context.user_data.get("pending_tx_queue", [])
    if queue:
        next_tx = queue.pop(0)
        context.user_data["pending_tx_queue"] = queue
        context.user_data["pending_tx"] = next_tx
        context.user_data["pending_tx_current"] = context.user_data.get("pending_tx_current", 1) + 1
        await show_pending_tx_confirmation(query.message, context)
    else:
        context.user_data.clear()
        await send_main_menu(query.message, edit_query=query)

# ----------------- MESSAGE ROUTING -----------------

async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    text = update.message.text
    user_id = update.effective_user.id
    state = context.user_data.get("bot_state")
    
    if state == "WAITING_CUSTOM_AI_QUERY":
        query_str = text.strip()
        context.user_data.clear()
        
        user_data = get_user_data_by_id(user_id)
        settings = user_data.get("settings", {})
        ai_enabled = settings.get("ai_enabled", True)
        api_key = settings.get("api_key", os.environ.get("GEMINI_API_KEY") or os.environ.get("OPENAI_API_KEY") or "")
        
        keyboard = InlineKeyboardMarkup([
            [InlineKeyboardButton("🔍 Задать другой вопрос", callback_data="menu_ai")],
            [InlineKeyboardButton("◀️ Главное меню", callback_data="menu_main")]
        ])
        
        if not ai_enabled or not api_key:
            err_msg = "🤖 Для проведения AI-анализа включите AI и укажите API-ключ в Настройках ⚙️."
            await update.message.reply_text(err_msg, reply_markup=keyboard)
            return
            
        loading_msg = await update.message.reply_text("⏳ AI анализирует ваши расходы...")
        
        transactions = user_data.get("transactions", [])
        currency = settings.get("currency", "RUB")
        
        sorted_txs = sorted(transactions, key=lambda x: (x.get("date", ""), x.get("id", 0)), reverse=True)[:100]
        
        txs_formatted = []
        for tx in sorted_txs:
            comment = f", комментарий: {tx['description']}" if tx.get('description') else ""
            txs_formatted.append(f"- Дата: {tx['date']}, Тип: {'расход' if tx['type']=='expense' else 'доход'}, Категория: {tx['category']}, Сумма: {tx['amount']} {currency}{comment}")
            
        txs_input = "\n".join(txs_formatted) if txs_formatted else "Нет сохраненных транзакций."
        
        prompt = (
            f"На основе предоставленного списка транзакций пользователя, ответь на его практический вопрос: '{query_str}'.\n"
            "Дай развернутый, но емкий и лаконично структурированный отчет и практические рекомендации (объемом до 2500 символов) простыми словами на русском языке. "
            "Отвечай с практической точки зрения: проанализируй конкретные транзакции, укажи на неэффективные привычки, "
            "предложи конкретные шаги для оптимизации бюджета.\n\n"
            f"Валюта пользователя: {currency}\n"
            f"История транзакций:\n{txs_input}"
        )
        
        try:
            response_text = await call_ai_api(
                prompt=prompt,
                api_key=api_key,
                system_instruction="Ты экспертный финансовый советник, который дает детальный и практический отчет с рекомендациями клиенту на русском языке."
            )
        except Exception as e:
            logger.error(f"AI custom analysis request failed: {e}")
            if "429" in str(e):
                response_text = "⏳ AI-сервис временно перегружен (лимит запросов). Попробуйте повторить через 1-2 минуты."
            else:
                response_text = f"❌ Не удалось получить ответ от AI. Ошибка: {str(e)}"
            
        try:
            await loading_msg.delete()
        except Exception:
            pass
            
        formatted_response = format_ai_response(response_text)
        await send_formatted_ai_response(update.message, formatted_response, keyboard)
        return

    elif state == "WAITING_API_KEY":
        data = get_user_data_by_id(user_id)
        settings = data.get("settings", {})
        settings["api_key"] = text.strip()
        data["settings"] = settings
        save_user_data_by_id(user_id, data)
        context.user_data.clear()
        
        keyboard = InlineKeyboardMarkup([[InlineKeyboardButton("◀️ Главное меню", callback_data="menu_main")]])
        await update.message.reply_text("✅ API-ключ сохранен!", reply_markup=keyboard)
        return
        
    elif state == "WAITING_FIREBASE_URL":
        data = get_user_data_by_id(user_id)
        settings = data.get("settings", {})
        url = text.strip()
        keyboard = InlineKeyboardMarkup([[InlineKeyboardButton("◀️ Главное меню", callback_data="menu_main")]])
        if url.lower() == "default":
            settings["firebase_url"] = None
            await update.message.reply_text("✅ База данных сброшена на локальную SQLite.", reply_markup=keyboard)
        else:
            if not url.startswith("http://") and not url.startswith("https://"):
                await update.message.reply_text("❌ Некорректный URL. Должен начинаться с http:// или https://. Попробуйте еще раз:")
                return
            settings["firebase_url"] = url
            await update.message.reply_text(f"✅ Установлена база данных Firebase:\n{url}", reply_markup=keyboard)
        data["settings"] = settings
        save_user_data_by_id(user_id, data)
        context.user_data.clear()
        return
    elif state == "WAITING_NEW_CATEGORY_NAME":
        cat_type = context.user_data.get("new_cat_type")
        data = get_user_data_by_id(user_id)
        categories = data.get("categories", [])
        
        name = text.strip()
        if any(c.get("name", "").lower() == name.lower() and c.get("type") == cat_type for c in categories):
            await update.message.reply_text("❌ Категория с таким именем уже существует! Введите другое название:")
            return
            
        new_id = max([c.get("id", 0) for c in categories] + [0]) + 1
        categories.append({"id": new_id, "name": name, "type": cat_type})
        data["categories"] = categories
        save_user_data_by_id(user_id, data)
        context.user_data.clear()
        
        keyboard = InlineKeyboardMarkup([[InlineKeyboardButton("◀️ В Категории", callback_data="menu_categories")]])
        await update.message.reply_text(f"✅ Категория '{html.escape(name)}' успешно добавлена!", reply_markup=keyboard)
        return

    elif state == "WAITING_RENAME_CATEGORY_NAME":
        rename_cat = context.user_data.get("rename_cat")
        data = get_user_data_by_id(user_id)
        categories = data.get("categories", [])
        transactions = data.get("transactions", [])
        
        new_name = text.strip()
        old_name = rename_cat.get("name")
        cat_type = rename_cat.get("type")
        
        if any(c.get("name", "").lower() == new_name.lower() and c.get("type") == cat_type and c.get("id") != rename_cat["id"] for c in categories):
            await update.message.reply_text("❌ Категория с таким названием уже существует! Введите другое имя:")
            return
            
        for c in categories:
            if c.get("id") == rename_cat["id"]:
                c["name"] = new_name
                break
                
        updated_tx_count = 0
        for tx in transactions:
            if tx.get("category") == old_name and tx.get("type") == cat_type:
                tx["category"] = new_name
                updated_tx_count += 1
                
        data["categories"] = categories
        data["transactions"] = transactions
        save_user_data_by_id(user_id, data)
        context.user_data.clear()
        
        msg = f"✅ Категория переименована в '{html.escape(new_name)}'."
        if updated_tx_count > 0:
            msg += f"\n🔄 Обновлено операций: {updated_tx_count}"
        keyboard = InlineKeyboardMarkup([[InlineKeyboardButton("◀️ В Категории", callback_data="menu_categories")]])
        await update.message.reply_text(msg, reply_markup=keyboard)
        return

    elif state == "WAITING_NEW_CATEGORY_IN_CONFIRMATION":
        pending = context.user_data.get("pending_tx")
        if not pending:
            await update.message.reply_text("❌ Операция устарела. Начните заново из главного меню.")
            context.user_data.clear()
            return
            
        name = text.strip()
        user_data = get_user_data_by_id(user_id)
        categories = user_data.get("categories", [])
        
        cat_exists = any(c.get("name", "").lower() == name.lower() and c.get("type") == pending["type"] for c in categories)
        if not cat_exists:
            new_id = max([c.get("id", 0) for c in categories] + [0]) + 1
            categories.append({"id": new_id, "name": name, "type": pending["type"]})
            user_data["categories"] = categories
            save_user_data_by_id(user_id, user_data)
            
        pending["category"] = name
        context.user_data["pending_tx"] = pending
        context.user_data["bot_state"] = None
        await show_pending_tx_confirmation(update.message, context)
        return

    elif state == "WAITING_INITIAL_BALANCE":
        try:
            amount = float(text.replace(",", ".").replace(" ", ""))
            user_data = get_user_data_by_id(user_id)
            if amount != 0:
                tx_type = "income" if amount > 0 else "expense"
                tx_amount = abs(amount)
                tx = {
                    "id": int(datetime.now().timestamp() * 1000),
                    "type": tx_type,
                    "amount": tx_amount,
                    "category": "Начальный баланс",
                    "date": datetime.now().strftime("%Y-%m-%d"),
                    "note": "Стартовый баланс"
                }
                user_data["transactions"].append(tx)
                save_user_data_by_id(user_id, user_data)
            
            context.user_data["bot_state"] = "NORMAL"
            keyboard = InlineKeyboardMarkup([[InlineKeyboardButton("◀️ Главное меню", callback_data="menu_main")]])
            await update.message.reply_text(f"✅ Начальный баланс установлен: {amount}.\nБот готов к работе!", reply_markup=keyboard)
        except ValueError:
            await update.message.reply_text("❌ Пожалуйста, введите корректное число (например, 10000 или -5000):")
        return

    elif state == "WAITING_EDIT_AMOUNT":
        tx_index = context.user_data.get("edit_tx_index")
        data = get_user_data_by_id(user_id)
        transactions = data.get("transactions", [])
        
        sorted_txs = sorted(transactions, key=lambda x: (x.get("date", ""), x.get("id", 0)), reverse=True)
        if tx_index >= len(sorted_txs):
            await update.message.reply_text("❌ Операция не найдена. Попробуйте снова.")
            context.user_data.clear()
            return
            
        target_tx = sorted_txs[tx_index]
        try:
            amount = float(text.replace(" ", "").replace(",", "."))
            if amount <= 0:
                raise ValueError
        except ValueError:
            await update.message.reply_text("❌ Пожалуйста, введите положительное число. Попробуйте еще раз:")
            return
            
        for tx in transactions:
            if tx["id"] == target_tx["id"]:
                tx["amount"] = amount
                break
                
        save_user_data_by_id(user_id, data)
        context.user_data.clear()
        keyboard = InlineKeyboardMarkup([[InlineKeyboardButton("◀️ В Последние операции", callback_data="menu_recent")]])
        await update.message.reply_text(f"✅ Сумма успешно изменена на {format_amount(amount, data.get('settings', {}).get('currency', 'RUB'))}!", reply_markup=keyboard)
        return

    elif state == "WAITING_EDIT_AMOUNT_IN_CONFIRMATION":
        try:
            amount = float(text.replace(" ", "").replace(",", "."))
            if amount <= 0:
                raise ValueError
        except ValueError:
            await update.message.reply_text("❌ Неверный формат суммы. Пожалуйста, отправьте положительное число:")
            return
            
        pending = context.user_data.get("pending_tx")
        pending["amount"] = amount
        context.user_data["pending_tx"] = pending
        context.user_data["bot_state"] = None
        await show_pending_tx_confirmation(update.message, context)
        return

    elif state == "WAITING_SEARCH_QUERY":
        query_str = text.strip().lower()
        data = get_user_data_by_id(user_id)
        transactions = data.get("transactions", [])
        
        results = []
        for tx in transactions:
            cat = tx.get("category", "").lower()
            desc = tx.get("description", "").lower()
            amt = str(tx.get("amount", ""))
            date = tx.get("date", "")
            if query_str in cat or query_str in desc or query_str in amt or query_str in date:
                results.append(tx)
                
        context.user_data.clear()
        keyboard = InlineKeyboardMarkup([
            [InlineKeyboardButton("🔍 Искать снова", callback_data="rec_search")],
            [InlineKeyboardButton("◀️ В Последние операции", callback_data="menu_recent")]
        ])
        if not results:
            await update.message.reply_text("🔍 Ничего не найдено.", reply_markup=keyboard)
            return
            
        results.sort(key=lambda x: (x.get("date", ""), x.get("id", 0)), reverse=True)
        currency = data.get("settings", {}).get("currency", "RUB")
        
        response = f"🔍 Результаты поиска ({len(results)}):\n\n"
        for i, tx in enumerate(results[:20]):
            t_emoji = get_category_emoji(tx["category"], tx["type"])
            escaped_cat = html.escape(tx["category"])
            escaped_desc = html.escape(tx["description"]) if tx.get('description') else ""
            comment = f" ({escaped_desc})" if escaped_desc else ""
            response += f"{i+1}. {tx['date']} | {t_emoji} <b>{format_amount(tx['amount'], currency)}</b> | {escaped_cat}{comment}\n"
            
        if len(results) > 20:
            response += "\n_Показаны первые 20 результатов_"
            
        await update.message.reply_text(response, reply_markup=keyboard, parse_mode="HTML")
        return

    # Treat as new transaction attempt
    await process_transaction_input(update.message, context, input_text=text)

# ----------------- PARSE TRANSACTION INPUT -----------------

async def process_transaction_input(message, context, input_text=None, file_bytes=None, mime_type=None):
    user_id = message.from_user.id
    data = get_user_data_by_id(user_id)
    
    settings = data.get("settings", {})
    ai_enabled = settings.get("ai_enabled", True)
    api_key = settings.get("api_key", os.environ.get("GEMINI_API_KEY") or os.environ.get("OPENAI_API_KEY") or "")
    
    categories = data.get("categories", [])
    
    loading_msg = await message.reply_text("⏳ Обрабатываю...")
    
    parsed = None
    use_fallback = not ai_enabled or not api_key
    error_detail = None
    
    if not use_fallback:
        expense_cats = [c["name"] for c in categories if c["type"] == "expense"]
        income_cats = [c["name"] for c in categories if c["type"] == "income"]
        
        system_instruction = SYSTEM_PARSING_PROMPT.format(
            expense_categories=", ".join(expense_cats),
            income_categories=", ".join(income_cats)
        )
        
        prompt = "Распознай транзакцию из сообщения: "
        if input_text:
            prompt += f'"{input_text}"'
        else:
            prompt += "файла вложения."
            
        try:
            ai_response = await call_ai_api(
                prompt=prompt,
                api_key=api_key,
                system_instruction=system_instruction,
                mime_type=mime_type,
                file_bytes=file_bytes,
                response_json=True
            )
            parsed = clean_and_parse_json(ai_response)
        except Exception as e:
            logger.error(f"AI parse error: {e}")
            error_detail = str(e)
            use_fallback = True
            
    if use_fallback:
        if input_text:
            parsed = get_fallback_parse(input_text, categories)
        else:
            parsed = {
                "transactions": [{
                    "amount": 0.0,
                    "type": "expense",
                    "category": "Другое",
                    "description": "Голосовое/фото сообщение (AI не активен)",
                    "confidence": 0.0
                }]
            }
            
    if "transactions" in parsed and isinstance(parsed["transactions"], list):
        tx_list = parsed["transactions"]
    else:
        tx_list = [parsed]
        
    if not tx_list:
        tx_list = [{
            "amount": 0.0,
            "type": "expense",
            "category": "Другое",
            "description": "Ошибка парсинга",
            "confidence": 0.0
        }]
        
    for t in tx_list:
        try:
            t["amount"] = float(t.get("amount") or 0.0)
        except:
            t["amount"] = 0.0
            
        t["type"] = str(t.get("type") or "expense").strip().lower()
        if t["type"] not in ["income", "expense"]:
            t["type"] = "expense"
            
        t["category"] = str(t.get("category") or "Другое").strip()
        t["description"] = str(t.get("description") or "")
        t["date"] = datetime.now().strftime("%Y-%m-%d")
        
    context.user_data["pending_tx_queue"] = tx_list[1:]
    context.user_data["pending_tx_total"] = len(tx_list)
    context.user_data["pending_tx_current"] = 1
    context.user_data["pending_tx"] = tx_list[0]
    context.user_data["bot_state"] = None
    
    try:
        await loading_msg.delete()
    except Exception:
        pass
        
    warning = ""
    if use_fallback and ai_enabled and api_key:
        escaped_error = html.escape(error_detail or 'не удалось разобрать ответ')
        warning = f"⚠️ <i>Ошибка AI: {escaped_error}. Использован резервный автопарсинг.</i>\n\n"
    elif use_fallback:
        warning = "⚠️ <i>AI отключен или не настроен. Использован автоматический разбор по правилам.</i>\n\n"
        
    await show_pending_tx_confirmation(message, context, warning)

async def show_pending_tx_confirmation(message, context, prefix=""):
    pending = context.user_data.get("pending_tx")
    if not pending:
        return
        
    user_id = message.from_user.id
    data = get_user_data_by_id(user_id)
    currency = data.get("settings", {}).get("currency", "RUB")
    
    type_label = "🟢 Доход" if pending["type"] == "income" else "🔴 Расход"
    desc = pending.get("description") or "нет"
    t_emoji = get_category_emoji(pending["category"], pending["type"])
    
    escaped_category = html.escape(pending['category'])
    escaped_desc = html.escape(desc)
    
    total = context.user_data.get("pending_tx_total", 1)
    current = context.user_data.get("pending_tx_current", 1)
    
    header = f"{prefix}🔍 <b>Проверьте операцию перед сохранением:</b>"
    if total > 1:
        header = f"{prefix}🔍 <b>Операция {current} из {total} перед сохранением:</b>"
        
    text = (
        f"{header}\n\n"
        f"💵 <b>Сумма:</b> {format_amount(pending['amount'], currency)}\n"
        f"🏷 <b>Категория:</b> {t_emoji} {escaped_category} ({type_label})\n"
        f"📝 <b>Описание:</b> {escaped_desc}\n"
        f"📅 <b>Дата:</b> {pending['date']}\n\n"
        f"Подтвердите сохранение или отредактируйте параметры."
    )
    
    keyboard = InlineKeyboardMarkup([
        [
            InlineKeyboardButton("✔️ Сохранить", callback_data="tx_confirm"),
            InlineKeyboardButton("❌ Отменить", callback_data="tx_cancel")
        ],
        [
            InlineKeyboardButton("✏️ Сумму", callback_data="tx_edit_amt"),
            InlineKeyboardButton("✏️ Категорию", callback_data="tx_edit_cat")
        ]
    ])
    
    await message.reply_text(
        text,
        reply_markup=keyboard,
        parse_mode="HTML"
    )

# ----------------- VOICE & PHOTO HANDLERS -----------------

async def handle_voice(update: Update, context: ContextTypes.DEFAULT_TYPE):
    voice = update.message.voice
    file = await context.bot.get_file(voice.file_id)
    file_bytes = await file.download_as_bytearray()
    
    await process_transaction_input(
        update.message,
        context,
        file_bytes=bytes(file_bytes),
        mime_type="audio/ogg"
    )

# Content Type Photos
async def handle_photo(update: Update, context: ContextTypes.DEFAULT_TYPE):
    photo = update.message.photo[-1]
    file = await context.bot.get_file(photo.file_id)
    file_bytes = await file.download_as_bytearray()
    
    await process_transaction_input(
        update.message,
        context,
        file_bytes=bytes(file_bytes),
        mime_type="image/jpeg"
    )

# ----------------- CALLBACK QUERY PROCESSING -----------------

async def handle_callback_query(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    
    user_id = query.from_user.id
    data = query.data
    
    if data == "menu_main":
        await send_main_menu(query.message, edit_query=query)
        
    elif data == "menu_add":
        context.user_data["bot_state"] = "AWAITING_TRANSACTION_INPUT"
        keyboard = InlineKeyboardMarkup([[InlineKeyboardButton("❌ Отмена", callback_data="tx_cancel")]])
        await query.edit_message_text(
            "➕ Отправьте сообщение с операцией.\n"
            "Например: <b>'такси 300'</b> или отправьте <b>голосовое сообщение/фото чека</b>:",
            parse_mode="HTML",
            reply_markup=keyboard
        )
        
    elif data == "menu_recent":
        await show_recent_operations(query.message, context, edit_query=query)
        
    elif data == "menu_stats":
        await show_stats_for_period(query.message, user_id, 30, edit_query=query)

        
    elif data == "menu_ai":
        keyboard = InlineKeyboardMarkup([
            [InlineKeyboardButton("🔍 Куда уходят деньги?", callback_data="ai_ask:ai_q_1")],
            [InlineKeyboardButton("📉 Почему у меня минус в этом месяце?", callback_data="ai_ask:ai_q_2")],
            [InlineKeyboardButton("🚬 Плохие финансовые привычки?", callback_data="ai_ask:ai_q_3")],
            [InlineKeyboardButton("💰 На что я трачу больше всего?", callback_data="ai_ask:ai_q_4")],
            [InlineKeyboardButton("✂️ Что можно сократить?", callback_data="ai_ask:ai_q_5")],
            [InlineKeyboardButton("💬 Задать свой вопрос", callback_data="ai_custom_query")],
            [InlineKeyboardButton("◀️ Главное меню", callback_data="menu_main")]
        ])
        await query.edit_message_text("🤖 Выберите готовый вопрос или введите свой:", reply_markup=keyboard)
        
    elif data == "menu_categories":
        await show_categories_menu(query.message, context, edit_query=query)
        
    elif data == "menu_settings":
        await show_settings_menu(query.message, context, edit_query=query)
        
    elif data == "tx_confirm":
        pending = context.user_data.get("pending_tx")
        if not pending:
            await query.edit_message_text("❌ Операция устарела.")
            return
            
        user_data = get_user_data_by_id(user_id)
        categories = user_data.get("categories", [])
        transactions = user_data.get("transactions", [])
        
        cat_name = pending["category"].strip()
        cat_type = pending["type"]
        cat_exists = any(c.get("name", "").lower() == cat_name.lower() and c.get("type") == cat_type for c in categories)
        
        if not cat_exists:
            new_cat_id = max([c.get("id", 0) for c in categories] + [0]) + 1
            categories.append({"id": new_cat_id, "name": cat_name, "type": cat_type})
            user_data["categories"] = categories
            
        new_tx_id = max([t.get("id", 0) for t in transactions] + [0]) + 1
        new_tx = {
            "id": new_tx_id,
            "account_id": 1,
            "amount": pending["amount"],
            "type": pending["type"],
            "category": cat_name,
            "description": pending.get("description", ""),
            "date": pending["date"]
        }
        transactions.append(new_tx)
        user_data["transactions"] = transactions
        
        save_user_data_by_id(user_id, user_data)
        
        currency = user_data.get("settings", {}).get("currency", "RUB")
        t_emoji = get_category_emoji(pending["category"], pending["type"])
        escaped_cat_name = html.escape(pending["category"])
        added_text = (
            f"✅ <b>Успешно сохранено!</b>\n\n"
            f"💵 {format_amount(pending['amount'], currency)} | {t_emoji} {escaped_cat_name}\n"
        )
        if not cat_exists:
            added_text += f"🏷 <i>Новая категория '{escaped_cat_name}' добавлена автоматически.</i>"
            
        queue = context.user_data.get("pending_tx_queue", [])
        if queue:
            keyboard = InlineKeyboardMarkup([])
            await query.edit_message_text(added_text, reply_markup=keyboard, parse_mode="HTML")
            
            next_tx = queue.pop(0)
            context.user_data["pending_tx_queue"] = queue
            context.user_data["pending_tx"] = next_tx
            context.user_data["pending_tx_current"] = context.user_data.get("pending_tx_current", 1) + 1
            await show_pending_tx_confirmation(query.message, context)
        else:
            context.user_data.clear()
            keyboard = InlineKeyboardMarkup([[InlineKeyboardButton("◀️ Главное меню", callback_data="menu_main")]])
            await query.edit_message_text(added_text, reply_markup=keyboard, parse_mode="HTML")
        
    elif data == "tx_cancel":
        await cancel_state_inline(query, context)
        
    elif data == "tx_edit_amt":
        context.user_data["bot_state"] = "WAITING_EDIT_AMOUNT_IN_CONFIRMATION"
        await query.message.reply_text("Введите новую сумму для операции:")
        
    elif data == "tx_edit_cat":
        user_data = get_user_data_by_id(user_id)
        pending = context.user_data.get("pending_tx")
        if not pending:
            await query.edit_message_text("❌ Операция устарела.")
            return
            
        categories = user_data.get("categories", [])
        matching_cats = [c for c in categories if c.get("type") == pending["type"]]
        
        keyboard_buttons = []
        for cat in matching_cats:
            keyboard_buttons.append([InlineKeyboardButton(f"{get_category_emoji(cat['name'], cat['type'])} {cat['name']}", callback_data=f"tx_edit_cat_sel:{cat['name']}")])
            
        keyboard_buttons.append([InlineKeyboardButton("➕ Создать категорию", callback_data="tx_edit_cat_create")])
        keyboard_buttons.append([InlineKeyboardButton("◀️ Назад", callback_data="tx_edit_cat_cancel")])
            
        keyboard = InlineKeyboardMarkup(keyboard_buttons)
        await query.message.reply_text("Выберите категорию из списка:", reply_markup=keyboard)
        
    elif data == "tx_edit_cat_create":
        context.user_data["bot_state"] = "WAITING_NEW_CATEGORY_IN_CONFIRMATION"
        await query.message.reply_text("Введите название новой категории:")
        
    elif data == "tx_edit_cat_cancel":
        await show_pending_tx_confirmation(query.message, context)
        
    elif data.startswith("tx_edit_cat_sel:"):
        cat_name = data.split(":", 1)[1]
        pending = context.user_data.get("pending_tx")
        if pending:
            pending["category"] = cat_name
            context.user_data["pending_tx"] = pending
            await show_pending_tx_confirmation(query.message, context)
            
    # Settings callbacks
    elif data.startswith("set_curr:"):
        curr = data.split(":")[1]
        user_data = get_user_data_by_id(user_id)
        settings = user_data.get("settings", {})
        old_curr = settings.get("currency", "RUB")
        
        if curr == old_curr:
            await query.answer(f"У вас уже установлена валюта {curr}!", show_alert=True)
            return
            
        keyboard = InlineKeyboardMarkup([
            [InlineKeyboardButton("💱 Да, пересчитать по курсу", callback_data=f"convert_curr:{curr}:yes")],
            [InlineKeyboardButton("🔄 Нет, просто поменять значок", callback_data=f"convert_curr:{curr}:no")],
            [InlineKeyboardButton("❌ Отмена", callback_data="settings_menu")]
        ])
        
        await query.edit_message_text(
            f"Вы меняете базовую валюту с <b>{old_curr}</b> на <b>{curr}</b>.\n\n"
            f"Хотите ли вы автоматически конвертировать все ваши предыдущие операции и балансы по свежему курсу валют через Интернет?\n"
            f"<i>(При отказе, прошлые 1000 {old_curr} станут 1000 {curr})</i>",
            reply_markup=keyboard,
            parse_mode="HTML"
        )
        
    elif data.startswith("convert_curr:"):
        _, curr, do_convert = data.split(":")
        user_data = get_user_data_by_id(user_id)
        settings = user_data.get("settings", {})
        old_curr = settings.get("currency", "RUB")
        
        if do_convert == "yes":
            await query.edit_message_text("Получаю свежий курс валют... ⏳")
            try:
                async with httpx.AsyncClient() as client:
                    resp = await client.get(f"https://open.er-api.com/v6/latest/{old_curr}")
                    resp.raise_for_status()
                    rates = resp.json().get("rates", {})
                    rate = rates.get(curr)
                    
                    if not rate:
                        raise ValueError(f"Курс {curr} не найден")
                        
                accounts = user_data.get("accounts", [])
                for acc in accounts:
                    acc["balance"] = round(acc.get("balance", 0.0) * rate, 2)
                    
                transactions = user_data.get("transactions", [])
                for tx in transactions:
                    tx["amount"] = round(tx.get("amount", 0.0) * rate, 2)
                    
                settings["currency"] = curr
                user_data["settings"] = settings
                user_data["accounts"] = accounts
                user_data["transactions"] = transactions
                save_user_data_by_id(user_id, user_data)
                
                await query.answer(f"Успешно! 1 {old_curr} = {rate} {curr}", show_alert=True)
                await show_settings_menu(query.message, context, edit_query=query)
                
            except Exception as e:
                logger.error(f"Error fetching exchange rate: {e}")
                keyboard = InlineKeyboardMarkup([
                    [InlineKeyboardButton("🔙 Назад", callback_data="settings_menu")]
                ])
                await query.edit_message_text(
                    f"❌ Ошибка при загрузке курсов: {e}\n\nПопробуйте позже или выберите вариант 'Просто поменять значок'.",
                    reply_markup=keyboard
                )
        else:
            settings["currency"] = curr
            user_data["settings"] = settings
            save_user_data_by_id(user_id, user_data)
            await query.answer(f"Валюта изменена на {curr}")
            await show_settings_menu(query.message, context, edit_query=query)
        
    elif data == "toggle_ai":
        user_data = get_user_data_by_id(user_id)
        settings = user_data.get("settings", {})
        settings["ai_enabled"] = not settings.get("ai_enabled", True)
        user_data["settings"] = settings
        save_user_data_by_id(user_id, user_data)
        await show_settings_menu(query.message, context, edit_query=query)
        
    elif data == "set_key":
        context.user_data["bot_state"] = "WAITING_API_KEY"
        await query.message.reply_text("🔑 Отправьте ваш API-ключ (Gemini, OpenAI, Groq или Cerebras) следующим текстовым сообщением:")
        
    elif data == "export_backup":
        user_data = get_user_data_by_id(user_id)
        backup_json = json.dumps(user_data, ensure_ascii=False, indent=2)
        backup_bytes = backup_json.encode('utf-8')
        date_str = datetime.now().strftime("%Y-%m-%d_%H-%M")
        
        await context.bot.send_document(
            chat_id=user_id,
            document=backup_bytes,
            filename=f"finance_backup_{date_str}.json",
            caption="📥 Вот полная резервная копия ваших данных.\nЕсли вы хотите восстановить данные, просто перешлите этот файл мне обратно!"
        )
        await query.answer("Бэкап успешно отправлен!")
        return
        
    elif data.startswith("restore_backup:"):
        choice = data.split(":")[1]
        if choice == "yes":
            pending = context.user_data.get("pending_backup")
            if pending:
                save_user_data_by_id(user_id, pending)
                context.user_data.pop("pending_backup", None)
                await query.edit_message_text("✅ Данные успешно загружены! Используйте /menu для просмотра.")
            else:
                await query.edit_message_text("❌ Файл устарел или сессия истекла. Отправьте файл заново.")
        else:
            context.user_data.pop("pending_backup", None)
            await query.edit_message_text("❌ Восстановление отменено.")
        
    elif data == "reset_confirm":
        keyboard = InlineKeyboardMarkup([
            [InlineKeyboardButton("⚠️ Да, стереть всё", callback_data="reset_yes")],
            [InlineKeyboardButton("❌ Отмена", callback_data="reset_no")]
        ])
        await query.edit_message_text(
            "🛑 <b>Внимание!</b> Вы собираетесь сбросить все ваши финансовые транзакции и вернуть настройки к стандартным. Это действие необратимо!\nВы уверены?",
            reply_markup=keyboard,
            parse_mode="HTML"
        )
        
    elif data == "reset_yes":
        user_data = get_user_data_by_id(user_id)
        user_data["transactions"] = []
        user_data["assets"] = []
        user_data["categories"] = firebase_db.DEFAULT_CATEGORIES
        user_data["accounts"] = firebase_db.DEFAULT_ACCOUNTS
        user_data["settings"] = {"currency": "RUB", "ai_enabled": True, "api_key": ""}
        save_user_data_by_id(user_id, user_data)
        
        context.user_data["bot_state"] = "WAITING_INITIAL_BALANCE"
        await query.edit_message_text("🗑 Все ваши данные стерты.\n\nПожалуйста, введите ваш начальный баланс (например, 0, 10000 или -5000):")
        
    elif data == "reset_no":
        await show_settings_menu(query.message, context, edit_query=query)
        
    elif data == "export_csv":
        await export_data_csv(query.message, user_id)
        
    # Stats callbacks
    elif data.startswith("stats_days:"):
        days = int(data.split(":")[1])
        await show_stats_for_period(query.message, user_id, days, edit_query=query)
        
    elif data.startswith("stats_day_det:"):
        _, date_str, prev_days = data.split(":")
        prev_days = int(prev_days)
        await show_stats_day_details(query.message, user_id, date_str, prev_days, edit_query=query)
        
    # AI analysis callbacks
    elif data.startswith("ai_ask:"):
        q_key = data.split(":")[1]
        await process_ai_analysis_question(query.message, user_id, q_key, edit_query=query)
        
    elif data == "ai_custom_query":
        context.user_data["bot_state"] = "WAITING_CUSTOM_AI_QUERY"
        keyboard = InlineKeyboardMarkup([[InlineKeyboardButton("❌ Отмена", callback_data="menu_ai")]])
        await query.edit_message_text(
            "💬 <b>Введите ваш запрос для AI-анализа трат:</b>\n\n"
            "Например: <i>'Проверь, сколько я потратил на такси на этой неделе, и дай совет'</i> или "
            "<i>'Стоит ли мне сократить расходы на рестораны?'</i>",
            parse_mode="HTML",
            reply_markup=keyboard
        )
        
    # Recent Ops callbacks
    elif data == "rec_del_last":
        user_data = get_user_data_by_id(user_id)
        transactions = user_data.get("transactions", [])
        if not transactions:
            await query.edit_message_text("❌ Нет операций для удаления.")
            return
            
        sorted_txs = sorted(transactions, key=lambda x: (x.get("date", ""), x.get("id", 0)))
        deleted_tx = sorted_txs.pop()
        
        user_data["transactions"] = [t for t in transactions if t["id"] != deleted_tx["id"]]
        save_user_data_by_id(user_id, user_data)
        
        currency = user_data.get("settings", {}).get("currency", "RUB")
        t_emoji = get_category_emoji(deleted_tx['category'], deleted_tx['type'])
        escaped_cat = html.escape(deleted_tx['category'])
        
        keyboard = InlineKeyboardMarkup([[InlineKeyboardButton("◀️ В Последние операции", callback_data="menu_recent")]])
        await query.edit_message_text(f"🗑 Удалена операция:\n{deleted_tx['date']} | {t_emoji} <b>{format_amount(deleted_tx['amount'], currency)}</b> | {escaped_cat}", reply_markup=keyboard, parse_mode="HTML")
        
    elif data == "rec_edit":
        user_data = get_user_data_by_id(user_id)
        transactions = user_data.get("transactions", [])
        if not transactions:
            await query.edit_message_text("❌ Нет операций для редактирования.")
            return
            
        sorted_txs = sorted(transactions, key=lambda x: (x.get("date", ""), x.get("id", 0)), reverse=True)[:10]
        buttons = []
        for i, tx in enumerate(sorted_txs):
            t_emoji = get_category_emoji(tx["category"], tx["type"])
            buttons.append([InlineKeyboardButton(f"{i+1}. {t_emoji} {tx['category']} ({tx['amount']})", callback_data=f"rec_edit_sel:{i}")])
        buttons.append([InlineKeyboardButton("◀️ Назад", callback_data="menu_recent")])
        
        keyboard = InlineKeyboardMarkup(buttons)
        await query.edit_message_text("Выберите операцию для изменения:", reply_markup=keyboard)
        
    elif data.startswith("rec_edit_sel:"):
        idx = int(data.split(":")[1])
        buttons = InlineKeyboardMarkup([
            [
                InlineKeyboardButton("💵 Изменить сумму", callback_data=f"rec_edit_field:{idx}:amount"),
                InlineKeyboardButton("🏷 Изменить категорию", callback_data=f"rec_edit_field:{idx}:category")
            ],
            [InlineKeyboardButton("◀️ Отмена", callback_data="menu_recent")]
        ])
        await query.edit_message_text("Что вы хотите изменить?", reply_markup=buttons)
        
    elif data.startswith("rec_edit_field:"):
        _, idx, field = data.split(":")
        idx = int(idx)
        
        if field == "amount":
            context.user_data["edit_tx_index"] = idx
            context.user_data["bot_state"] = "WAITING_EDIT_AMOUNT"
            await query.message.reply_text("Введите новое значение суммы (число):")
        elif field == "category":
            user_data = get_user_data_by_id(user_id)
            transactions = user_data.get("transactions", [])
            sorted_txs = sorted(transactions, key=lambda x: (x.get("date", ""), x.get("id", 0)), reverse=True)
            target_tx = sorted_txs[idx]
            
            categories = user_data.get("categories", [])
            matching_cats = [c for c in categories if c.get("type") == target_tx["type"]]
            
            buttons = []
            for cat in matching_cats:
                buttons.append([InlineKeyboardButton(f"{get_category_emoji(cat['name'], cat['type'])} {cat['name']}", callback_data=f"rec_edit_cat:{idx}:{cat['name']}")])
            buttons.append([InlineKeyboardButton("◀️ Назад", callback_data="menu_recent")])
            keyboard = InlineKeyboardMarkup(buttons)
            await query.edit_message_text("Выберите новую категорию:", reply_markup=keyboard)
            
    elif data.startswith("rec_edit_cat:"):
        _, idx, cat_name = data.split(":")
        idx = int(idx)
        user_data = get_user_data_by_id(user_id)
        transactions = user_data.get("transactions", [])
        
        sorted_txs = sorted(transactions, key=lambda x: (x.get("date", ""), x.get("id", 0)), reverse=True)
        target_tx = sorted_txs[idx]
        
        for tx in transactions:
            if tx["id"] == target_tx["id"]:
                tx["category"] = cat_name
                break
                
        save_user_data_by_id(user_id, user_data)
        
        keyboard = InlineKeyboardMarkup([[InlineKeyboardButton("◀️ В Последние операции", callback_data="menu_recent")]])
        await query.edit_message_text(f"✅ Категория успешно изменена на '{cat_name}'!", reply_markup=keyboard)
        
    elif data == "rec_search":
        context.user_data["bot_state"] = "WAITING_SEARCH_QUERY"
        await query.message.reply_text("🔍 Введите текст для поиска (категорию, описание, дату или сумму):")

    # Categories callbacks
    elif data == "cat_menu":
        await show_categories_menu(query.message, context, edit_query=query)
        
    elif data == "cat_list":
        user_data = get_user_data_by_id(user_id)
        categories = user_data.get("categories", [])
        
        exp_list = "\n".join([f"• {get_category_emoji(c['name'], 'expense')} {html.escape(c['name'])}" for c in categories if c["type"] == "expense"])
        inc_list = "\n".join([f"• {get_category_emoji(c['name'], 'income')} {html.escape(c['name'])}" for c in categories if c["type"] == "income"])
        
        text = (
            "🏷 <b>Список ваших категорий:</b>\n\n"
            "🔴 <b>Расходы:</b>\n"
            f"{exp_list or 'Нет категорий'}\n\n"
            "🟢 <b>Доходы:</b>\n"
            f"{inc_list or 'Нет категорий'}"
        )
        keyboard = InlineKeyboardMarkup([[InlineKeyboardButton("◀️ Назад", callback_data="cat_menu")]])
        await query.edit_message_text(text, reply_markup=keyboard, parse_mode="HTML")
        
    elif data == "cat_add_btn":
        keyboard = InlineKeyboardMarkup([
            [
                InlineKeyboardButton("🔴 Расходная", callback_data="cat_add_type:expense"),
                InlineKeyboardButton("🟢 Доходная", callback_data="cat_add_type:income")
            ],
            [InlineKeyboardButton("◀️ Назад", callback_data="cat_menu")]
        ])
        await query.edit_message_text("Выберите тип создаваемой категории:", reply_markup=keyboard)
        
    elif data.startswith("cat_add_type:"):
        c_type = data.split(":")[1]
        context.user_data["new_cat_type"] = c_type
        context.user_data["bot_state"] = "WAITING_NEW_CATEGORY_NAME"
        t_label = "расходной" if c_type == "expense" else "доходной"
        await query.message.reply_text(f"Введите название новой {t_label} категории:")
        
    elif data == "cat_del_btn":
        user_data = get_user_data_by_id(user_id)
        categories = user_data.get("categories", [])
        
        buttons = []
        for cat in categories:
            t_label = "🔴" if cat["type"] == "expense" else "🟢"
            buttons.append([InlineKeyboardButton(f"{t_label} {get_category_emoji(cat['name'], cat['type'])} {cat['name']}", callback_data=f"cat_del_sel:{cat['id']}")])
        buttons.append([InlineKeyboardButton("◀️ Назад", callback_data="cat_menu")])
        
        await query.edit_message_text("Выберите категорию для удаления:", reply_markup=InlineKeyboardMarkup(buttons))
        
    elif data.startswith("cat_del_sel:"):
        cat_id = int(data.split(":")[1])
        user_data = get_user_data_by_id(user_id)
        categories = user_data.get("categories", [])
        transactions = user_data.get("transactions", [])
        
        target_cat = next((c for c in categories if c["id"] == cat_id), None)
        if not target_cat:
            await query.edit_message_text("❌ Категория не найдена.")
            return
            
        cat_name = target_cat["name"]
        cat_type = target_cat["type"]
        
        if cat_name == "Другое":
            await query.edit_message_text("❌ Категорию 'Другое' удалить нельзя.", reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("◀️ Назад", callback_data="cat_menu")]]))
            return
            
        updated_count = 0
        for tx in transactions:
            if tx.get("category") == cat_name and tx.get("type") == cat_type:
                tx["category"] = "Другое"
                updated_count += 1
                
        user_data["categories"] = [c for c in categories if c["id"] != cat_id]
        user_data["transactions"] = transactions
        save_user_data_by_id(user_id, user_data)
        
        msg = f"🗑 Категория '{html.escape(cat_name)}' удалена."
        if updated_count > 0:
            msg += f"\n🔄 {updated_count} операций перенесено в категорию 'Другое'."
        await query.edit_message_text(msg, reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("◀️ Назад", callback_data="cat_menu")]]))
        
    elif data == "cat_rename_btn":
        user_data = get_user_data_by_id(user_id)
        categories = user_data.get("categories", [])
        
        buttons = []
        for cat in categories:
            t_label = "🔴" if cat["type"] == "expense" else "🟢"
            buttons.append([InlineKeyboardButton(f"{t_label} {get_category_emoji(cat['name'], cat['type'])} {cat['name']}", callback_data=f"cat_rename_sel:{cat['id']}")])
        buttons.append([InlineKeyboardButton("◀️ Назад", callback_data="cat_menu")])
        
        await query.edit_message_text("Выберите категорию для переименования:", reply_markup=InlineKeyboardMarkup(buttons))
        
    elif data.startswith("cat_rename_sel:"):
        cat_id = int(data.split(":")[1])
        user_data = get_user_data_by_id(user_id)
        categories = user_data.get("categories", [])
        
        target_cat = next((c for c in categories if c["id"] == cat_id), None)
        if not target_cat:
            await query.edit_message_text("❌ Категория не найдена.")
            return
            
        context.user_data["rename_cat"] = target_cat
        context.user_data["bot_state"] = "WAITING_RENAME_CATEGORY_NAME"
        await query.message.reply_text(f"Введите новое название для категории '{target_cat['name']}':")

# ----------------- RENDER SUBMENUS -----------------

async def show_settings_menu(message, context, edit_query=None):
    user_id = message.chat_id if edit_query else message.from_user.id
    user_data = get_user_data_by_id(user_id)
    settings = user_data.get("settings", {})
    
    currency = settings.get("currency", "RUB")
    ai_status = "🟢 Включен" if settings.get("ai_enabled", True) else "🔴 Выключен"
    api_key_masked = "•" * 8 if settings.get("api_key") else "не настроен ❌"
    text = (
        "⚙️ <b>Настройки профиля:</b>\n\n"
        f"💱 <b>Валюта:</b> {currency}\n"
        f"🤖 <b>AI-анализ:</b> {ai_status}\n"
        f"🔑 <b>API-ключ:</b> <code>{api_key_masked}</code>\n"
        f"🛡️ <b>Бэкап:</b> Вручную через Telegram"
    )
    
    keyboard = InlineKeyboardMarkup([
        [
            InlineKeyboardButton("USD", callback_data="set_curr:USD"),
            InlineKeyboardButton("EUR", callback_data="set_curr:EUR"),
            InlineKeyboardButton("RUB", callback_data="set_curr:RUB")
        ],
        [
            InlineKeyboardButton("AI-анализ: Вкл/Выкл", callback_data="toggle_ai"),
            InlineKeyboardButton("🔑 Ввести ключ", callback_data="set_key")
        ],
        [
            InlineKeyboardButton("📥 Сделать бэкап", callback_data="export_backup"),
            InlineKeyboardButton("📊 Экспорт в CSV", callback_data="export_csv")
        ],
        [
            InlineKeyboardButton("⚠️ Сбросить все данные", callback_data="reset_confirm")
        ],
        [
            InlineKeyboardButton("◀️ Главное меню", callback_data="menu_main")
        ]
    ])
    
    if edit_query:
        await edit_query.edit_message_text(text, reply_markup=keyboard, parse_mode="HTML")
    else:
        await message.reply_text(text, reply_markup=keyboard, parse_mode="HTML")

async def show_categories_menu(message, context, edit_query=None):
    text = (
        "🏷 <b>Управление категориями:</b>\n\n"
        "Вы можете посмотреть список всех категорий, "
        "добавить новые вручную, переименовать или удалить существующие."
    )
    keyboard = InlineKeyboardMarkup([
        [
            InlineKeyboardButton("📋 Список категорий", callback_data="cat_list"),
            InlineKeyboardButton("➕ Создать", callback_data="cat_add_btn")
        ],
        [
            InlineKeyboardButton("✏️ Переименовать", callback_data="cat_rename_btn"),
            InlineKeyboardButton("❌ Удалить", callback_data="cat_del_btn")
        ],
        [
            InlineKeyboardButton("◀️ Главное меню", callback_data="menu_main")
        ]
    ])
    
    if edit_query:
        await edit_query.edit_message_text(text, reply_markup=keyboard, parse_mode="HTML")
    else:
        await message.reply_text(text, reply_markup=keyboard, parse_mode="HTML")

async def show_recent_operations(message, context, edit_query=None):
    user_id = message.chat_id if edit_query else message.from_user.id
    user_data = get_user_data_by_id(user_id)
    transactions = user_data.get("transactions", [])
    
    if not transactions:
        text = "📜 У вас пока нет сохраненных операций."
        keyboard = InlineKeyboardMarkup([[InlineKeyboardButton("◀️ Главное меню", callback_data="menu_main")]])
        if edit_query:
            await edit_query.edit_message_text(text, reply_markup=keyboard)
        else:
            await message.reply_text(text, reply_markup=keyboard)
        return
        
    sorted_txs = sorted(transactions, key=lambda x: (x.get("date", ""), x.get("id", 0)), reverse=True)[:10]
    currency = user_data.get("settings", {}).get("currency", "RUB")
    
    text = "📜 <b>Последние 10 операций:</b>\n\n"
    for i, tx in enumerate(sorted_txs):
        t_emoji = get_category_emoji(tx["category"], tx["type"])
        escaped_cat = html.escape(tx["category"])
        escaped_desc = html.escape(tx["description"]) if tx.get('description') else ""
        comment = f" ({escaped_desc})" if escaped_desc else ""
        text += f"{i+1}. {tx['date']} | {t_emoji} <b>{format_amount(tx['amount'], currency)}</b> | {escaped_cat}{comment}\n"
        
    keyboard = InlineKeyboardMarkup([
        [
            InlineKeyboardButton("❌ Удалить последнюю", callback_data="rec_del_last"),
            InlineKeyboardButton("✏️ Редактировать", callback_data="rec_edit")
        ],
        [
            InlineKeyboardButton("🔍 Поиск по операциям", callback_data="rec_search")
        ],
        [
            InlineKeyboardButton("◀️ Главное меню", callback_data="menu_main")
        ]
    ])
    
    if edit_query:
        await edit_query.edit_message_text(text, reply_markup=keyboard, parse_mode="HTML")
    else:
        await message.reply_text(text, reply_markup=keyboard, parse_mode="HTML")

# ----------------- STATISTICS GENERATION -----------------

async def show_stats_for_period(message, user_id, days, edit_query=None):
    user_data = get_user_data_by_id(user_id)
    transactions = user_data.get("transactions", [])
    currency = user_data.get("settings", {}).get("currency", "RUB")
    
    today = datetime.now().date()
    period_txs = []
    
    for tx in transactions:
        try:
            tx_date = datetime.strptime(tx["date"], "%Y-%m-%d").date()
        except ValueError:
            tx_date = today
            
        if 0 <= (today - tx_date).days < days:
            period_txs.append(tx)
            
    # Period title
    if days == 365:
        period_title = "1 год"
    elif days == 7:
        period_title = "7 дней"
    elif days == 90:
        period_title = "90 дней"
    else:
        period_title = "30 дней"
        
    keyboard_buttons = []
    period_row1 = []
    for p_days, label in [(7, "7 дней"), (30, "30 дней"), (90, "90 дней")]:
        if p_days == days:
            period_row1.append(InlineKeyboardButton(f"🟢 {label}", callback_data=f"stats_days:{p_days}"))
        else:
            period_row1.append(InlineKeyboardButton(label, callback_data=f"stats_days:{p_days}"))
    period_row2 = []
    for p_days, label in [(180, "180 дней"), (365, "1 год")]:
        if p_days == days:
            period_row2.append(InlineKeyboardButton(f"🟢 {label}", callback_data=f"stats_days:{p_days}"))
        else:
            period_row2.append(InlineKeyboardButton(label, callback_data=f"stats_days:{p_days}"))
    keyboard_buttons.append(period_row1)
    keyboard_buttons.append(period_row2)
    
    keyboard_buttons.append([InlineKeyboardButton("◀️ Главное меню", callback_data="menu_main")])
    keyboard = InlineKeyboardMarkup(keyboard_buttons)
    
    if not period_txs:
        period_label = "1 год" if days == 365 else f"{days} дней"
        no_data_text = f"📅 За последние {period_label} нет сохраненных операций."
        if edit_query:
            await edit_query.edit_message_text(no_data_text, reply_markup=keyboard)
        else:
            await message.reply_text(no_data_text, reply_markup=keyboard)
        return
        
    # We have transactions, let's pop the last "◀️ Главное меню" button to build the keyboard properly
    keyboard_buttons.pop()
    
    total_expenses = sum(t["amount"] for t in period_txs if t["type"] == "expense")
    total_income = sum(t["amount"] for t in period_txs if t["type"] == "income")
    balance = total_income - total_expenses
    
    dates = [datetime.strptime(t["date"], "%Y-%m-%d").date() for t in period_txs if "date" in t]
    if dates:
        min_date = min(dates)
        actual_days = max(1, (today - min_date).days + 1)
        days_to_divide = min(days, actual_days)
    else:
        days_to_divide = days
        
    avg_daily = total_expenses / days_to_divide if days_to_divide > 0 else 0.0
    
    daily_expenses = {}
    for t in period_txs:
        if t["type"] == "expense":
            dt = t["date"]
            daily_expenses[dt] = daily_expenses.get(dt, 0.0) + t["amount"]
            
    if daily_expenses:
        most_expensive_dt = max(daily_expenses, key=daily_expenses.get)
        most_expensive_amt = daily_expenses[most_expensive_dt]
        try:
            parsed_dt = datetime.strptime(most_expensive_dt, "%Y-%m-%d")
            formatted_dt = parsed_dt.strftime("%d.%m.%Y")
        except Exception:
            formatted_dt = most_expensive_dt
        most_expensive_day = f"{formatted_dt} ({format_amount(most_expensive_amt, currency)})"
        
        # Add button to view most expensive day details
        keyboard_buttons.append([
            InlineKeyboardButton(f"🔥 Детали дня: {formatted_dt}", callback_data=f"stats_day_det:{most_expensive_dt}:{days}")
        ])
    else:
        most_expensive_day = "нет расходов"
        
    keyboard_buttons.append([InlineKeyboardButton("◀️ Главное меню", callback_data="menu_main")])
    keyboard = InlineKeyboardMarkup(keyboard_buttons)
    
    # Group Expenses by Category
    cat_expenses = {}
    for t in period_txs:
        if t["type"] == "expense":
            cat = t["category"]
            cat_expenses[cat] = cat_expenses.get(cat, 0.0) + t["amount"]
            
    sorted_cats = sorted(cat_expenses.items(), key=lambda x: x[1], reverse=True)
    
    top_cats_text = ""
    for cat, amt in sorted_cats:
        percentage = (amt / total_expenses * 100) if total_expenses > 0 else 0
        t_emoji = get_category_emoji(cat, "expense")
        escaped_cat = html.escape(cat)
        top_cats_text += f"• {t_emoji} {escaped_cat}: {format_amount(amt, currency)} ({percentage:.1f}%)\n"
        
    # Group Income by Category
    cat_income = {}
    for t in period_txs:
        if t["type"] == "income":
            cat = t["category"]
            cat_income[cat] = cat_income.get(cat, 0.0) + t["amount"]
            
    sorted_inc = sorted(cat_income.items(), key=lambda x: x[1], reverse=True)
    
    inc_cats_text = ""
    for cat, amt in sorted_inc:
        percentage = (amt / total_income * 100) if total_income > 0 else 0
        t_emoji = get_category_emoji(cat, "income")
        escaped_cat = html.escape(cat)
        inc_cats_text += f"• {t_emoji} {escaped_cat}: {format_amount(amt, currency)} ({percentage:.1f}%)\n"
        
    no_expenses_str = "• Нет расходов\n"
    no_income_str = "• Нет доходов\n"
    text = (
        f"📊 <b>Статистика за {period_title}</b>\n\n"
        f"💳 <b>Общий баланс:</b> {format_amount(balance, currency)}\n\n"
        f"💸 <b>Расходы по категориям:</b>\n"
        f"{top_cats_text or no_expenses_str}\n"
        f"<b>Всего расходов:</b> {format_amount(total_expenses, currency)}\n"
        f"<b>Средний расход в день:</b> {format_amount(avg_daily, currency)}\n"
        f"<b>Самый дорогой день:</b> {most_expensive_day}\n\n"
        f"💰 <b>Доходы по категориям:</b>\n"
        f"{inc_cats_text or no_income_str}\n"
        f"<b>Всего доходов:</b> {format_amount(total_income, currency)}"
    )
    
    if edit_query:
        await edit_query.edit_message_text(text, reply_markup=keyboard, parse_mode="HTML")
    else:
        await message.reply_text(text, reply_markup=keyboard, parse_mode="HTML")

async def show_stats_day_details(message, user_id, date_str, prev_days, edit_query=None):
    user_data = get_user_data_by_id(user_id)
    transactions = user_data.get("transactions", [])
    currency = user_data.get("settings", {}).get("currency", "RUB")
    
    day_txs = [t for t in transactions if t.get("date") == date_str]
    
    keyboard = InlineKeyboardMarkup([
        [InlineKeyboardButton("◀️ Назад к статистике", callback_data=f"stats_days:{prev_days}")],
        [InlineKeyboardButton("◀️ Главное меню", callback_data="menu_main")]
    ])
    
    if not day_txs:
        text = f"📅 Нет операций за {date_str}."
        if edit_query:
            await edit_query.edit_message_text(text, reply_markup=keyboard)
        else:
            await message.reply_text(text, reply_markup=keyboard)
        return
        
    try:
        parsed_dt = datetime.strptime(date_str, "%Y-%m-%d")
        formatted_dt = parsed_dt.strftime("%d.%m.%Y")
    except Exception:
        formatted_dt = date_str
        
    expenses = [t for t in day_txs if t["type"] == "expense"]
    incomes = [t for t in day_txs if t["type"] == "income"]
    
    exp_lines = []
    for tx in expenses:
        t_emoji = get_category_emoji(tx["category"], tx["type"])
        escaped_cat = html.escape(tx["category"])
        escaped_desc = html.escape(tx.get("description") or "без описания")
        exp_lines.append(f"• {t_emoji} <b>{format_amount(tx['amount'], currency)}</b> | {escaped_cat} ({escaped_desc})")
        
    inc_lines = []
    for tx in incomes:
        t_emoji = get_category_emoji(tx["category"], tx["type"])
        escaped_cat = html.escape(tx["category"])
        escaped_desc = html.escape(tx.get("description") or "без описания")
        inc_lines.append(f"• {t_emoji} <b>{format_amount(tx['amount'], currency)}</b> | {escaped_cat} ({escaped_desc})")
        
    text = f"📅 <b>Детали операций за {formatted_dt}:</b>\n\n"
    if exp_lines:
        text += "💸 <b>Расходы:</b>\n" + "\n".join(exp_lines) + "\n\n"
    if inc_lines:
        text += "💰 <b>Доходы:</b>\n" + "\n".join(inc_lines) + "\n\n"
        
    text = text.strip()
    
    if edit_query:
        await edit_query.edit_message_text(text, reply_markup=keyboard, parse_mode="HTML")
    else:
        await message.reply_text(text, reply_markup=keyboard, parse_mode="HTML")

def escape_html(text: str) -> str:
    return text.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')

def escape_html(text: str) -> str:
    return text.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')

def format_ai_response(response_text: str) -> str:
    # Try to parse response_text as JSON
    import json
    import re
    import logging
    logger = logging.getLogger(__name__)
    try:
        clean_text = response_text.strip()
        if clean_text.startswith("```"):
            lines = clean_text.splitlines()
            if lines[0].startswith("```"):
                lines = lines[1:]
            if lines and lines[-1].strip() == "```":
                lines = lines[:-1]
            clean_text = "\n".join(lines).strip()
            
        data = json.loads(clean_text, strict=False)
        
        # Unwrap nested single-key dictionaries recursively
        while isinstance(data, dict) and len(data) == 1:
            single_key = list(data.keys())[0]
            single_val = data[single_key]
            if isinstance(single_val, dict):
                data = single_val
            else:
                break
                
        if isinstance(data, dict):
            parts = []
            
            def format_val(val):
                if isinstance(val, list):
                    return [format_val(item) for item in val]
                elif isinstance(val, str):
                    escaped = escape_html(val)
                    escaped = re.sub(r'\*\*(.*?)\*\*', r'<b>\1</b>', escaped)
                    escaped = re.sub(r'\*(.*?)\*', r'<i>\1</i>', escaped)
                    escaped = re.sub(r'`(.*?)`', r'<code>\1</code>', escaped)
                    escaped = escaped.replace('\\n', '\n')
                    return escaped
                elif isinstance(val, dict):
                    inner_parts = []
                    for ik, iv in val.items():
                        ititle = ik.replace('_', ' ').strip().capitalize()
                        inner_parts.append(f"<b>{ititle}:</b> {format_val(iv)}")
                    return "\n".join(inner_parts)
                else:
                    return escape_html(str(val))
                    
            emoji_map = {
                "greeting": "👋",
                "summary": "📊",
                "кратко": "📊",
                "вывод": "📊",
                "biggest_expense": "💸",
                "detailed_analysis": "🔍",
                "детали": "🔍",
                "анализ": "🔍",
                "inefficient_habits": "⚠️",
                "неэффективные_привычки": "⚠️",
                "привычки": "⚠️",
                "what_to_reduce": "✂️",
                "recommendations": "💡",
                "рекомендации": "💡",
                "советы": "💡"
            }
            
            title_map = {
                "greeting": "Приветствие",
                "summary": "Краткий итог",
                "кратко": "Краткий итог",
                "вывод": "Вывод",
                "biggest_expense": "Главный кандидат на сокращение",
                "detailed_analysis": "Детальный анализ",
                "детали": "Детали",
                "анализ": "Анализ",
                "inefficient_habits": "Неэффективные привычки",
                "неэффективные_привычки": "Неэффективные привычки",
                "привычки": "Привычки",
                "what_to_reduce": "Что стоит сократить",
                "recommendations": "Рекомендации",
                "рекомендации": "Рекомендации",
                "советы": "Советы"
            }
            
            for k, v in data.items():
                k_lower = k.lower()
                emoji = emoji_map.get(k_lower, "📝")
                title = title_map.get(k_lower, k.replace("_", " ").strip().capitalize())
                
                if isinstance(v, list):
                    formatted_list = [format_val(item) for item in v]
                    v_text = "\n".join([f"• {item}" for item in formatted_list])
                else:
                    v_text = format_val(v)
                    
                parts.append(f"{emoji} <b>{title}:</b>\n{v_text}")
                
            if parts:
                return "\n\n".join(parts)
    except Exception as e:
        logger.error(f"Error parsing AI JSON response: {e}")
        
    escaped = escape_html(response_text)
    escaped = re.sub(r'\*\*(.*?)\*\*', r'<b>\1</b>', escaped)
    escaped = re.sub(r'\*(.*?)\*', r'<i>\1</i>', escaped)
    escaped = re.sub(r'`(.*?)`', r'<code>\1</code>', escaped)
    return escaped

# ----------------- AI ANALYSIS FLOW -----------------

async def send_formatted_ai_response(message, text, keyboard, response_header=""):
    full_text = response_header + text
    
    chunks = []
    current_chunk = ""
    
    lines = full_text.split('\n')
    for line in lines:
        if len(current_chunk) + len(line) + 1 <= 4000:
            if current_chunk:
                current_chunk += "\n" + line
            else:
                current_chunk = line
        else:
            if len(line) > 4000:
                if current_chunk:
                    chunks.append(current_chunk)
                    current_chunk = ""
                for i in range(0, len(line), 4000):
                    chunks.append(line[i:i+4000])
            else:
                chunks.append(current_chunk)
                current_chunk = line
                
    if current_chunk:
        chunks.append(current_chunk)
        
    if not chunks:
        chunks = [full_text]
        
    for idx, chunk in enumerate(chunks):
        is_last = (idx == len(chunks) - 1)
        markup = keyboard if is_last else None
        
        try:
            await message.reply_text(chunk, reply_markup=markup, parse_mode="HTML")
        except Exception as e:
            logger.error(f"Failed to send HTML chunk {idx}: {e}")
            clean_chunk = chunk.replace('<b>', '').replace('</b>', '').replace('<i>', '').replace('</i>', '').replace('<code>', '').replace('</code>', '')
            try:
                await message.reply_text(clean_chunk, reply_markup=markup)
            except Exception as ex:
                logger.error(f"Failed to send plain chunk {idx}: {ex}")

async def process_ai_analysis_question(message, user_id, q_key, edit_query=None):
    user_data = get_user_data_by_id(user_id)
    settings = user_data.get("settings", {})
    
    ai_enabled = settings.get("ai_enabled", True)
    api_key = settings.get("api_key", os.environ.get("GEMINI_API_KEY") or os.environ.get("OPENAI_API_KEY") or "")
    
    keyboard = InlineKeyboardMarkup([
        [InlineKeyboardButton("🔍 Задать другой вопрос", callback_data="menu_ai")],
        [InlineKeyboardButton("◀️ Главное меню", callback_data="menu_main")]
    ])
    
    if not ai_enabled or not api_key:
        err_msg = "🤖 Для проведения AI-анализа включите AI и укажите API-ключ в Настройках ⚙️."
        if edit_query:
            await edit_query.edit_message_text(err_msg, reply_markup=keyboard)
        else:
            await message.reply_text(err_msg, reply_markup=keyboard)
        return
        
    question = AI_QUESTIONS.get(q_key)
    if not question:
        return
        
    loading_msg = await message.reply_text("⏳ AI анализирует ваши расходы...")
    
    transactions = user_data.get("transactions", [])
    currency = settings.get("currency", "RUB")
    
    sorted_txs = sorted(transactions, key=lambda x: (x.get("date", ""), x.get("id", 0)), reverse=True)[:100]
    
    txs_formatted = []
    for tx in sorted_txs:
        comment = f", комментарий: {tx['description']}" if tx.get('description') else ""
        txs_formatted.append(f"- Дата: {tx['date']}, Тип: {'расход' if tx['type']=='expense' else 'доход'}, Категория: {tx['category']}, Сумма: {tx['amount']} {currency}{comment}")
        
    txs_input = "\n".join(txs_formatted) if txs_formatted else "Нет сохраненных транзакций."
    
    prompt = (
        f"На основе предоставленного списка транзакций пользователя, ответь на вопрос: '{question}'.\n"
        "Отвечай развернуто, но емко и лаконично (объемом до 2500 символов), простыми словами на русском языке, без сложной терминологии. "
        "Используй конкретные примеры из трат пользователя, укажи, на что уходит больше всего денег, "
        "и какие финансовые привычки кажутся неэффективными.\n\n"
        f"Валюта пользователя: {currency}\n"
        f"История транзакций:\n{txs_input}"
    )
    
    try:
        response_text = await call_ai_api(
            prompt=prompt,
            api_key=api_key,
            system_instruction="Ты экспертный финансовый советник, который общается с клиентом на понятном русском языке."
        )
    except Exception as e:
        logger.error(f"AI analysis request failed: {e}")
        if "429" in str(e):
            response_text = "⏳ AI-сервис временно перегружен (лимит запросов). Попробуйте повторить через 1-2 минуты."
        else:
            response_text = f"❌ Не удалось получить ответ от AI. Ошибка: {str(e)}"
        
    try:
        await loading_msg.delete()
    except Exception:
        pass
        
    response_header = f"🤖 <b>Ответ AI на вопрос:</b> '{html.escape(question)}'\n\n"
    
    # Escape response content and convert basic Markdown notation to HTML safely
    escaped_response = format_ai_response(response_text)
    await send_formatted_ai_response(message, escaped_response, keyboard, response_header)

# ----------------- CSV EXPORT -----------------

async def export_data_csv(message, user_id):
    user_data = get_user_data_by_id(user_id)
    transactions = user_data.get("transactions", [])
    
    if not transactions:
        await message.reply_text("❌ У вас пока нет транзакций для экспорта.")
        return
        
    csv_buffer = StringIO()
    writer = csv.writer(csv_buffer)
    writer.writerow(["ID", "Дата", "Тип", "Категория", "Сумма", "Описание"])
    
    sorted_txs = sorted(transactions, key=lambda x: (x.get("date", ""), x.get("id", 0)))
    
    for tx in sorted_txs:
        writer.writerow([
            tx.get("id"),
            tx.get("date"),
            "Доход" if tx.get("type") == "income" else "Расход",
            tx.get("category"),
            tx.get("amount"),
            tx.get("description", "")
        ])
        
    csv_data = csv_buffer.getvalue().encode("utf-8")
    
    await message.reply_document(
        document=csv_data,
        filename="transactions.csv",
        caption="📊 Экспорт ваших финансовых операций в формате CSV."
    )

# ----------------- MAIN BOT START -----------------


async def handle_document(update, context):
    doc = update.message.document
    if not doc.file_name.endswith('.json'):
        return
    
    file = await context.bot.get_file(doc.file_id)
    file_bytes = await file.download_as_bytearray()
    
    try:
        data = json.loads(file_bytes.decode('utf-8'))
        if "transactions" in data and "accounts" in data:
            context.user_data["pending_backup"] = data
            from telegram import InlineKeyboardMarkup, InlineKeyboardButton
            keyboard = InlineKeyboardMarkup([
                [InlineKeyboardButton("✅ Да, восстановить", callback_data="restore_backup:yes")],
                [InlineKeyboardButton("❌ Отмена", callback_data="restore_backup:no")]
            ])
            await update.message.reply_text(
                "⚠️ Вы загрузили резервную копию базы данных.\n\n"
                "Вы действительно хотите <b>заменить все текущие транзакции и балансы</b> на данные из этого файла?",
                reply_markup=keyboard,
                parse_mode="HTML"
            )
        else:
            await update.message.reply_text("❌ Этот JSON-файл не содержит финансовых данных бота.")
    except Exception as e:
        await update.message.reply_text(f"❌ Ошибка при чтении файла: {e}")

def main():

    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    if not token:
        logger.error("Error: TELEGRAM_BOT_TOKEN environment variable not set.")
        print("Please set TELEGRAM_BOT_TOKEN in .env or system environment.")
        return
        
    application = Application.builder().token(token).build()
    
    application.add_handler(CommandHandler("start", start_command))
    application.add_handler(CommandHandler("menu", menu_command))
    
    application.add_handler(CallbackQueryHandler(handle_callback_query))
    
    application.add_handler(MessageHandler(filters.VOICE, handle_voice))
    application.add_handler(MessageHandler(filters.PHOTO, handle_photo))

    application.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))
    application.add_handler(MessageHandler(filters.Document.ALL, handle_document))

    
    logger.info("Bot started and listening for messages...")
    
    # --- Dummy HTTP Server for Render.com ---
    class DummyHandler(BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200)
            self.send_header('Content-type','text/plain')
            self.end_headers()
            self.wfile.write(b"Bot is running!")
            
        def do_HEAD(self):
            self.send_response(200)
            self.send_header('Content-type','text/plain')
            self.end_headers()

    def run_dummy_server():
        port = int(os.environ.get("PORT", 10000))
        server = HTTPServer(('0.0.0.0', port), DummyHandler)
        server.serve_forever()

    server_thread = threading.Thread(target=run_dummy_server)
    server_thread.daemon = True
    server_thread.start()
    # ----------------------------------------
    
    application.run_polling()

if __name__ == "__main__":
    main()
