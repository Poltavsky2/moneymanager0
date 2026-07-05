import os
import asyncio
import httpx
import base64
import re
import json

# Setup minimal call_ai_api
async def call_ai_api(prompt: str, api_key: str, system_instruction: str = None) -> str:
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key={api_key}"
    headers = {"Content-Type": "application/json"}
    parts = []
    if system_instruction:
        parts.append({"text": f"SYSTEM INSTRUCTION: {system_instruction}\\n\\n"})
    parts.append({"text": prompt})
    
    payload = {
        "contents": [{"parts": parts}],
        "generationConfig": {
            "responseMimeType": "application/json"
        }
    }
    
    async with httpx.AsyncClient() as client:
        resp = await client.post(url, headers=headers, json=payload, timeout=60.0)
        resp.raise_for_status()
        return resp.json()["candidates"][0]["content"]["parts"][0]["text"]

async def main():
    api_key = "AIzaSyAHseMvoHZK9gmh9yGxDXqMEqMZItnf_LI"
    currency = "RUB"
    
    # Predefined question 5: "Что можно сократить?"
    question = "Что можно сократить?"
    
    txs_input = """- Дата: 2026-07-04, Тип: расход, Категория: Другое, Сумма: 65.0 RUB, комментарий: метро 65
- Дата: 2026-07-04, Тип: расход, Категория: Продукты, Сумма: 195.0 RUB, комментарий: доширак: 3 шт по 65 руб
- Дата: 2026-07-05, Тип: расход, Категория: Развлечения, Сумма: 5000.0 RUB, комментарий: билет на VK Fest
- Дата: 2026-07-05, Тип: доход, Категория: Зарплата, Сумма: 20000.0 RUB, комментарий: выполнение заказа для клиента"""
    
    prompt = (
        f"На основе предоставленного списка транзакций пользователя, ответь на вопрос: '{question}'.\\n"
        "Отвечай развернуто, простыми словами на русском языке, без сложной терминологии. "
        "Используй конкретные примеры из трат пользователя, укажи, на что уходит больше всего денег, "
        "и какие финансовые привычки кажутся неэффективными.\\n\\n"
        f"Валюта пользователя: {currency}\\n"
        f"История транзакций:\\n{txs_input}"
    )
    
    print("Calling AI API...")
    res = await call_ai_api(prompt, api_key, "Ты экспертный финансовый советник, который общается с клиентом на понятном русском языке.")
    print("Response length:", len(res))
    print("Response content:")
    print(res)

if __name__ == "__main__":
    asyncio.run(main())
