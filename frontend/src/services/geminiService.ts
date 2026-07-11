import { GoogleGenAI, Type } from "@google/genai";
import { Product, UserBiologicalData, UserGoals, DietEntry } from "../types";

let genAI: GoogleGenAI | null = null;
let currentKey: string | null = null;

class GroqWrapper {
  constructor(private apiKey: string) {}
  
  models = {
    generateContent: async (args: any) => {
      let model = "llama-3.3-70b-versatile";
      const messages = [];
      
      const contents = args.contents || [];
      for (const item of contents) {
        if (item.role === "system") {
           messages.push({ role: "system", content: item.parts.map((p: any) => p.text).join("") });
        } else {
           let contentArr: any = [];
           let hasImage = false;
           for (const part of item.parts) {
             if (part.text) contentArr.push({ type: "text", text: part.text });
             if (part.inlineData) {
               hasImage = true;
               model = "meta-llama/llama-4-scout-17b-16e-instruct";
               contentArr.push({ type: "image_url", image_url: { url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}` }});
             }
           }
           if (contentArr.length === 1 && contentArr[0].type === "text") {
             messages.push({ role: "user", content: contentArr[0].text });
           } else {
             messages.push({ role: "user", content: contentArr });
           }
        }
      }
      
      const payload: any = {
        model,
        messages
      };
      
      if (args.config?.responseSchema) {
        payload.response_format = { type: "json_object" };
      }
      
      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });
      
      if (!response.ok) {
        const err = await response.text();
        throw new Error(`Groq API Error: ${response.status} ${err}`);
      }
      
      const data = await response.json();
      const textResponse = data.choices[0].message.content;
      
      return {
        text: textResponse
      };
    }
  };
}

const getAI = () => {
  const env = (import.meta as any).env || {};
  const key = 
    localStorage.getItem('user_gemini_api_key') || 
    (typeof process !== 'undefined' ? process.env?.GEMINI_API_KEY : null) || 
    env.VITE_GEMINI_API_KEY;
  
  if (!key) {
    throw new Error("API ключ не задан.");
  }

  if (!genAI || key !== currentKey) {
    if (key.startsWith("gsk_")) {
      genAI = new GroqWrapper(key) as any;
    } else {
      const baseUrl = window.location.origin + '/google-proxy';
      genAI = new GoogleGenAI({ apiKey: key, httpOptions: { baseUrl } });
    }
    currentKey = key;
  }
  
  return genAI;
};

export interface AnalysisResult {
  name: string;
  category: 'product' | 'simple_dish' | 'complex_dish';
  ingredients: Array<{
    name: string;
    health_impact: 'high' | 'medium' | 'low';
    description: string;
    risk_level: number;
  }>;
  health_score: number;
  nutrition: {
    calories: number;
    protein: number;
    fat: number;
    carbs: number;
  };
  verdict: string;
  warning_type: 'danger' | 'caution' | 'info' | 'none';
  warning_message?: string;
  matched_product_id?: string;
  error?: string;
}

const isRateLimitError = (error: any) => {
  if (!error) return false;
  if (typeof error === 'string' && (error.includes('429') || error.toLowerCase().includes('rate limit') || error.toLowerCase().includes('quota exceeded'))) return true;
  const msg = error.message || error.error?.message || '';
  const code = error.status || error.error?.code || 0;
  return code === 429 || String(msg).includes('429') || String(msg).toLowerCase().includes('quota') || String(msg).toLowerCase().includes('rate limit') || String(msg).toLowerCase().includes('resource_exhausted');
};

export const analyzeProduct = async (input: { image?: string; text?: string }, knownProducts: Product[] = []): Promise<AnalysisResult> => {
  try {
    const ai = getAI();
    const key = localStorage.getItem('user_gemini_api_key') || '';
    const model = key.startsWith('AQ') ? "gemini-3.5-flash" : "gemini-1.5-flash";
    
    let contents: any;
    const knownProductsStr = knownProducts.length > 0 
      ? `\n\nБаза известных продуктов: ${JSON.stringify(knownProducts.map(p => ({ id: p.id, name: p.name, nutrition: p.nutrition })))}\nЕсли текущий сканируемый продукт совпадает с каким-либо из базы известных продуктов более чем на 95% (по названию и составу), ОБЯЗАТЕЛЬНО верни его id в поле matched_product_id и используй его имя и нутриенты.`
      : "";

    if (input.image) {
      const base64Data = input.image.split(',')[1];
      contents = {
        parts: [
          { text: getPrompt() + knownProductsStr },
          { inlineData: { data: base64Data, mimeType: "image/jpeg" } }
        ]
      };
    } else {
      contents = getPrompt() + knownProductsStr + "\n\nДАННЫЕ: " + (input.text || "");
    }

    const response = await ai.models.generateContent({
      model,
      contents: input.image ? [contents] : [{ role: "user", parts: [{ text: contents }] }],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          required: ["name", "category", "ingredients", "health_score", "nutrition", "verdict", "warning_type"],
          properties: {
            name: { type: Type.STRING },
            category: { type: Type.STRING, enum: ["product", "simple_dish", "complex_dish"] },
            health_score: { type: Type.NUMBER },
            verdict: { type: Type.STRING },
            warning_type: { type: Type.STRING, enum: ["danger", "caution", "info", "none"] },
            warning_message: { type: Type.STRING },
            matched_product_id: { type: Type.STRING },
            nutrition: {
              type: Type.OBJECT,
              required: ["calories", "protein", "fat", "carbs"],
              properties: {
                calories: { type: Type.NUMBER },
                protein: { type: Type.NUMBER },
                fat: { type: Type.NUMBER },
                carbs: { type: Type.NUMBER },
              }
            },
            ingredients: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                required: ["name", "health_impact", "description", "risk_level"],
                properties: {
                  name: { type: Type.STRING },
                  health_impact: { type: Type.STRING, enum: ["high", "medium", "low"] },
                  description: { type: Type.STRING },
                  risk_level: { type: Type.NUMBER }
                }
              }
            }
          }
        }
      }
    });

    if (!response.text) throw new Error("AI не вернул ответ");
    return JSON.parse(response.text) as AnalysisResult;
  } catch (error: any) {
    console.error("Gemini Analysis Error:", error);
    let errorMsg = error.message || "Ошибка AI";
    if (isRateLimitError(error)) errorMsg = "Превышен лимит запросов. Пожалуйста, подождите минуту.";
    return {
      name: "Ошибка",
      category: "product",
      ingredients: [],
      health_score: 0,
      nutrition: { calories: 0, protein: 0, fat: 0, carbs: 0 },
      verdict: "Не удалось проанализировать продукт.",
      warning_type: 'none',
      error: errorMsg
    };
  }
};

export const getDailyAdvice = async (diet: DietEntry[], goals?: UserGoals): Promise<string> => {
  try {
    const key = localStorage.getItem('user_gemini_api_key') || '';
    const model = key.startsWith('AQ') ? "gemini-3.5-flash" : "gemini-1.5-flash";
    const dietContext = diet.length === 0 ? "Рацион пока пуст." : diet.map(entry => `- ${entry.mealType}: ${entry.description || (entry.items && entry.items[0]?.productName) || "Прием пищи"}`).join("\n");
    const goalsContext = goals ? `Цели: ${goals.calories}ккал, Б:${goals.protein}, Ж:${goals.fat}, У:${goals.carbs}` : "";

    const prompt = `Ты — диетолог. Дай очень короткий совет (1-2 предложения) на русском.\n${goalsContext}\nЕда за сегодня:\n${dietContext}`;
    const ai = getAI();
    const response = await ai.models.generateContent({ model, contents: [{ role: "user", parts: [{ text: prompt }] }] });
    return (response.text || "Старайтесь пить больше воды.").trim();
  } catch (error: any) {
    console.error("Advice Error:", error);
    if (isRateLimitError(error)) return "Совет временно недоступен из-за лимита запросов.";
    return "Соблюдайте баланс БЖУ.";
  }
};

export interface MealAuditResult {
  foundItems: Array<{ productId: string; productName: string; weight: number; calories: number; health_score: number; protein: number; fat: number; carbs: number; }>;
  missingItems: string[];
  totalCalories: number;
  totalProtein: number;
  totalFat: number;
  totalCarbs: number;
  averageHealthScore: number;
  verdict: string;
  error?: string;
}

export const analyzeMealDescription = async (description: string, knownProducts: Product[]): Promise<MealAuditResult> => {
  try {
    const key = localStorage.getItem('user_gemini_api_key') || '';
    const model = key.startsWith('AQ') ? "gemini-3.5-flash" : "gemini-1.5-flash";
    const prompt = `Проанализируй прием пищи: "${description}". 
База известных продуктов: ${JSON.stringify(knownProducts.map(p => ({ id: p.id, name: p.name, nutrition: p.nutrition, health_score: p.health_score })))}. 
Задания:
1. Выдели все продукты и их примерный вес.
2. Система содержит специальные продукты 'Вода' (id: 'system-water-product') и 'Шаги' (id: 'system-steps-product'). 
   - Используй 'Вода' ТОЛЬКО для чистой питьевой воды (напр. "выпил 200мл воды"). 
   - ВНИМАНИЕ: Для любых пищевых продуктов, даже жидких или содержащих много влаги (суп, молоко, йогурт, ТВОРОГ, сок), используй ОБЫЧНЫЙ анализ продуктов с КБЖУ. ТВОРОГ — ЭТО ЕДА, А НЕ ВОДА.
   - Если упоминается чистая вода, ОБЯЗАТЕЛЬНО используй объект {productId: "system-water-product", productName: "Вода", weight: объем_в_мл, calories: 0, health_score: 100, protein: 0, fat: 0, carbs: 0}.
   - Если упоминается ходьба или шаги, используй {productId: "system-steps-product", productName: "Шаги", weight: кол_во_шагов, calories: 0, health_score: 100, protein: 0, fat: 0, carbs: 0}.
   - Никогда не помещай 'Вода' или 'Шаги' в missingItems.
3. Рассчитай общие КБЖУ только для ЕДЫ (вода и шаги имеют 0 калорий).
Верни только JSON.`;

    const ai = getAI();
    const response = await ai.models.generateContent({
      model,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          required: ["foundItems", "missingItems", "totalCalories", "totalProtein", "totalFat", "totalCarbs", "averageHealthScore", "verdict"],
          properties: {
            foundItems: { type: Type.ARRAY, items: { type: Type.OBJECT, required: ["productId", "productName", "weight", "calories", "health_score", "protein", "fat", "carbs"], properties: { productId: { type: Type.STRING }, productName: { type: Type.STRING }, weight: { type: Type.NUMBER }, calories: { type: Type.NUMBER }, health_score: { type: Type.NUMBER }, protein: { type: Type.NUMBER }, fat: { type: Type.NUMBER }, carbs: { type: Type.NUMBER } } } },
            missingItems: { type: Type.ARRAY, items: { type: Type.STRING } },
            totalCalories: { type: Type.NUMBER },
            totalProtein: { type: Type.NUMBER },
            totalFat: { type: Type.NUMBER },
            totalCarbs: { type: Type.NUMBER },
            averageHealthScore: { type: Type.NUMBER },
            verdict: { type: Type.STRING }
          }
        }
      }
    });

    return JSON.parse(response.text || "{}") as MealAuditResult;
  } catch (error: any) {
    console.error("Meal Analysis Error:", error);
    const errorMsg = isRateLimitError(error) ? "Лимит запросов исчерпан." : "Ошибка анализа.";
    return { foundItems: [], missingItems: [], totalCalories: 0, totalProtein: 0, totalFat: 0, totalCarbs: 0, averageHealthScore: 0, verdict: errorMsg, error: errorMsg };
  }
};

export const analyzeFoodImage = async (base64Image: string, knownProducts: Product[]): Promise<MealAuditResult> => {
  try {
    const key = localStorage.getItem('user_gemini_api_key') || '';
    const model = key.startsWith('AQ') ? "gemini-3.5-flash" : "gemini-1.5-flash";
    const base64Data = base64Image.split(',')[1] || base64Image;
    const prompt = `Определи еду на фото. 
База известных продуктов: ${JSON.stringify(knownProducts.map(p => ({ id: p.id, name: p.name, nutrition: p.nutrition, health_score: p.health_score })))}. 
Задания:
1. Выдели все продукты и блюда на фото.
2. Если на фото видна чистая питьевая вода (стакан воды, бутылка без этикетки или с надписью "вода"), ОБЯЗАТЕЛЬНО используй объект {productId: "system-water-product", productName: "Вода", weight: 250, calories: 0, health_score: 100, protein: 0, fat: 0, carbs: 0} в foundItems. 
   - ВНИМАНИЕ: Для продуктов типа йогурта, ТВОРОГА, молока или сока КАТЕГОРИЧЕСКИ НЕ используй категорию воды. ТВОРОГ — ЭТО ЕДА.
3. 'Вода' и 'Шаги' не должны попадать в missingItems.
4. Суммируй КБЖУ только для еды.
5. Верни JSON.`;

    const ai = getAI();
    const response = await ai.models.generateContent({
      model,
      contents: [{ role: "user", parts: [{ text: prompt }, { inlineData: { data: base64Data, mimeType: "image/jpeg" } }] }],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          required: ["foundItems", "missingItems", "totalCalories", "totalProtein", "totalFat", "totalCarbs", "averageHealthScore", "verdict"],
          properties: {
            foundItems: { type: Type.ARRAY, items: { type: Type.OBJECT, required: ["productId", "productName", "weight", "calories", "health_score", "protein", "fat", "carbs"], properties: { productId: { type: Type.STRING }, productName: { type: Type.STRING }, weight: { type: Type.NUMBER }, calories: { type: Type.NUMBER }, health_score: { type: Type.NUMBER }, protein: { type: Type.NUMBER }, fat: { type: Type.NUMBER }, carbs: { type: Type.NUMBER } } } },
            missingItems: { type: Type.ARRAY, items: { type: Type.STRING } },
            totalCalories: { type: Type.NUMBER },
            totalProtein: { type: Type.NUMBER },
            totalFat: { type: Type.NUMBER },
            totalCarbs: { type: Type.NUMBER },
            averageHealthScore: { type: Type.NUMBER },
            verdict: { type: Type.STRING }
          }
        }
      }
    });

    return JSON.parse(response.text || "{}") as MealAuditResult;
  } catch (error: any) {
    console.error("Food Photo Analysis Error:", error);
    const errorMsg = isRateLimitError(error) ? "Лимит запросов исчерпан." : "Ошибка фото-анализа.";
    return { foundItems: [], missingItems: [], totalCalories: 0, totalProtein: 0, totalFat: 0, totalCarbs: 0, averageHealthScore: 0, verdict: errorMsg, error: errorMsg };
  }
};

export const calculatePersonalGoals = async (bio: UserBiologicalData): Promise<UserGoals> => {
  try {
    const key = localStorage.getItem('user_gemini_api_key') || '';
    const model = key.startsWith('AQ') ? "gemini-3.5-flash" : "gemini-1.5-flash";
    const prompt = `Рассчитай КБЖУ, норму воды (мл) и рекомендованное количество шагов. Данные: ${JSON.stringify(bio)}. Верни JSON {calories, protein, fat, carbs, water, steps}.`;

    const ai = getAI();
    const response = await ai.models.generateContent({
      model,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          required: ["calories", "protein", "fat", "carbs", "water", "steps"],
          properties: { 
            calories: { type: Type.NUMBER }, 
            protein: { type: Type.NUMBER }, 
            fat: { type: Type.NUMBER }, 
            carbs: { type: Type.NUMBER },
            water: { type: Type.NUMBER },
            steps: { type: Type.NUMBER }
          }
        }
      }
    });

    const result = JSON.parse(response.text || "{}") as UserGoals;
    
    if (bio.weight) {
      let waterBase = bio.weight * (bio.gender === 'female' ? 30 : 35);
      if (bio.activity === 'medium') waterBase += 500;
      if (bio.activity === 'high') waterBase += 1000;
      if (bio.goalCategory === 'weight_loss' || bio.goalCategory === 'weight_gain') waterBase += 400;
      result.water = Math.round(waterBase);
    }
    
    return result;
  } catch (error: any) {
    console.error("Goals Error:", error);
    let water = 2000;
    let steps = 10000;
    let calories = 2000;
    
    if (bio.weight) {
      water = Math.round(bio.weight * 35);
      if (bio.activity === 'medium') { water += 500; steps = 10000; }
      else if (bio.activity === 'high') { water += 1000; steps = 15000; }
      else { steps = 7000; }
      
      // Basic Harris-Benedict fallback
      if (bio.gender === 'male') {
        calories = Math.round((88.36 + (13.4 * bio.weight) + (4.8 * bio.height) - (5.7 * bio.age)) * 1.5);
      } else {
        calories = Math.round((447.59 + (9.2 * bio.weight) + (3.1 * bio.height) - (4.3 * bio.age)) * 1.5);
      }
    }

    return { 
      calories, 
      protein: Math.round(calories * 0.25 / 4), 
      fat: Math.round(calories * 0.25 / 9), 
      carbs: Math.round(calories * 0.5 / 4), 
      water, 
      steps 
    };
  }
};

export const refineGoal = async (bio: UserBiologicalData): Promise<string> => {
  try {
    const key = localStorage.getItem('user_gemini_api_key') || '';
    const model = key.startsWith('AQ') ? "gemini-3.5-flash" : "gemini-1.5-flash";
    const prompt = `Проанализируй данные пользователя (возраст: ${bio.age}, рост: ${bio.height}, вес: ${bio.weight}) и его цель: "${bio.goalDescription || "не указана"}". 
Сформулируй краткую, конкретную и мотивирующую цель на русском языке (1 предложение). 
Если описание цели пустое, сформулируй её на основе параметров тела (например, поддержание формы или здоровый образ жизни). 
Верни только текст цели без кавычек.`;
    const ai = getAI();
    const response = await ai.models.generateContent({ model, contents: [{ role: "user", parts: [{ text: prompt }] }] });
    return (response.text || bio.goalDescription || "Здоровый образ жизни").trim();
  } catch (error) {
    return bio.goalDescription || "Здоровый образ жизни";
  }
};

export interface LongTermAnalysis {
  intro: string;
  what_was_good: string;
  what_to_watch: string;
  how_to_use: string;
}

export const analyzeLongTermDiet = async (diet: DietEntry[], periodName: string, goals?: UserGoals): Promise<LongTermAnalysis> => {
  try {
    const key = localStorage.getItem('user_gemini_api_key') || '';
    const model = key.startsWith('AQ') ? "gemini-3.5-flash" : "gemini-1.5-flash";
    
    const dietSummary = diet.map(d => ({
      date: new Date(d.timestamp).toLocaleDateString(),
      time: new Date(d.timestamp).toLocaleTimeString(),
      meal: d.mealType,
      desc: d.description || (d.items && d.items[0]?.productName) || "Еда",
      score: d.health_score,
      nutrition: { c: d.calories, p: d.protein, f: d.fat, ch: d.carbs }
    }));

    const goalsContext = goals ? `Цели: ${goals.calories}ккал, Б:${goals.protein}, Ж:${goals.fat}, У:${goals.carbs}` : "";

    const prompt = `Ты — эксперт-нутрициолог. Проанализируй рацион пользователя за период: ${periodName}.
${goalsContext}
Данные рациона (в сжатом виде): ${JSON.stringify(dietSummary.slice(-100))}

Подготовь отчет на РУССКОМ языке. Пиши ПРОСТО и ПОНЯТНО, без сложных медицинских терминов, как будто объясняешь другу.
Используй живые примеры из результата (например, названия продуктов из рациона).

ВАЖНО: Если данных рациона НЕТ или их критически мало (например, 0 или 1 запись за день), не пытайся выдумывать. Прямо напиши в каждом пункте: "Данных недостаточно" и ОБЯЗАТЕЛЬНО укажи конкретные шаги, что нужно сделать (например: "Пожалуйста, добавьте ваши приемы пищи через главное меню, чтобы я смог рассчитать ваши цифры.").

Структура отчета (JSON):
1. intro: Вводный текст про день/период. Оцени калорийность, баланс и общую активность. Дай характеристику дню (например, "сладко-хлебный день" или "отличный белковый день").
2. what_was_good: Раздел "✅ Что было хорошо". Опиши плюсы: белковая основа, овощи, вода, шаги, полезные привычки.
3. what_to_watch: Раздел "⚠️ На что аккуратно смотреть". Опиши минусы или риски: сладости, перебор жиров/углеводов, недостаток шагов.
4. how_to_use: Раздел "📌 Как использовать этот день". Дай краткие выводы и правила для подобных дней в будущем (например, "оставь 1 сладость вместо 3", "увеличь шаги").

Текст внутри полей может содержать символы переноса строки (\n) для форматирования списков (например, "- Белок: ...\n- Овощи: ..."). Верни JSON объект со строковыми полями: intro, what_was_good, what_to_watch, how_to_use.`;

    const ai = getAI();
    const response = await ai.models.generateContent({
      model,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          required: ["intro", "what_was_good", "what_to_watch", "how_to_use"],
          properties: {
            intro: { type: Type.STRING },
            what_was_good: { type: Type.STRING },
            what_to_watch: { type: Type.STRING },
            how_to_use: { type: Type.STRING }
          }
        }
      }
    });

    return JSON.parse(response.text || "{}") as LongTermAnalysis;
  } catch (error: any) {
    console.error("Long Term Analysis Error:", error);
    return {
      intro: `Ошибка: ${error?.message || String(error)}`,
      what_was_good: "Анализ не удался из-за технической ошибки.",
      what_to_watch: "Попробуйте запросить отчет позже.",
      how_to_use: "Попробуйте запросить отчет позже."
    };
  }
};

function getPrompt() {
  return `Ты — эксперт-нутрициолог. Проанализируй состав продукта и верни JSON на РУССКОМ языке.
  
  КАТЕГОРИИ:
  - product: отдельные продукты (молоко, яблоки, творог, курица).
  - simple_dish: простые блюда из 2-3 ингредиентов (бутерброд, омлет).
  - complex_dish: сложные многокомпонентные блюда.

  ВНИМАНИЕ - НУТРИЕНТЫ:
  Значения в объекте nutrition (calories, protein, fat, carbs) ДОЛЖНЫ БЫТЬ УКАЗАНЫ СТРОГО НА 100 ГРАММ продукта или блюда! Не указывай значения для всей порции, только в расчете на 100 г!

  HEALTH_IMPACT (ЗНАЧЕНИЕ ДЛЯ JSON ПОЛЯ health_impact):
  - "low": ПОЛЕЗНО/БЕЗОПАСНО (ЗЕЛЕНАЯ точка 🟢). Используй для натуральных продуктов, белков, витаминов (Примеры: молоко, мясо, овощи, орехи).
  - "medium": НЕЙТРАЛЬНО/ОСТОРОЖНО (ЖЕЛТАЯ точка 🟡). Используй для добавок с низким риском (Примеры: натуральные ароматизаторы, подсластители, лецитин).
  - "high": ВРЕДНО/ОПАСНО (КРАСНАЯ точка 🔴). Используй для компонентов с высоким риском (Примеры: сахар, трансжиры, ГМО, консерванты, опасная химия).
  ВАЖНО: Никогда не путай их! "low" = ЗЕЛЕНЫЙ, "high" = КРАСНЫЙ. 🔘
  
  WARNING_TYPE:
  - danger: содержит крайне вредные вещества (трансжиры, опасная химия) или является абсолютно несъедобным и ядовитым.
  - caution: ПРЕДНАЗНАЧЕНО ДЛЯ НЕПИЩЕВЫХ ОБЪЕКТОВ. Используй для вещей, которые не являются едой в обычном смысле (зубная паста, косметика, мыло), но не являются мгновенно смертельными.
  - info: используй ТОЛЬКО для БАДов, витаминов и спортивного питания (протеин, креатин).
  - none: любой ПИЩЕВОЙ продукт или блюдо (даже если в нем много соли или жира, как в плове). Качество еды отражай через health_score, а не через warning_type.
  
  Если это еда (даже вредная, жирная или соленая, например, плов), ВСЕГДА используй warning_type: "none", а вредность отражай низким баллом health_score.
  Если это витамины или добавки, используй warning_type: "info".
  
  ВНИМАНИЕ: Если на входе ПРОСТО ЧИСТАЯ ПИТЬЕВАЯ ВОДА (или бутылка воды без добавок) или упоминается ХОДЬБА/ШАГИ, ты ДОЛЖЕН вернуть JSON с полем name: "Системный объект" и category: (если вода - "water", если шаги - "steps") и verdict: "Для чистой воды и шагов используйте специальные блоки на главном экране. Сканирование этих категорий не требуется." и nutrition с нулевыми значениями. Сочти это за ошибку анализа в verdict. 
  ВАЖНО: Пищевые продукты (молоко, ТВОРОГ, йогурт, соки) НЕ являются водой и должны анализироваться как еда с КБЖУ.`;
}
