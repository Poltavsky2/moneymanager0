import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Camera, 
  History, 
  User, 
  Settings, 
  Info, 
  Plus, 
  Search, 
  Filter,
  ArrowUpDown,
  ChevronRight, 
  ChevronLeft,
  Flame, 
  Trash2, 
  Download, 
  Upload,
  ArrowLeft,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Star,
  BookOpen,
  Calendar,
  RotateCcw,
  Check,
  X,
  AlertCircle,
  Key,
  Pencil,
  ChevronDown,
  Sparkles,
  HelpCircle,
  Clock,
  Trophy,
  Zap,
  Snowflake,
  Sun,
  Leaf,
  Flower2,
  Shield,
  Droplets,
  Footprints,
  Utensils,
  TrendingUp,
  Award,
  CalendarDays,
  Target,
  Waves,
  MapPin,
  TrendingDown,
  LayoutGrid,
  Apple,
  Pill,
  Soup,
  CookingPot,
  Edit2,
  Scale
} from 'lucide-react';
import { 
  ResponsiveContainer, 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  Tooltip as ChartTooltip, 
  CartesianGrid,
  Cell
} from 'recharts';
import { Product, DietEntry, MealType, UserProfile, Ingredient, UserBiologicalData } from './types';
import { 
  analyzeProduct, 
  getDailyAdvice, 
  analyzeMealDescription, 
  analyzeFoodImage,
  MealAuditResult,
  calculatePersonalGoals,
  refineGoal,
  analyzeLongTermDiet,
  LongTermAnalysis
} from './services/geminiService';
import { 
  getUserProfile, 
  createUserProfile, 
  updateLastLogin, 
  saveUserData, 
  loadUserData,
  deleteDietEntryFromStore,
  deleteProductFromStore,
  saveDietEntry as saveDietEntryToStore,
  saveProduct as saveProductToStore,
  bulkSyncData,
  subscribeToUserData,
  subscribeToDiet,
  subscribeToProducts
} from './lib/firebase';

const formatDateISO = (d: Date) => {
  const z = (n: number) => n < 10 ? '0' + n : n;
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
};

const formatTime24 = (d: Date) => {
  const z = (n: number) => n < 10 ? '0' + n : n;
  return `${z(d.getHours())}:${z(d.getMinutes())}`;
};

const parseISODate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};

// --- Norm calculations ---
export const calculateDefaultWater = (bio?: UserBiologicalData) => {
  if (!bio?.weight) return 2000;
  
  // 1. Base need
  let base = bio.weight * (bio.gender === 'female' ? 30 : 35);
  
  // 2. Activity correction
  if (bio.activity === 'medium') base += 500;
  if (bio.activity === 'high') base += 1000;
  
  // 3. Goal correction
  if (bio.goalCategory === 'weight_loss' || bio.goalCategory === 'weight_gain') {
    base += 400;
  }
  
  return Math.round(base);
};

export const calculateDefaultSteps = (bio?: UserBiologicalData) => {
  if (!bio) return 10000;
  let base = 7000;
  if (bio.activity === 'medium') base = 10000;
  if (bio.activity === 'high') base = 15000;
  
  // Adjust based on goal
  if (bio.goalCategory === 'weight_loss') base += 2000;
  if (bio.goalCategory === 'weight_gain') base -= 2000;
  
  return Math.max(5000, base);
};

// --- Hooks ---

const useDragScroll = () => {
  const ref = React.useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [startX, setStartX] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);

  const onMouseDown = (e: React.MouseEvent) => {
    if (!ref.current) return;
    setIsDragging(true);
    setStartX(e.pageX - ref.current.offsetLeft);
    setScrollLeft(ref.current.scrollLeft);
  };

  const onMouseLeave = () => {
    setIsDragging(false);
  };

  const onMouseUp = () => {
    setIsDragging(false);
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !ref.current) return;
    e.preventDefault();
    const x = e.pageX - ref.current.offsetLeft;
    const walk = (x - startX) * 2; // Scroll speed
    ref.current.scrollLeft = scrollLeft - walk;
  };

  return { 
    ref, 
    events: {
      onMouseDown,
      onMouseLeave,
      onMouseUp,
      onMouseMove
    }
  };
};

// --- Components ---

const ProgressBar = ({ value, max, color = 'bg-emerald-500' }: { value: number; max: number; color?: string }) => (
  <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
    <motion.div 
      initial={{ width: 0 }}
      animate={{ width: `${Math.min((value / max) * 100, 100)}%` }}
      className={`${color} h-full transition-all duration-500`}
    />
  </div>
);

const StatusBadge = ({ warningType, category, id }: { warningType?: string, category?: string, id?: string }) => {
  const warn = (warningType || '').trim().toLowerCase();
  
  if (id === WATER_PRODUCT_ID || category === 'water') return <span className="inline-block text-[8px] font-black uppercase tracking-tighter px-1.5 py-0.5 rounded-md bg-blue-100 text-blue-700 ring-1 ring-blue-200">Вода</span>;
  if (id === STEPS_PRODUCT_ID || category === 'steps') return <span className="inline-block text-[8px] font-black uppercase tracking-tighter px-1.5 py-0.5 rounded-md bg-orange-100 text-orange-700 ring-1 ring-orange-200">Активность</span>;

  if (warn === 'danger') return <span className="inline-block text-[8px] font-black uppercase tracking-tighter px-1.5 py-0.5 rounded-md bg-rose-100 text-rose-700 ring-1 ring-rose-200 animate-pulse">Опасно</span>;
  if (warn === 'caution') return <span className="inline-block text-[8px] font-black uppercase tracking-tighter px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-700 ring-1 ring-amber-200">Нежелательно</span>;
  if (warn === 'info') return <span className="inline-block text-[8px] font-black uppercase tracking-tighter px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-700 ring-1 ring-slate-200">Суплемент</span>;

  if (category === 'product' || !category) return <span className="inline-block text-[8px] font-black uppercase tracking-tighter px-1.5 py-0.5 rounded-md bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200">Продукт</span>;
  if (category === 'simple_dish') return <span className="inline-block text-[8px] font-black uppercase tracking-tighter px-1.5 py-0.5 rounded-md bg-blue-100 text-blue-700 ring-1 ring-blue-200">Простое блюдо</span>;
  if (category === 'complex_dish') return <span className="inline-block text-[8px] font-black uppercase tracking-tighter px-1.5 py-0.5 rounded-md bg-purple-100 text-purple-700 ring-1 ring-purple-200">Сложное блюдо</span>;
  
  return null;
};

const ScoreBadge = ({ score, warningType }: { score: number, warningType?: string }) => {
  const s = score || 0;
  const warn = (warningType || '').trim().toLowerCase();
  
  const getStyle = () => {
    if (warn === 'info') return 'bg-slate-50 text-slate-500 border-slate-100';
    if (s >= 80) return 'bg-emerald-50 text-emerald-600 border-emerald-100';
    if (s >= 60) return 'bg-amber-50 text-amber-600 border-amber-100';
    if (s >= 40) return 'bg-orange-50 text-orange-600 border-orange-100';
    return 'bg-rose-50 text-rose-600 border-rose-100';
  };
  
  return (
    <div className={`px-2 py-1 rounded-lg font-bold text-[10px] border ${getStyle()}`}>
      {s}%
    </div>
  );
};

// --- App Store Mock (since Firebase setup is pending) ---
// --- Constants ---

const LEVEL_THRESHOLDS = [
  80, 204, 353, 520, 703, 899, 1107, 1325, 1554, 1791, 2037, 2291, 2552, 2821, 3096, 3378, 3666, 3960, 4260, 4565, 
  4876, 5192, 5513, 5839, 6170, 6506, 6846, 7190, 7539, 7892, 8250, 8611, 8976, 9345, 9718, 10095, 10475, 10859, 11247, 11638, 
  12032, 12430, 12831, 13236, 13644, 14054, 14468, 14886, 15306, 15729, 16155, 16584, 17016, 17451, 17889, 18329, 18772, 19218, 19667, 20118, 
  20572, 21029, 21488, 21950, 22414, 22881, 23350, 23822, 24296, 24773, 25252, 25733, 26217, 26703, 27191, 27681, 28174, 28669, 29167, 29666, 
  30168, 30672, 31178, 31686, 32196, 32709, 33223, 33740, 34258, 34779, 35302, 35826, 36353, 36882, 37413, 37945, 38480, 39016, 39555, 40095, 
  40637, 41181, 41727, 42275, 42825, 43376, 43930, 44485, 45042, 45601, 46161, 46723, 47287, 47853, 48421, 48990, 49561, 50134, 50708, 51284, 
  51862, 52442, 53023, 53605, 54190, 54776, 55364, 55953, 56544, 57136, 57731, 58326, 58924, 59523, 60123, 60725, 61329, 61934, 62540, 63148, 
  63758, 64369, 64982, 65596, 66212, 66829, 67448, 68068, 68690, 69313, 69937, 70563, 71191, 71820, 72450, 73082, 73715, 74349, 74985, 75623, 
  76261, 76902, 77543, 78186, 78830, 79476, 80123, 80771, 81421, 82072, 82725, 83378, 84033, 84690, 85348, 86007, 86667, 87329, 87992, 88656, 
  89322, 89988, 90657, 91326, 91997, 92669, 93342, 94016, 94692, 95369, 96047, 96727, 97407, 98089, 98773, 99457, 100143, 100830, 101518, 102207
];

const calculateLevel = (xp: number) => {
  let level = 1;
  for (let i = 0; i < LEVEL_THRESHOLDS.length; i++) {
    if (xp >= LEVEL_THRESHOLDS[i]) {
      level = i + 2; 
    } else {
      break;
    }
  }
  return Math.min(level, 200);
};

const getLevelProgress = (xp: number) => {
  const currentLevel = calculateLevel(xp);
  if (currentLevel >= 200) return { current: 1, max: 1, percent: 100 };
  
  const currentThreshold = currentLevel === 1 ? 0 : LEVEL_THRESHOLDS[currentLevel - 2];
  const nextThreshold = LEVEL_THRESHOLDS[currentLevel - 1];
  
  const progress = xp - currentThreshold;
  const totalInLevel = nextThreshold - currentThreshold;
  
  return {
    current: progress,
    total: totalInLevel,
    percent: Math.min(100, Math.max(0, (progress / totalInLevel) * 100))
  };
};

const STORAGE_KEYS = {
  PRODUCTS: (code: string) => `bioprizma_products_${code}`,
  DIET: (code: string) => `bioprizma_diet_${code}`,
  USER: (code: string) => `bioprizma_user_${code}`,
  ADVICE: (code: string) => `bioprizma_advice_${code}`,
  CURRENT_CODE: 'bioprizma_current_code'
};

const WATER_PRODUCT_ID = 'system-water-product';
const STEPS_PRODUCT_ID = 'system-steps-product';

const isSystemProduct = (id: string) => id === WATER_PRODUCT_ID || id === STEPS_PRODUCT_ID;

const WATER_PRODUCT: Product = {
  id: WATER_PRODUCT_ID,
  name: 'Вода',
  category: 'product',
  health_score: 100,
  nutrition: { calories: 0, protein: 0, fat: 0, carbs: 0 },
  ingredients: [],
  verdict: 'Чистая вода — основа здоровья и метаболизма.',
  warningType: 'none',
  createdAt: 0
};

const STEPS_PRODUCT: Product = {
  id: STEPS_PRODUCT_ID,
  name: 'Шаги',
  category: 'product',
  health_score: 100,
  nutrition: { calories: 0, protein: 0, fat: 0, carbs: 0 },
  ingredients: [],
  verdict: 'Движение — это жизнь и расход калорий.',
  warningType: 'none',
  createdAt: 0
};

// --- Warnings Modal ---
const WarningModal = ({ product, onClose }: { product: Product, onClose: () => void }) => {
  if (!product.warningType || product.warningType === 'none') return null;

  const config = {
    danger: {
      icon: <XCircle size={40} className="text-rose-500" />,
      bg: 'bg-rose-50',
      title: 'СМЕРТЕЛЬНО ОПАСНО',
      textColor: 'text-rose-600',
      btn: 'bg-rose-500 hover:bg-rose-600'
    },
    caution: {
      icon: <AlertTriangle size={40} className="text-amber-500" />,
      bg: 'bg-amber-50',
      title: 'НЕЖЕЛАТЕЛЬНО',
      textColor: 'text-amber-600',
      btn: 'bg-amber-500 hover:bg-amber-600'
    },
    info: {
      icon: <Info size={40} className="text-slate-500" />,
      bg: 'bg-slate-100',
      title: 'НЕ ЯВЛЯЕТСЯ ПИЩЕЙ',
      textColor: 'text-slate-600',
      btn: 'bg-slate-500 hover:bg-slate-600'
    }
  }[product.warningType as 'danger' | 'caution' | 'info'];

  return (
    <motion.div 
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[150] flex items-center justify-center p-6 bg-slate-900/80 backdrop-blur-md"
      onClick={onClose}
    >
      <motion.div 
        initial={{ scale: 0.9, y: 30 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, y: 30 }}
        className="bg-white rounded-[40px] p-8 w-full max-w-sm shadow-2xl space-y-6 text-center"
        onClick={e => e.stopPropagation()}
      >
        <div className={`w-20 h-20 ${config?.bg} rounded-[32px] flex items-center justify-center mx-auto`}>
          {config?.icon}
        </div>
        <div className="space-y-3">
          <h2 className={`text-xl font-black ${config?.textColor}`}>{config?.title}</h2>
          <p className="text-sm text-slate-500 font-medium leading-relaxed italic">
            "{product.warningMessage || "Этот продукт не пригоден для употребления в пищу."}"
          </p>
        </div>
        <button 
          onClick={onClose}
          className={`w-full ${config?.btn} text-white p-5 rounded-2xl font-black shadow-lg active:scale-95 transition-all uppercase tracking-widest text-xs`}
        >
          ПОНЯТНО
        </button>
      </motion.div>
    </motion.div>
  );
};

interface BalanceCardProps {
  title: string;
  stats: { cals: number; p: number; f: number; c: number; score: number };
  targets: { cals: number; p: number; f: number; c: number };
  isLocked: boolean;
  onOpenSetup: () => void;
  onShowDetails?: () => void;
}

const BalanceCard: React.FC<BalanceCardProps> = ({ 
  title, 
  stats, 
  targets, 
  isLocked, 
  onOpenSetup,
  onShowDetails
}) => {

  return (
    <section className="relative bg-slate-50 rounded-[32px] p-6 border border-slate-200 shadow-sm overflow-hidden min-h-[180px] w-full shrink-0">
      {isLocked && (
        <div className="absolute inset-0 z-30 backdrop-blur-md bg-slate-50/40 flex flex-col items-center justify-center p-6 text-center">
           <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center text-2xl shadow-md mb-3">🔒</div>
           <p className="text-[10px] font-black uppercase text-slate-500 mb-3 tracking-widest">Укажите данные профиля для расчета норм</p>
           <button 
             onClick={onOpenSetup}
             className="bg-emerald-500 text-white px-6 py-2.5 rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-lg shadow-emerald-200 active:scale-95 transition-all"
           >
             Настроить профиль
           </button>
        </div>
      )}
      <div className={`transition-all duration-500 ${isLocked ? 'blur-sm opacity-50' : 'opacity-100'}`}>
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-bold text-sm">{title}</h3>
          <span className={`font-bold text-xs ${stats.score >= 70 ? 'text-emerald-600' : 'text-amber-600'}`}>
            {stats.score >= 70 ? '🟢 Отлично' : stats.score >= 40 ? '🟡 Нормально' : '🔴 Сомнительно'}
          </span>
        </div>
        <div className="flex items-start gap-6">
          <div className="flex flex-col items-center gap-3 shrink-0 pt-1">
            <div className="relative w-24 h-24 flex items-center justify-center">
              <svg className="w-full h-full transform -rotate-90">
                <circle cx="48" cy="48" r="40" stroke="currentColor" strokeWidth="8" fill="transparent" className="text-slate-200" />
                <circle 
                  cx="48" cy="48" r="40" stroke="currentColor" strokeWidth="8" fill="transparent" 
                  strokeDasharray="251.2" 
                  strokeDashoffset={251.2 - (251.2 * stats.score) / 100} 
                  className="text-emerald-500 transition-all duration-1000" 
                />
              </svg>
              <div className="absolute flex flex-col items-center">
                <span className="text-2xl font-black">{stats.score}</span>
                <span className="text-[8px] text-slate-400 uppercase tracking-tight">Полезность</span>
              </div>
            </div>
          </div>
          <div className="flex-1 space-y-3 min-h-[100px]">
            <div>
              <div className="flex justify-between text-[11px] font-medium mb-1">
                <span>Белки</span>
                <span>{Math.round(stats.p)}г / {Math.round(targets.p)}г</span>
              </div>
              <ProgressBar value={stats.p} max={targets.p} color="bg-emerald-500" />
            </div>
            <div>
              <div className="flex justify-between text-[11px] font-medium mb-1">
                <span>Жиры</span>
                <span>{Math.round(stats.f)}г / {Math.round(targets.f)}г</span>
              </div>
              <ProgressBar value={stats.f} max={targets.f} color="bg-amber-400" />
            </div>
            <div>
              <div className="flex justify-between text-[11px] font-medium mb-1">
                <span>Углеводы</span>
                <span>{Math.round(stats.c)}г / {Math.round(targets.c)}г</span>
              </div>
              <ProgressBar value={stats.c} max={targets.c} color="bg-blue-500" />
              <div className="text-[11px] font-bold text-slate-400 text-center pt-3">
                Всего {Math.round(stats.cals)} ккал / {Math.round(targets.cals)}
              </div>
            </div>
          </div>
        </div>
      </div>

      {onShowDetails && (
        <button 
          onClick={onShowDetails}
          className="absolute bottom-4 left-4 flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-[9px] font-bold uppercase text-emerald-600 shadow-md hover:border-emerald-200 hover:shadow-lg active:scale-95 transition-all animate-in fade-in zoom-in duration-500 z-10"
        >
          <Sparkles size={12} />
          Подробнее
        </button>
      )}
    </section>
  );
};

const InfoTooltip = ({ text }: { text: string }) => {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div className="relative inline-block shrink-0">
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1 px-2 py-1 bg-slate-100 rounded-lg text-[10px] font-bold text-slate-500 hover:bg-slate-200 transition-colors whitespace-nowrap"
      >
        <HelpCircle size={10} />
        Как считаем?
      </button>
      <AnimatePresence>
        {isOpen && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.95, y: -5 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -5 }}
            className="absolute z-50 top-full right-0 mt-2 w-[220px] p-3 bg-slate-900 text-white text-[10px] rounded-xl shadow-2xl leading-relaxed origin-top-right"
          >
            <div className="absolute top-0 right-6 -translate-y-1/2 rotate-45 w-2 h-2 bg-slate-900" />
            {text}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const LongTermAnalysisModal = ({ 
  periodTitle, 
  analysis, 
  isLoading, 
  onClose 
}: { 
  periodTitle: string; 
  analysis: LongTermAnalysis | null; 
  isLoading: boolean; 
  onClose: () => void 
}) => {
  return (
    <motion.div 
      initial={{ opacity: 0 }} 
      animate={{ opacity: 1 }} 
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[150] bg-slate-900/60 backdrop-blur-sm flex items-end sm:items-center justify-center"
      onClick={onClose}
    >
      <motion.div 
        initial={{ y: '100%' }} 
        animate={{ y: 0 }} 
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className="bg-white w-full max-w-2xl h-[90vh] sm:h-[80vh] rounded-t-[40px] sm:rounded-[40px] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-6 border-b border-slate-100 flex items-start justify-between shrink-0">
          <div className="min-w-0 pr-4">
            <h2 className="text-lg sm:text-xl font-black text-slate-900 flex items-center gap-2 flex-wrap leading-tight">
              <Sparkles className="text-emerald-500 shrink-0" size={20} />
              Анализ: {periodTitle}
            </h2>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Отчет нутрициолога</p>
          </div>
          <button onClick={onClose} className="p-2 bg-slate-100 rounded-full text-slate-400 hover:text-slate-600 transition-colors shrink-0">
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-8 scrollbar-hide">
          {isLoading ? (
            <div className="h-full flex flex-col items-center justify-center space-y-4 py-20">
              <div className="relative">
                <Loader2 size={48} className="text-emerald-500 animate-spin" />
                <Sparkles size={20} className="text-amber-400 absolute -top-1 -right-1 animate-pulse" />
              </div>
              <div className="text-center space-y-1">
                <p className="font-black text-slate-900">ИИ анализирует ваш рацион...</p>
                <p className="text-xs text-slate-400 font-bold px-10 leading-relaxed italic">
                  Мы изучаем ваши пищевые привычки и готовим персональные рекомендации.
                </p>
              </div>
            </div>
          ) : analysis ? (
            <div className="space-y-6">
              <section className="space-y-3">
                <div className="p-5 bg-blue-50/30 rounded-3xl border border-blue-50">
                  <p className="text-sm leading-relaxed text-slate-600 italic whitespace-pre-wrap">{analysis.intro}</p>
                </div>
              </section>

              <section className="space-y-3">
                <div className="flex items-center justify-between gap-3 min-w-0">
                  <div className="flex items-center gap-2 min-w-0 overflow-hidden">
                    <div className="w-8 h-8 bg-emerald-50 text-emerald-500 rounded-lg flex items-center justify-center shrink-0">
                      <Target size={18} />
                    </div>
                    <h3 className="font-black text-[10px] sm:text-xs uppercase tracking-tight text-slate-800 truncate">✅ Что было хорошо</h3>
                  </div>
                </div>
                <div className="p-5 bg-emerald-50/30 rounded-3xl border border-emerald-50">
                  <p className="text-sm leading-relaxed text-slate-600 italic whitespace-pre-wrap">{analysis.what_was_good}</p>
                </div>
              </section>

              <section className="space-y-3">
                <div className="flex items-center justify-between gap-3 min-w-0">
                  <div className="flex items-center gap-2 min-w-0 overflow-hidden">
                    <div className="w-8 h-8 bg-amber-50 text-amber-500 rounded-lg flex items-center justify-center shrink-0">
                      <AlertCircle size={18} />
                    </div>
                    <h3 className="font-black text-[10px] sm:text-xs uppercase tracking-tight text-slate-800 truncate">⚠️ На что аккуратно смотреть</h3>
                  </div>
                </div>
                <div className="p-5 bg-amber-50/30 rounded-3xl border border-amber-50">
                  <p className="text-sm leading-relaxed text-slate-600 italic whitespace-pre-wrap">{analysis.what_to_watch}</p>
                </div>
              </section>

              <section className="space-y-3">
                <div className="flex items-center justify-between gap-3 min-w-0">
                  <div className="flex items-center gap-2 min-w-0 overflow-hidden">
                    <div className="w-8 h-8 bg-purple-50 text-purple-500 rounded-lg flex items-center justify-center shrink-0">
                      <TrendingUp size={18} />
                    </div>
                    <h3 className="font-black text-[10px] sm:text-xs uppercase tracking-tight text-slate-800 truncate">📌 Как использовать этот день</h3>
                  </div>
                </div>
                <div className="p-5 bg-purple-50/30 rounded-3xl border border-purple-50">
                  <p className="text-sm leading-relaxed text-slate-600 italic whitespace-pre-wrap">{analysis.how_to_use}</p>
                </div>
              </section>
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center p-10 space-y-4">
              <div className="w-20 h-20 bg-slate-50 text-slate-300 rounded-full flex items-center justify-center mb-2">
                <AlertCircle size={40} />
              </div>
              <p className="text-slate-400 text-sm font-medium italic">Ошибка при загрузке анализа. Попробуйте еще раз.</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-slate-50 shrink-0">
          <button 
            onClick={onClose}
            className="w-full bg-slate-900 text-white p-4 rounded-2xl font-black shadow-lg shadow-slate-200 active:scale-95 transition-all text-xs uppercase tracking-widest"
          >
            Закрыть
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
};

const StatsModal = ({ 
  type, 
  diet, 
  user, 
  onClose 
}: { 
  type: 'water' | 'steps'; 
  diet: DietEntry[]; 
  user: UserProfile; 
  onClose: () => void 
}) => {
  const [viewDate, setViewDate] = useState(new Date());
  const [yearDate, setYearDate] = useState(new Date());

  const currentGoal = type === 'water' 
    ? (user.bio?.waterTarget || calculateDefaultWater(user.bio))
    : (user.bio?.stepsTarget || calculateDefaultSteps(user.bio));

  const entries = diet.filter(d => type === 'water' ? (d.water_ml || 0) > 0 : (d.steps_count || 0) > 0);
  
  // Day stats calculation for current month view
  const currentMonth = viewDate.getMonth();
  const currentYear = viewDate.getFullYear();
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  
  const dailyData = Array.from({ length: daysInMonth }, (_, i) => {
    const day = i + 1;
    const dateStr = new Date(currentYear, currentMonth, day).toDateString();
    const dayTotal = entries
      .filter(d => new Date(d.timestamp).toDateString() === dateStr)
      .reduce((sum, d) => sum + (type === 'water' ? (d.water_ml || 0) : (d.steps_count || 0)), 0);
    return { day, value: dayTotal };
  });

  // Global Calculation
  const allDayStats = entries.reduce((acc, curr) => {
    const day = new Date(curr.timestamp).toDateString();
    if (!acc[day]) acc[day] = 0;
    acc[day] += (type === 'water' ? (curr.water_ml || 0) : (curr.steps_count || 0));
    return acc;
  }, {} as Record<string, number>);

  const allValues = Object.values(allDayStats);
  const totalAllTime = allValues.reduce((sum, v) => sum + v, 0);
  const avgDailyAllTime = allValues.length > 0 ? totalAllTime / allValues.length : 0;
  
  const monthsArr = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];

  // Anomalies (Global)
  const sortedDaysAll = Object.entries(allDayStats).sort((a, b) => a[1] - b[1]);
  const minDayGlobal = sortedDaysAll[0];
  const maxDayGlobal = sortedDaysAll[sortedDaysAll.length - 1];

  const formatDateShort = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  };

  const changeMonth = (delta: number) => {
    setViewDate(prev => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[150] bg-slate-900/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-6"
      onClick={onClose}
    >
      <motion.div 
        initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className="bg-white w-full max-w-lg h-[90vh] sm:h-auto sm:max-h-[85vh] rounded-t-[40px] sm:rounded-[40px] overflow-hidden flex flex-col shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-6 border-b border-slate-100 flex items-center justify-between shrink-0 bg-white">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-2xl flex items-center justify-center ${type === 'water' ? 'bg-blue-50 text-blue-500' : 'bg-orange-50 text-orange-500'}`}>
              {type === 'water' ? <Droplets size={20} /> : <Footprints size={20} />}
            </div>
            <div>
              <h2 className="text-lg font-black">{type === 'water' ? 'Статистика воды' : 'Статистика шагов'}</h2>
            </div>
          </div>
          <button onClick={onClose} className="p-2 bg-slate-100 rounded-full text-slate-400 hover:text-slate-600 transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-8 scrollbar-hide pb-12">
          {type === 'water' ? (
            <>
              {/* Global Highlights for Water */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-slate-50/80 p-4 rounded-3xl border border-slate-100 shadow-sm">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1">Среднесуточно</p>
                  <div className="flex items-baseline gap-1">
                    <span className="text-2xl font-black">{Math.round(avgDailyAllTime)}</span>
                    <span className="text-[12px] font-bold text-slate-500">мл</span>
                  </div>
                  <div className="mt-2 h-1 w-12 bg-slate-200 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-blue-400" 
                      style={{ width: `${Math.min(100, (avgDailyAllTime / currentGoal) * 100)}%` }}
                    />
                  </div>
                </div>
                <div className="bg-slate-50/80 p-4 rounded-3xl border border-slate-100 shadow-sm">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1">Всего выпито</p>
                  <div className="flex items-baseline gap-1">
                    <span className="text-2xl font-black">
                      {totalAllTime >= 1000 ? (totalAllTime/1000).toFixed(1) : totalAllTime}
                    </span>
                    <span className="text-[12px] font-bold text-slate-500">
                      {totalAllTime >= 1000 ? 'л' : 'мл'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="bg-blue-50/40 p-5 rounded-3xl border border-blue-100/50 flex items-center justify-between">
                <div className="space-y-1">
                  <p className="text-[10px] font-black text-blue-400 uppercase tracking-wider">Средний прогресс</p>
                  <p className="text-2xl font-black text-blue-600">{Math.round((avgDailyAllTime / currentGoal) * 100)}% <span className="text-xs font-bold text-blue-400 lowercase">от цели {currentGoal}</span></p>
                </div>
                <Target className="text-blue-200" size={40} />
              </div>

              {/* Month Navigation & Daily Detail Chart for Water */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-black text-slate-800 uppercase tracking-widest flex items-center gap-2">
                    <CalendarDays size={14} className="text-blue-500" />
                    Детально по дням
                  </h3>
                  <div className="flex items-center gap-2 bg-slate-100 p-1 rounded-xl">
                    <button onClick={() => changeMonth(-1)} className="p-1 hover:bg-white rounded-lg transition-colors"><ChevronLeft size={16} /></button>
                    <span className="text-[11px] font-black px-2 min-w-[100px] text-center uppercase tracking-widest">
                      {viewDate.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })}
                    </span>
                    <button onClick={() => changeMonth(1)} className="p-1 hover:bg-white rounded-lg transition-colors"><ChevronRight size={16} /></button>
                  </div>
                </div>
                
                <div className="h-56 w-full bg-slate-50 rounded-3xl p-4 border border-slate-100 shadow-inner">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={dailyData}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                      <XAxis 
                        dataKey="day" 
                        axisLine={false} 
                        tickLine={false} 
                        interval={daysInMonth > 15 ? 4 : 2}
                        tick={{ fontSize: 9, fontWeight: 'bold', fill: '#94a3b8' }} 
                      />
                      <ChartTooltip 
                        content={({ active, payload }) => {
                          if (active && payload && payload.length) {
                            return (
                              <div className="bg-slate-900 text-white text-[10px] font-bold p-3 rounded-2xl border border-white/10 shadow-2xl">
                                 День {payload[0].payload.day}: <span className="text-emerald-400">{payload[0].value} мл</span>
                              </div>
                            );
                          }
                          return null;
                        }}
                      />
                      <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                        {dailyData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.value >= currentGoal ? '#3b82f6' : '#cbd5e1'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Seasonal View for Water */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-black text-slate-800 uppercase tracking-widest flex items-center gap-2">
                    <TrendingUp size={14} className="text-blue-500" />
                    Сезонные колебания
                  </h3>
                  <div className="flex items-center gap-2 bg-slate-100 p-1 rounded-xl">
                    <button onClick={() => setYearDate(prev => new Date(prev.getFullYear() - 1, 0, 1))} className="p-1 hover:bg-white rounded-lg transition-colors"><ChevronLeft size={14} /></button>
                    <span className="text-[10px] font-black px-2 min-w-[50px] text-center uppercase tracking-widest">
                      {yearDate.getFullYear()}
                    </span>
                    <button onClick={() => setYearDate(prev => new Date(prev.getFullYear() + 1, 0, 1))} className="p-1 hover:bg-white rounded-lg transition-colors"><ChevronRight size={14} /></button>
                  </div>
                </div>
                <div className="h-44 w-full bg-slate-50 rounded-3xl p-4 border border-slate-100">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={monthsArr.map((name, i) => ({
                      name,
                      value: entries
                        .filter(d => new Date(d.timestamp).getMonth() === i && new Date(d.timestamp).getFullYear() === yearDate.getFullYear())
                        .reduce((sum, d) => sum + (d.water_ml || 0), 0)
                    }))}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                      <XAxis 
                        dataKey="name" 
                        axisLine={false} 
                        tickLine={false} 
                        interval={0}
                        tick={{ fontSize: 9, fontWeight: 'bold', fill: '#94a3b8' }} 
                      />
                      <ChartTooltip 
                         content={({ active, payload }) => {
                          if (active && payload && payload.length) {
                            return (
                              <div className="bg-slate-900 text-white text-[10px] font-bold p-2 rounded-xl border border-white/10 shadow-xl">
                                {payload[0].value} мл
                              </div>
                            );
                          }
                          return null;
                        }}
                      />
                      <Bar dataKey="value" fill="#93c5fd" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <p className="text-[10px] text-slate-400 font-bold italic text-center px-4 leading-relaxed">
                  Летом потребление воды обычно выше на 20-30%, следите за гидратацией!
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 bg-slate-50/80 rounded-3xl border border-slate-100">
                  <div className="flex items-center gap-2 mb-2">
                    <TrendingDown size={14} className="text-rose-400" />
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Минимум</span>
                  </div>
                  <p className="text-xl font-black">{minDayGlobal ? minDayGlobal[1] : 0} <span className="text-[10px] font-bold text-slate-500">мл</span></p>
                  <p className="text-[10px] font-extrabold text-slate-400 mt-0.5">{minDayGlobal ? formatDateShort(minDayGlobal[0]) : 'Нет данных'}</p>
                </div>
                <div className="p-4 bg-slate-50/80 rounded-3xl border border-slate-100">
                  <div className="flex items-center gap-2 mb-2">
                    <TrendingUp size={14} className="text-emerald-400" />
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Личный рекорд</span>
                  </div>
                  <p className="text-xl font-black">{maxDayGlobal ? maxDayGlobal[1] : 0} <span className="text-[10px] font-bold text-slate-500">мл</span></p>
                  <p className="text-[10px] font-extrabold text-slate-400 mt-0.5">{maxDayGlobal ? formatDateShort(maxDayGlobal[0]) : 'Нет данных'}</p>
                </div>
              </div>
            </>
          ) : (
            <div className="space-y-6">
              <div className="bg-orange-50/50 p-5 rounded-3xl border border-orange-100 flex items-center justify-between shadow-sm">
                <div className="space-y-1">
                  <p className="text-[10px] font-black text-orange-400 uppercase tracking-wider">Общая дистанция</p>
                  <p className="text-2xl font-black text-orange-600">{Math.round(totalAllTime / 1400)} <span className="text-xs font-bold text-orange-400">км</span></p>
                  <p className="text-[10px] font-bold text-orange-700 italic leading-snug max-w-[200px]">
                    {totalAllTime >= 2500000 ? "Вы превзошли путь от Москвы до Берлина!" : 
                     totalAllTime >= 1000000 ? "Вы прошли более 700 км! Это путь от Москвы до Питера." : 
                     "Продолжайте идти, каждый шаг приближает к цели!"}
                  </p>
                </div>
                <MapPin className="text-orange-200" size={48} />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 bg-slate-50 rounded-3xl border border-slate-100 shadow-sm">
                  <div className="flex items-center gap-2 mb-2">
                    <Award size={14} className="text-amber-500" />
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Рекорд года</span>
                  </div>
                  <p className="text-lg font-black">{(maxDayGlobal ? maxDayGlobal[1] : 0).toLocaleString('ru-RU')} <span className="text-[10px] font-bold text-slate-500">ш</span></p>
                  <p className="text-[10px] font-bold text-slate-500 mt-0.5">{maxDayGlobal ? formatDateShort(maxDayGlobal[0]) : 'Нет данных'}</p>
                </div>
                <div className="p-4 bg-slate-50 rounded-3xl border border-slate-100 shadow-sm">
                  <div className="flex items-center gap-2 mb-2">
                    <CalendarDays size={14} className="text-slate-400" />
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Спад активности</span>
                  </div>
                  <p className="text-lg font-black">{minDayGlobal ? minDayGlobal[1].toLocaleString('ru-RU') : 0} <span className="text-[10px] font-bold">ш</span></p>
                  <p className="text-[10px] font-bold text-slate-500 mt-0.5">В самый ленивый день</p>
                </div>
              </div>

              <div className="bg-slate-50 p-5 rounded-3xl border border-slate-100 shadow-sm">
                <div className="flex items-center gap-2 mb-4">
                  <Target size={16} className="text-emerald-500" />
                  <h3 className="text-xs font-black text-slate-800 uppercase tracking-widest">Постоянство</h3>
                </div>
                <div className="flex items-end gap-2 mb-2">
                  <span className="text-4xl font-black text-emerald-500">
                    {Object.keys(allDayStats).filter(d => allDayStats[d] >= currentGoal).length}
                  </span>
                  <span className="text-xs font-bold text-slate-400 mb-1.5">дней закрыта цель в {currentGoal} ш</span>
                </div>
                <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
                  <motion.div 
                    initial={{ width: 0 }}
                    animate={{ width: `${(Object.keys(allDayStats).filter(d => allDayStats[d] >= currentGoal).length / Math.max(1, Object.keys(allDayStats).length)) * 100}%` }}
                    className="bg-emerald-500 h-full"
                  />
                </div>
                <p className="text-[10px] font-bold text-slate-400 mt-3 text-center">
                  Это {Math.round((Object.keys(allDayStats).filter(d => allDayStats[d] >= currentGoal).length / Math.max(1, Object.keys(allDayStats).length)) * 100)}% от всех дней активности
                </p>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-black text-slate-800 uppercase tracking-widest flex items-center gap-2">
                    <TrendingUp size={14} className="text-orange-500" />
                    Сезонные колебания
                  </h3>
                  <div className="flex items-center gap-2 bg-slate-100 p-1 rounded-xl">
                    <button onClick={() => setYearDate(prev => new Date(prev.getFullYear() - 1, 0, 1))} className="p-1 hover:bg-white rounded-lg transition-colors"><ChevronLeft size={14} /></button>
                    <span className="text-[10px] font-black px-2 min-w-[50px] text-center uppercase tracking-widest">
                      {yearDate.getFullYear()}
                    </span>
                    <button onClick={() => setYearDate(prev => new Date(prev.getFullYear() + 1, 0, 1))} className="p-1 hover:bg-white rounded-lg transition-colors"><ChevronRight size={14} /></button>
                  </div>
                </div>
                <div className="h-44 w-full bg-slate-50 rounded-3xl p-4 border border-slate-100 shadow-sm">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={monthsArr.map((name, i) => ({
                      name,
                      value: entries
                        .filter(d => new Date(d.timestamp).getMonth() === i && new Date(d.timestamp).getFullYear() === yearDate.getFullYear())
                        .reduce((sum, d) => sum + (d.steps_count || 0), 0)
                    }))}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                      <XAxis dataKey="name" axisLine={false} tickLine={false} interval={0} tick={{ fontSize: 9, fontWeight: 'bold', fill: '#94a3b8' }} />
                      <ChartTooltip content={({ active, payload }) => (active && payload?.[0]) ? <div className="bg-slate-900 text-white text-[10px] font-bold p-2 rounded-xl">{payload[0].value} ш</div> : null} />
                      <Bar dataKey="value" fill="#fdba74" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-slate-50 bg-white">
          <button 
            onClick={onClose}
            className={`w-full p-4 rounded-2xl font-black text-white shadow-xl active:scale-95 transition-all uppercase tracking-widest text-xs ${type === 'water' ? 'bg-blue-500 shadow-blue-100' : 'bg-orange-500 shadow-orange-100'}`}
          >
            Вернуться в дневник
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
};

const ProgressRing = ({ value, max, color, icon: Icon }: { value: number, max: number, color: string, icon: any }) => {
  const radius = 37;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.min(value / max, 1) * circumference);
  
  return (
    <div className="relative w-20 h-20 flex items-center justify-center mx-auto">
      <svg className="w-full h-full -rotate-90">
        <circle cx="40" cy="40" r={radius} fill="transparent" stroke="currentColor" strokeWidth="5" className="text-slate-100" />
        <motion.circle 
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1, ease: "easeOut" }}
          cx="40" cy="40" r={radius} fill="transparent" stroke="currentColor" strokeWidth="5" 
          strokeDasharray={circumference} className={color} strokeLinecap="round" 
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-slate-400">
        <Icon size={24} className={value >= max ? color : 'text-slate-200'} />
      </div>
    </div>
  );
};

const Dashboard: React.FC<{ 
  diet: DietEntry[], 
  user: UserProfile, 
  setActiveTab: (t: any) => void, 
  aiAdvice: string, 
  isAdviceLoading: boolean, 
  fetchAdvice: () => void, 
  onOpenSetup: () => void, 
  addDietEntry: (id: string, g: number, m: MealType) => void, 
  setDiet: (d: any) => void,
  setSelectedProduct: (p: Product) => void,
  setShowInstructions?: (show: boolean) => void
}> = ({ diet, user, setActiveTab, aiAdvice, isAdviceLoading, fetchAdvice, onOpenSetup, addDietEntry, setDiet, setSelectedProduct, setShowInstructions }) => {
  const isLocked = !user.bio || !user.goals;
  const balanceScroll = useDragScroll();
  
  const [analysisModal, setAnalysisModal] = useState<{ 
    isOpen: boolean; 
    periodTitle: string; 
    analysis: LongTermAnalysis | null; 
    isLoading: boolean;
    cache: Record<string, { analysis: LongTermAnalysis; count: number }>;
  }>(() => {
    const savedCache = localStorage.getItem('diet_analysis_cache');
    return {
      isOpen: false,
      periodTitle: '',
      analysis: null,
      isLoading: false,
      cache: savedCache ? JSON.parse(savedCache) : {}
    };
  });

  const [statsModal, setStatsModal] = useState<'water' | 'steps' | null>(null);

  useEffect(() => {
    localStorage.setItem('diet_analysis_cache', JSON.stringify(analysisModal.cache));
  }, [analysisModal.cache]);

  const handleShowDetails = async (period: { id: string; title: string; days: number }) => {
    // Check if we have a cached analysis for this period with the same number of entries
    if (analysisModal.cache[period.id] && analysisModal.cache[period.id].count === diet.length) {
      setAnalysisModal(prev => ({ 
        ...prev, 
        isOpen: true, 
        periodTitle: period.title, 
        analysis: prev.cache[period.id].analysis, 
        isLoading: false 
      }));
      return;
    }

    setAnalysisModal(prev => ({ ...prev, isOpen: true, periodTitle: period.title, analysis: null, isLoading: true }));
    try {
      let entries: DietEntry[] = [];
      if (period.days === 1) {
        const today = new Date().toDateString();
        entries = diet.filter(d => new Date(d.timestamp).toDateString() === today);
      } else if (period.days === 0) {
        entries = diet;
      } else {
        const now = new Date();
        now.setHours(23, 59, 59, 999);
        const startTime = now.getTime() - (period.days * 24 * 60 * 60 * 1000);
        entries = diet.filter(d => d.timestamp >= startTime);
      }
      const analysis = await analyzeLongTermDiet(entries, period.title, user);
      
      setAnalysisModal(prev => ({ 
        ...prev, 
        analysis, 
        isLoading: false,
        cache: {
          ...prev.cache,
          [period.id]: { analysis, count: diet.length }
        }
      }));
    } catch (error) {
      setAnalysisModal(prev => ({ ...prev, isLoading: false }));
    }
  };
  const today = new Date().toDateString();
  const todayEntries = diet.filter(d => new Date(d.timestamp).toDateString() === today);
  const visibleTodayEntries = todayEntries.filter(entry => {
    const isWaterEntry = entry.mealType === 'water' || !!entry.water_ml;
    const isStepsEntry = entry.mealType === 'steps' || !!entry.steps_count;
    if (isWaterEntry && user.settings?.trackWater === false) return false;
    if (isStepsEntry && user.settings?.trackSteps === false) return false;
    return true;
  });
  const waterProgress = todayEntries.reduce((sum, d) => sum + Number(d.water_ml || 0), 0);
  const stepsProgress = todayEntries.reduce((sum, d) => sum + Number(d.steps_count || 0), 0);
  
  const waterTarget = user.bio?.waterTarget || calculateDefaultWater(user.bio);
  const stepsTarget = user.bio?.stepsTarget || calculateDefaultSteps(user.bio);

  const getStatsForPeriod = (days: number) => {
    const now = new Date();
    now.setHours(23, 59, 59, 999); // End of today
    
    let entries: DietEntry[] = [];
    let divider = 1;

    if (days === 1) {
      // Specifically today
      const today = new Date().toDateString();
      entries = diet.filter(d => new Date(d.timestamp).toDateString() === today);
      divider = 1;
    } else {
      if (days === 0) {
        // All time
        entries = diet;
      } else {
        // Month or Year
        const startTime = now.getTime() - (days * 24 * 60 * 60 * 1000);
        entries = diet.filter(d => d.timestamp >= startTime);
      }
      
      // Calculate divider based on unique days with entries
      if (entries.length > 0) {
        const uniqueDays = new Set(entries.map(d => new Date(d.timestamp).toDateString()));
        divider = Math.max(1, uniqueDays.size);
      } else {
        divider = 1;
      }
    }

    const totalCals = entries.reduce((sum, d) => sum + d.calories, 0);
    const totalP = entries.reduce((sum, d) => sum + d.protein, 0);
    const totalF = entries.reduce((sum, d) => sum + d.fat, 0);
    const totalC = entries.reduce((sum, d) => sum + d.carbs, 0);
    const scoreEntries = entries.filter(d => typeof d.health_score === 'number' && d.mealType !== 'water' && d.mealType !== 'steps');
    const avgScore = scoreEntries.length > 0
      ? Math.round(scoreEntries.reduce((sum, d) => sum + (d.health_score || 0), 0) / scoreEntries.length)
      : 0;

    return {
      stats: { 
        cals: totalCals / divider, 
        p: totalP / divider, 
        f: totalF / divider, 
        c: totalC / divider, 
        score: avgScore 
      },
      targets: {
        cals: (user.goals?.calories || 2000),
        p: (user.goals?.protein || 90),
        f: (user.goals?.fat || 60),
        c: (user.goals?.carbs || 200),
      }
    };
  };

  const periods = [
    { id: 'day', title: 'Дневной баланс', days: 1 },
    { id: 'month', title: 'Месячный баланс', days: 30 },
    { id: 'year', title: 'Годовой баланс', days: 365 },
    { id: 'all', title: 'Баланс за все время', days: 0 },
  ];

  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);

  const checkScroll = () => {
    if (balanceScroll.ref.current) {
      const { scrollLeft, scrollWidth, clientWidth } = balanceScroll.ref.current;
      setCanScrollLeft(scrollLeft > 10);
      setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 10);
    }
  };

  useEffect(() => {
    checkScroll();
    const container = balanceScroll.ref.current;
    if (container) {
      container.addEventListener('scroll', checkScroll);
    }
    return () => container?.removeEventListener('scroll', checkScroll);
  }, []);

  const scrollRight = () => {
    if (balanceScroll.ref.current) {
      balanceScroll.ref.current.scrollBy({ left: 343, behavior: 'smooth' });
    }
  };

  const scrollBack = () => {
    if (balanceScroll.ref.current) {
      balanceScroll.ref.current.scrollBy({ left: -343, behavior: 'smooth' });
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -15 }}
      transition={{ duration: 0.2, ease: "circOut" }}
      className="space-y-6 pb-24"
    >
      {/* Scrollable Balance Cards */}
      <div className="relative group/nav">
        <div 
          ref={balanceScroll.ref}
          className="flex gap-4 overflow-x-auto scrollbar-hide select-none snap-x snap-mandatory scroll-smooth"
        >
          {periods.map(period => {
            const { stats, targets } = getStatsForPeriod(period.days);
            return (
              <div key={period.id} className="snap-center shrink-0 w-full">
                <BalanceCard 
                  title={period.title}
                  stats={stats}
                  targets={targets}
                  isLocked={isLocked}
                  onOpenSetup={onOpenSetup}
                  onShowDetails={() => handleShowDetails(period)}
                />
              </div>
            );
          })}
        </div>

        <AnimatePresence>
          {analysisModal.isOpen && (
            <LongTermAnalysisModal 
              periodTitle={analysisModal.periodTitle}
              analysis={analysisModal.analysis}
              isLoading={analysisModal.isLoading}
              onClose={() => setAnalysisModal(prev => ({ ...prev, isOpen: false }))}
            />
          )}
          {statsModal && (
            <StatsModal 
              type={statsModal}
              diet={diet}
              user={user}
              onClose={() => setStatsModal(null)}
            />
          )}
        </AnimatePresence>

        {/* Scroll Navigation Buttons */}
        <AnimatePresence>
          {canScrollLeft && (
            <motion.button 
              initial={{ opacity: 0, scale: 0.5, x: -20 }}
              animate={{ opacity: 1, scale: 1, x: 0 }}
              exit={{ opacity: 0, scale: 0.5, x: -20 }}
              onClick={scrollBack}
              className="absolute left-0 top-1/2 -translate-y-1/2 z-10 bg-white/90 backdrop-blur-md border border-slate-100 p-1 rounded-full shadow-lg text-slate-400 hover:text-emerald-500 -translate-x-3/4 transition-all hover:scale-110 active:scale-95 flex items-center justify-center"
            >
              <ChevronLeft size={14} />
            </motion.button>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {canScrollRight && (
            <motion.button 
              initial={{ opacity: 0, scale: 0.5, x: 20 }}
              animate={{ opacity: 1, scale: 1, x: 0 }}
              exit={{ opacity: 0, scale: 0.5, x: 20 }}
              onClick={scrollRight}
              className="absolute right-0 top-1/2 -translate-y-1/2 z-10 bg-white/90 backdrop-blur-md border border-slate-100 p-1 rounded-full shadow-lg text-slate-400 hover:text-emerald-500 translate-x-3/4 transition-all hover:scale-110 active:scale-95 flex items-center justify-center"
            >
              <ChevronRight size={14} />
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {/* Dynamic Health Goals Section */}
      {(user.settings?.trackWater !== false || user.settings?.trackSteps !== false) && (
        <div className={`grid ${user.settings?.trackWater !== false && user.settings?.trackSteps !== false ? 'grid-cols-2' : 'grid-cols-1'} gap-4`}>
          {/* Water Goal Card */}
          {user.settings?.trackWater !== false && (
            <div 
              onClick={() => !isLocked && setStatsModal('water')}
              className="bg-white rounded-[32px] p-5 border border-slate-100 shadow-sm flex flex-col justify-between h-44 relative overflow-hidden transition-all active:scale-[0.98] cursor-pointer hover:border-blue-100 hover:shadow-blue-50"
            >
              {isLocked && (
                <div className="absolute inset-0 z-30 backdrop-blur-md bg-white/40 flex items-center justify-center p-6 text-center">
                   <div className="w-10 h-10 shrink-0 aspect-square bg-white rounded-xl flex items-center justify-center text-xl shadow-md border border-slate-100">🔒</div>
                </div>
              )}
              <div className={`flex-1 flex items-center justify-center pt-2 transition-all duration-500 ${isLocked ? 'blur-sm opacity-50' : 'opacity-100'}`}>
                <ProgressRing value={waterProgress} max={waterTarget} color="text-blue-500" icon={Droplets} />
              </div>
              <div className={`mt-auto transition-all duration-500 ${isLocked ? 'blur-sm opacity-0 pointer-events-none' : 'opacity-100'}`}>
                <div className="flex items-baseline flex-wrap gap-x-1 leading-none">
                  <span className="text-lg sm:text-xl font-black text-slate-900 line-clamp-1">{waterProgress}</span>
                  <span className="text-[9px] sm:text-[10px] font-bold text-slate-400 whitespace-nowrap">/ {waterTarget} мл</span>
                </div>
                {!isLocked && <p className="text-[10px] font-bold text-slate-500 leading-tight mt-1">Норма воды сегодня</p>}
              </div>
            </div>
          )}

          {/* Steps Goal Card */}
          {user.settings?.trackSteps !== false && (
            <div 
              onClick={() => !isLocked && setStatsModal('steps')}
              className="bg-white rounded-[32px] p-5 border border-slate-100 shadow-sm flex flex-col justify-between h-44 relative overflow-hidden transition-all active:scale-[0.98] cursor-pointer hover:border-orange-100 hover:shadow-orange-50"
            >
              {isLocked && (
                <div className="absolute inset-0 z-30 backdrop-blur-md bg-white/40 flex items-center justify-center p-6 text-center">
                   <div className="w-10 h-10 shrink-0 aspect-square bg-white rounded-xl flex items-center justify-center text-xl shadow-md border border-slate-100">🔒</div>
                </div>
              )}
              <div className={`flex-1 flex items-center justify-center pt-2 transition-all duration-500 ${isLocked ? 'blur-sm opacity-50' : 'opacity-100'}`}>
                <ProgressRing value={stepsProgress} max={stepsTarget} color="text-orange-500" icon={Footprints} />
              </div>
              <div className={`mt-auto transition-all duration-500 ${isLocked ? 'blur-sm opacity-0 pointer-events-none' : 'opacity-100'}`}>
                <div className="flex items-baseline flex-wrap gap-x-1 leading-none">
                  <span className="text-lg sm:text-xl font-black text-slate-900 line-clamp-1">{stepsProgress}</span>
                  <span className="text-[9px] sm:text-[10px] font-bold text-slate-400 whitespace-nowrap">/ {stepsTarget} ш</span>
                </div>
                {!isLocked && <p className="text-[10px] font-bold text-slate-500 leading-tight mt-1">Ваша активность</p>}
              </div>
            </div>
          )}
        </div>
      )}

      {/* AI Advice - Perfectly centered between sections with tighter spacing */}
      <section className="bg-emerald-600 rounded-3xl p-5 text-white shadow-lg relative overflow-hidden group">
        <div className="relative z-10">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="flex items-center gap-2">
              <div className="bg-white/20 p-1 rounded-md text-[10px] font-bold uppercase tracking-wider">AI Диетолог</div>
              <span className="text-xs opacity-90">Сейчас</span>
            </div>
            <button 
              onClick={fetchAdvice} 
              disabled={isAdviceLoading}
              className={`p-1.5 rounded-full hover:bg-white/10 transition-colors ${isAdviceLoading ? 'opacity-30' : 'opacity-100'}`}
            >
              <RotateCcw size={14} className={isAdviceLoading ? 'animate-spin' : ''} />
            </button>
          </div>
          <p className={`text-sm font-medium leading-relaxed italic transition-opacity duration-300 ${isAdviceLoading ? 'opacity-70 animate-pulse' : 'opacity-100'}`}>
            "{aiAdvice}"
          </p>
        </div>
        <div className="absolute -right-4 -bottom-4 w-24 h-24 bg-white/10 rounded-full blur-2xl group-hover:scale-150 transition-transform"></div>
      </section>



      {/* Quick Links / Menu */}
      <div className="grid grid-cols-1 gap-3">
        <button 
          onClick={() => setShowInstructions?.(true)}
          className="flex items-center gap-3 p-4 bg-white border border-slate-100 rounded-2xl shadow-sm hover:bg-slate-50 transition-colors w-full"
        >
          <div className="w-8 h-8 bg-amber-50 text-amber-500 rounded-lg flex items-center justify-center">
            <Info size={18} />
          </div>
          <span className="text-xs font-bold">Инструкция по использованию</span>
        </button>
      </div>

      {/* Recent Activity */}
      <section className="space-y-3">
        <div className="flex justify-between items-end px-1">
          <h3 className="font-bold text-sm">Рацион сегодня</h3>
          <button onClick={() => setActiveTab('diet')} className="text-emerald-600 text-[11px] font-semibold">Весь список →</button>
        </div>
        {visibleTodayEntries.length === 0 ? (
          <div className="text-center py-8 text-slate-400 text-sm italic">Вы еще ничего не ели сегодня</div>
        ) : (
          <div className="space-y-2">
            {[...visibleTodayEntries].reverse().slice(0, 3).map(entry => {
              const isWaterEntry = entry.mealType === 'water' || !!entry.water_ml;
              const isStepsEntry = entry.mealType === 'steps' || !!entry.steps_count;
              return (
                <div key={entry.id} className="flex items-center justify-between p-3 bg-white border border-slate-100 rounded-2xl shadow-sm">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 shrink-0 aspect-square rounded-2xl flex items-center justify-center text-lg ${isWaterEntry ? 'bg-blue-50 text-blue-500' : isStepsEntry ? 'bg-orange-50 text-orange-500' : 'bg-slate-50'}`}>
                      {isWaterEntry ? <Droplets size={20} /> : 
                       isStepsEntry ? <Footprints size={20} /> : 
                       (entry.mealType === 'breakfast' ? '🍳' : entry.mealType === 'lunch' ? '🍱' : entry.mealType === 'dinner' ? '🍲' : '🍫')}
                    </div>
                    <div>
                      <p className="text-xs font-bold">{entry.description || (entry.items && entry.items[0]?.productName) || "Прием пищи"}</p>
                      <p className="text-[10px] text-slate-400 uppercase font-bold tracking-widest">{isWaterEntry ? 'Вода' : isStepsEntry ? 'Активность' : getMealTypeName(entry.mealType)} • {Math.round(entry.calories || 0)} ккал</p>
                    </div>
                  </div>
                  <ScoreBadge score={entry.health_score} warningType={entry.warningType} />
                </div>
              );
            })}
          </div>
        )}
      </section>
    </motion.div>
  );
};

const ProductList: React.FC<{ 
  products: Product[], 
  setSelectedProduct: (p: Product) => void, 
  setActiveTab: (t: any) => void, 
  deleteProduct: (id: string) => void,
  settings?: { trackWater: boolean, trackSteps: boolean }
}> = ({ products, setSelectedProduct, setActiveTab, deleteProduct, settings }) => {
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState<'all' | 'product' | 'supplement' | 'complex_dish' | 'simple_dish'>('all');
  const [sortBy, setSortBy] = useState<'default' | 'healthy' | 'harmful' | 'calories'>('default');
  const [productToDelete, setProductToDelete] = useState<Product | null>(null);
  const [warningToShow, setWarningToShow] = useState<Product | null>(null);
  const categoryScroll = useDragScroll();
  const sortScroll = useDragScroll();

  const filtered = [
    ...(settings?.trackWater !== false ? [WATER_PRODUCT] : []),
    ...(settings?.trackSteps !== false ? [STEPS_PRODUCT] : []),
    ...products
  ].filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(search.toLowerCase());
    if (!matchesSearch) return false;

    // Show system products only in "All" or their relative logical categories if needed
    // But they should always show up in search
    if (search.trim() !== '') return true;

    if (filterCategory === 'all') return true;
    if (isSystemProduct(p.id)) return false;
    if (filterCategory === 'supplement') return p.warningType === 'info';
    if (filterCategory === 'product') return (p.category === 'product' || !p.category) && p.warningType !== 'info';
    if (filterCategory === 'complex_dish') return p.category === 'complex_dish';
    if (filterCategory === 'simple_dish') return p.category === 'simple_dish';
    
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === 'healthy') return (b.health_score || 0) - (a.health_score || 0);
    if (sortBy === 'harmful') return (a.health_score || 0) - (b.health_score || 0);
    if (sortBy === 'calories') return (b.nutrition?.calories || 0) - (a.nutrition?.calories || 0);
    return 0; // default (order of addition or initial order)
  });

  const sortOptions = [
    { id: 'default', label: 'По умолчанию', icon: null },
    { id: 'healthy', label: 'Сначала полезные', icon: <CheckCircle2 size={12} className="mr-1" /> },
    { id: 'harmful', label: 'Сначала вредные', icon: <AlertTriangle size={12} className="mr-1" /> },
    { id: 'calories', label: 'По калориям', icon: <Flame size={12} className="mr-1" /> },
  ];

  return (
    <motion.div 
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -15 }}
      transition={{ duration: 0.2, ease: "circOut" }}
      className="space-y-4 pb-24"
    >
      <AnimatePresence>
        {warningToShow && <WarningModal product={warningToShow} onClose={() => setWarningToShow(null)} />}
      </AnimatePresence>
      <div className="flex bg-slate-100 rounded-2xl px-4 py-2 items-center gap-2">
        <Search size={18} className="text-slate-400" />
        <input 
          placeholder="Поиск по карточкам..." 
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-transparent border-none outline-none text-sm w-full py-1 text-slate-600"
        />
      </div>

      <div 
        ref={categoryScroll.ref}
        {...categoryScroll.events}
        className="flex gap-2 items-center overflow-x-auto pb-1 scrollbar-hide -mx-1 px-1 cursor-grab active:cursor-grabbing select-none"
      >
        <div className="shrink-0 text-slate-300 ml-1">
          <Filter size={14} />
        </div>
        {[
          { id: 'all', label: 'Все' },
          { id: 'product', label: 'Продукты' },
          { id: 'supplement', label: 'Суплементы' },
          { id: 'simple_dish', label: 'Простые блюда' },
          { id: 'complex_dish', label: 'Сложные блюда' },
        ].map(cat => (
          <button
            key={cat.id}
            onClick={() => setFilterCategory(cat.id as any)}
            className={`flex items-center whitespace-nowrap px-3 py-1.5 rounded-full text-[10px] font-bold transition-all border ${
              filterCategory === cat.id 
                ? 'bg-slate-800 text-white border-slate-800 shadow-sm' 
                : 'bg-white text-slate-400 border-slate-100 hover:border-slate-200 shadow-sm px-4'
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      <div 
        ref={sortScroll.ref}
        {...sortScroll.events}
        className="flex gap-2 items-center overflow-x-auto pb-2 scrollbar-hide -mx-1 px-1 cursor-grab active:cursor-grabbing select-none"
      >
        <div className="shrink-0 text-slate-300 ml-1">
          <ArrowUpDown size={14} />
        </div>
        {sortOptions.map(option => (
          <button
            key={option.id}
            onClick={() => setSortBy(option.id as any)}
            className={`flex items-center whitespace-nowrap px-3 py-1.5 rounded-full text-[10px] font-bold transition-all border ${
              sortBy === option.id 
                ? 'bg-emerald-500 text-white border-emerald-500 shadow-sm' 
                : 'bg-white text-slate-400 border-slate-100 hover:border-slate-200 shadow-sm px-4'
            }`}
          >
            {option.icon}
            {option.label}
          </button>
        ))}
      </div>
      
      <div className="grid grid-cols-1 gap-2">
        {sorted.map(p => (
          <div 
            key={p.id}
            className="group relative flex items-center justify-between p-4 bg-white border border-slate-100 rounded-2xl shadow-sm hover:border-emerald-200 transition-all overflow-visible"
          >
              <div 
                className="flex items-center gap-4 text-left cursor-pointer flex-1"
                onClick={() => { setSelectedProduct(p); setActiveTab('productDetail'); }}
              >
                <div className={`w-12 h-12 shrink-0 aspect-square rounded-2xl flex items-center justify-center text-xl shadow-inner ${
                  p.id === WATER_PRODUCT_ID ? 'bg-blue-50 text-blue-500' : 
                  p.id === STEPS_PRODUCT_ID ? 'bg-orange-50 text-orange-500' : 
                  p.warningType === 'info' ? 'bg-purple-50 text-purple-500' :
                  p.category === 'complex_dish' ? 'bg-rose-50 text-rose-500' :
                  p.category === 'simple_dish' ? 'bg-amber-50 text-amber-500' :
                  'bg-emerald-50 text-emerald-500'
                }`}>
                  {p.id === WATER_PRODUCT_ID ? <Droplets size={24} /> : 
                   p.id === STEPS_PRODUCT_ID ? <Footprints size={24} /> : 
                   p.warningType === 'info' ? <Pill size={24} /> :
                   p.category === 'complex_dish' ? <CookingPot size={24} /> :
                   p.category === 'simple_dish' ? <Soup size={24} /> :
                   <Apple size={24} />}
                </div>
                <div>
                  <p className="text-sm font-bold text-slate-900">{p.name}</p>
                  <p className="text-xs text-slate-400">
                    {p.id === WATER_PRODUCT_ID ? 'Гидратация организма' : 
                     p.id === STEPS_PRODUCT_ID ? 'Физическая активность' : 
                     `${(p.nutrition?.calories || 0)} ккал / 100г`}
                  </p>
                </div>
              </div>
            
            <div className="flex items-center gap-1.5 shrink-0">
              <ScoreBadge score={p.health_score} warningType={p.warningType} />
              
              {!isSystemProduct(p.id) && (
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    setProductToDelete(p);
                  }}
                  className="p-2.5 text-slate-300 rounded-xl transition-all hover:text-rose-500 active:scale-90 flex items-center justify-center cursor-pointer"
                  title="Удалить продукт"
                >
                  <Trash2 size={16} className="pointer-events-none" />
                </button>
              )}
            </div>
          </div>
        ))}
        {sorted.length === 0 && (
          <div className="text-center pt-20">
            <div className="text-4xl mb-4">📦</div>
            <p className="text-slate-400 text-sm">Ничего не найдено.<br/>Попробуйте другой запрос!</p>
          </div>
        )}
      </div>

      {/* Custom Delete Confirmation Modal */}
      <AnimatePresence>
        {productToDelete && (
          <ConfirmModal 
            variant="danger"
            title="Удалить продукт?"
            message={`Вы уверены, что хотите удалить "${productToDelete.name}"? Это действие нельзя отменить.`}
            confirmText="Удалить"
            cancelText="Отмена"
            onConfirm={() => {
              deleteProduct(productToDelete.id);
              setProductToDelete(null);
            }}
            onCancel={() => setProductToDelete(null)}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
};

const ProductDetails: React.FC<{ selectedProduct: Product | null, setActiveTab: (t: any) => void, quickAddToDiary?: (mealType: string, date: string, time: string, grams: number, existingProduct?: Product) => void }> = ({ selectedProduct, setActiveTab, quickAddToDiary }) => {
  const [quickMealType, setQuickMealType] = useState<string>('snack');
  const [quickDate, setQuickDate] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const [quickTime, setQuickTime] = useState<string>(() => {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  });
  const [quickGrams, setQuickGrams] = useState<string>('100');
  if (!selectedProduct) return null;
  const [showWarningModal, setShowWarningModal] = useState(false);

  const isSystem = isSystemProduct(selectedProduct.id);

  return (
    <motion.div 
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -15 }}
      transition={{ duration: 0.2, ease: "circOut" }}
      className="space-y-6 pb-24 text-left"
    >
      <AnimatePresence>
        {showWarningModal && <WarningModal product={selectedProduct} onClose={() => setShowWarningModal(false)} />}
      </AnimatePresence>

      <button onClick={() => setActiveTab('products')} className="flex items-center gap-2 text-slate-400 text-sm font-semibold">
        <ArrowLeft size={16} /> Назад
      </button>

      <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100 space-y-6">
        <div className="flex justify-between items-start">
          <div className="space-y-1">
            <h2 className="text-2xl font-black text-slate-900">{selectedProduct.name}</h2>
            <StatusBadge id={selectedProduct.id} warningType={selectedProduct.warningType || (selectedProduct as any).warning_type} category={selectedProduct.category} />
          </div>
          <div className="flex items-center gap-2">
            <ScoreBadge score={selectedProduct.health_score || 0} warningType={selectedProduct.warningType} />
          </div>
        </div>

        {!isSystem && (
          <div className="grid grid-cols-4 gap-2 text-center">
            <div className="bg-slate-50 rounded-xl p-2">
              <p className="text-[10px] text-slate-400 uppercase font-bold">Ккал</p>
              <p className="text-xs font-black">{selectedProduct.nutrition?.calories || 0}</p>
            </div>
            <div className="bg-slate-50 rounded-xl p-2">
              <p className="text-[10px] text-slate-400 uppercase font-bold">Белки</p>
              <p className="text-xs font-black">{selectedProduct.nutrition?.protein || 0}г</p>
            </div>
            <div className="bg-slate-50 rounded-xl p-2">
              <p className="text-[10px] text-slate-400 uppercase font-bold">Жиры</p>
              <p className="text-xs font-black">{selectedProduct.nutrition?.fat || 0}г</p>
            </div>
            <div className="bg-slate-50 rounded-xl p-2">
              <p className="text-[10px] text-slate-400 uppercase font-bold">Углев</p>
              <p className="text-xs font-black">{selectedProduct.nutrition?.carbs || 0}г</p>
            </div>
          </div>
        )}

        {/* Removed Add to Diet controls per user request */}

        {isSystem && (
          <div className="space-y-6 pt-2">
            {selectedProduct.id === WATER_PRODUCT_ID ? (
              <div className="space-y-4">
                <div className="bg-blue-50/50 rounded-[32px] p-6 border border-blue-100">
                  <h4 className="text-blue-600 font-black text-xs uppercase tracking-widest mb-4">Польза воды</h4>
                  <ul className="space-y-3">
                    {[
                      { title: "Метаболизм", desc: "Вода необходима для всех химических реакций в клетках." },
                      { title: "Детокс", desc: "Помогает почкам выводить продукты распада и токсины." },
                      { title: "Контроль веса", desc: "Стакан воды перед едой снижает чувство голода." },
                      { title: "Энергия", desc: "Даже легкое обезвоживание вызывает усталость и головную боль." }
                    ].map((item, i) => (
                      <li key={i} className="flex gap-3">
                        <div className="w-1.5 h-1.5 rounded-full bg-blue-400 mt-1.5 shrink-0" />
                        <div>
                          <p className="text-[11px] font-black text-blue-900 leading-tight">{item.title}</p>
                          <p className="text-[10px] text-blue-600/70 leading-tight mt-0.5">{item.desc}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100">
                  <p className="text-[10px] text-slate-500 leading-relaxed italic text-center">
                    "Чистая вода — самый простой и эффективный способ поддержания здоровья организма."
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="bg-orange-50/50 rounded-[32px] p-6 border border-orange-100">
                  <h4 className="text-orange-600 font-black text-xs uppercase tracking-widest mb-4">Польза ходьбы</h4>
                  <ul className="space-y-3">
                    {[
                      { title: "Сердце", desc: "Укрепляет сердечно-сосудистую систему и нормализует давление." },
                      { title: "Гормоны", desc: "Снижает уровень кортизола (стресса) и повышает эндорфины." },
                      { title: "Суставы", desc: "Улучшает питание хрящевой ткани и подвижность." },
                      { title: "Сон", desc: "Дневная активность помогает быстрее засыпать вечером." }
                    ].map((item, i) => (
                      <li key={i} className="flex gap-3">
                        <div className="w-1.5 h-1.5 rounded-full bg-orange-400 mt-1.5 shrink-0" />
                        <div>
                          <p className="text-[11px] font-black text-orange-900 leading-tight">{item.title}</p>
                          <p className="text-[10px] text-orange-600/70 leading-tight mt-0.5">{item.desc}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100">
                  <p className="text-[10px] text-slate-500 leading-relaxed italic text-center">
                    "10 000 шагов — это не догма, но отличный ориентир для базового здоровья."
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {!isSystem && (
          <div className="space-y-2 pt-2">
            <h4 className="text-xs font-black uppercase text-slate-400 tracking-wider">Состав</h4>
            <div className="space-y-2">
              {selectedProduct.ingredients && selectedProduct.ingredients.length > 0 ? (
                selectedProduct.ingredients.map((ing, i) => (
                  <div key={i} className="flex gap-3 text-sm border-b border-slate-50 pb-2">
                    <span className={ing.health_impact === 'high' ? 'text-rose-500' : ing.health_impact === 'medium' ? 'text-amber-500' : 'text-emerald-500'}>
                      {ing.health_impact === 'high' ? '🔴' : ing.health_impact === 'medium' ? '🟡' : '🟢'}
                    </span>
                    <div className="flex-1">
                      <p className="font-bold text-xs">{ing.name}</p>
                      <p className="text-[10px] text-slate-500 italic leading-tight">{ing.description}</p>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-xs text-slate-400 italic">Состав не указан</p>
              )}
            </div>
          </div>
        )}

        {quickAddToDiary && (
          <div className="mt-6 pt-6 border-t border-slate-100 space-y-4">
             <h4 className="text-xs font-black uppercase tracking-wider text-slate-800 flex items-center gap-2">
               <div className="w-6 h-6 rounded-md bg-blue-50 text-blue-500 flex items-center justify-center">⚡</div>
               Быстрое добавление в дневник
             </h4>
             
             <div className="grid grid-cols-2 gap-3">
               {!isSystem && (
                 <div className="space-y-1">
                   <label className="text-[10px] uppercase font-bold text-slate-400">Прием пищи</label>
                   <select value={quickMealType} onChange={e => setQuickMealType(e.target.value)} className="w-full bg-slate-50 border-none p-2.5 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500">
                     <option value="breakfast">Завтрак</option>
                     <option value="lunch">Обед</option>
                     <option value="dinner">Ужин</option>
                     <option value="snack">Перекус</option>
                   </select>
                 </div>
               )}
               <div className="space-y-1">
                 <label className="text-[10px] uppercase font-bold text-slate-400">
                   {selectedProduct.id === WATER_PRODUCT_ID ? 'Объем (мл)' : selectedProduct.id === STEPS_PRODUCT_ID ? 'Количество шагов' : 'Вес (г)'}
                 </label>
                 <input type="number" value={quickGrams} onChange={e => setQuickGrams(e.target.value)} className="w-full bg-slate-50 border-none p-2.5 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500" />
               </div>
               <div className="space-y-1">
                 <label className="text-[10px] uppercase font-bold text-slate-400">Дата</label>
                 <input type="date" value={quickDate} onChange={e => setQuickDate(e.target.value)} className="w-full bg-slate-50 border-none p-2.5 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500" />
               </div>
               <div className="space-y-1">
                 <label className="text-[10px] uppercase font-bold text-slate-400">Время</label>
                 <input type="time" value={quickTime} onChange={e => setQuickTime(e.target.value)} className="w-full bg-slate-50 border-none p-2.5 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500" />
               </div>
             </div>
             
             <div className="flex gap-2 overflow-x-auto custom-scrollbar pb-1">
               {['Сейчас', '-15 мин', '-1 час', '-2 часа'].map(preset => (
                 <button
                   key={preset}
                   onClick={() => {
                     const d = new Date();
                     if (preset === '-15 мин') d.setMinutes(d.getMinutes() - 15);
                     if (preset === '-1 час') d.setHours(d.getHours() - 1);
                     if (preset === '-2 часа') d.setHours(d.getHours() - 2);
                     setQuickTime(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
                     setQuickDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
                   }}
                   className="whitespace-nowrap px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg text-[10px] font-bold shrink-0 hover:bg-blue-100 transition-colors"
                 >
                   {preset}
                 </button>
               ))}
             </div>
             
             <button 
               onClick={() => {
                 const g = parseFloat(quickGrams);
                 if (isNaN(g) || g <= 0) return alert(isSystem ? 'Введите корректное значение' : 'Введите корректный вес');
                 
                 let finalMealType = quickMealType;
                 if (selectedProduct.id === WATER_PRODUCT_ID) finalMealType = 'water';
                 if (selectedProduct.id === STEPS_PRODUCT_ID) finalMealType = 'steps';
                 
                 if (selectedProduct && quickAddToDiary) { quickAddToDiary(finalMealType, quickDate, quickTime, g, selectedProduct); }
               }}
               className="w-full bg-blue-500 text-white p-3 rounded-xl font-black hover:bg-blue-600 transition-all shadow-md active:scale-95 text-sm"
             >
               ДОБАВИТЬ В ДНЕВНИК
             </button>
          </div>
        )}
      </div>
    </motion.div>

  );
};

const ScanView: React.FC<{ 
  isLoading: boolean, 
  scanResult: Partial<Product> | null, 
  setScanResult: (p: any) => void, 
  handleScan: (e: any) => void, 
  handleTextScan: (t: string) => void, 
  saveProduct: () => void,
  scanMode: 'camera' | 'text',
  setScanMode: (m: 'camera' | 'text') => void,
  inputText: string,
  setInputText: (t: string) => void,
  quickAddToDiary?: (mealType: string, date: string, time: string, grams: number) => void
}> = ({ isLoading, scanResult, setScanResult, handleScan, handleTextScan, saveProduct, scanMode, setScanMode, inputText, setInputText, quickAddToDiary }) => {
  const [quickMealType, setQuickMealType] = useState<string>('snack');
  const [quickDate, setQuickDate] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const [quickTime, setQuickTime] = useState<string>(() => {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  });
  const [quickGrams, setQuickGrams] = useState<string>('100');

  return (
    <motion.div 
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -15 }}
      transition={{ duration: 0.2, ease: "circOut" }}
      className="space-y-6 pb-24 text-left"
    >
      {!scanResult && (
        <div className="flex bg-slate-100 p-1 rounded-2xl mx-auto max-w-[200px]">
          <button 
            onClick={() => setScanMode('camera')}
            className={`flex-1 py-2 text-[10px] font-black rounded-xl transition-all ${scanMode === 'camera' ? 'bg-white shadow-sm text-emerald-600' : 'text-slate-400'}`}
          >КАМЕРА</button>
          <button 
            onClick={() => setScanMode('text')}
            className={`flex-1 py-2 text-[10px] font-black rounded-xl transition-all ${scanMode === 'text' ? 'bg-white shadow-sm text-emerald-600' : 'text-slate-400'}`}
          >ТЕКСТ</button>
        </div>
      )}

      {isLoading ? (
        <div className="flex flex-col items-center justify-center pt-20 space-y-6">
          <div className="relative">
            <Loader2 className="animate-spin text-emerald-500" size={64} strokeWidth={2.5} />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-8 h-8 bg-emerald-500/10 rounded-full animate-ping" />
            </div>
          </div>
          <div className="text-center space-y-2">
            <p className="text-slate-900 font-black uppercase tracking-tighter text-lg">Анализируем состав</p>
            <p className="text-slate-400 font-bold text-[10px] uppercase tracking-[0.2em] animate-pulse">Секунду, Биопризма работает...</p>
          </div>
        </div>
      ) : scanResult ? (
        <motion.div initial={{ y: 20 }} animate={{ y: 0 }} className="bg-white rounded-3xl p-6 space-y-6 shadow-sm border border-slate-100">
           <AnimatePresence>
             {(scanResult as any).warning_type && (scanResult as any).warning_type !== 'none' && (
               <WarningModal 
                 product={{
                   ...scanResult, 
                   warningType: (scanResult as any).warning_type, 
                   warningMessage: (scanResult as any).warning_message
                 } as Product} 
                 onClose={() => setScanResult(prev => prev ? ({...prev, warning_type: 'none'}) : null)} 
               />
             )}
           </AnimatePresence>
           
             <div className="relative text-center space-y-2">
              <div className="absolute -top-1 right-0 flex flex-col items-end gap-1">
                <StatusBadge id={scanResult?.id} warningType={(scanResult as any).warningType || (scanResult as any).warning_type} category={(scanResult as any).category} />
              </div>
              <div className="text-5xl">🔬</div>
              <h2 className="text-xl font-black text-slate-900">Результат сканирования</h2>
            </div>
           
           <div className="space-y-4 text-left">
             <div className="flex flex-col">
               <label className="text-[10px] uppercase font-bold text-slate-400 mb-1">Название продукта</label>
               <input 
                 type="text"
                 value={scanResult.name || ''}
                 readOnly={scanResult.name === 'Системный объект' || (scanResult as any).category === 'water' || (scanResult as any).category === 'steps'}
                 onChange={(e) => setScanResult((prev: any) => prev ? {...prev, name: e.target.value} : null)}
                 onKeyDown={(e) => { if(e.key === 'Enter') e.preventDefault(); }}
                 className={`bg-slate-50 border-none p-3 rounded-xl font-bold outline-none ring-2 ring-transparent transition-all text-base ${
                   (scanResult.name === 'Системный объект' || (scanResult as any).category === 'water' || (scanResult as any).category === 'steps') 
                     ? 'opacity-70 cursor-not-allowed' 
                     : 'focus:ring-emerald-500'
                 }`}
               />
             </div>
             
             <div className="p-4 bg-white rounded-2xl border border-slate-100 shadow-sm">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Анализ</span>
                  <ScoreBadge score={scanResult.health_score || 0} warningType={(scanResult as any).warning_type} />
                </div>
                <div className="text-[10px] text-slate-600 font-medium leading-tight mb-3 mt-2">{scanResult.verdict || 'Анализ завершен успешно.'}</div>
                
                <div className="grid grid-cols-4 gap-1.5 text-center border-t border-emerald-100 pt-3">
                  <div className="space-y-0.5">
                    <p className="text-[8px] uppercase font-bold text-emerald-600/60">Ккал</p>
                    <p className="text-[11px] font-black text-emerald-800">{scanResult.nutrition?.calories || 0}</p>
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-[8px] uppercase font-bold text-emerald-600/60">Белки</p>
                    <p className="text-[11px] font-black text-emerald-800">{scanResult.nutrition?.protein || 0}г</p>
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-[8px] uppercase font-bold text-emerald-600/60">Жиры</p>
                    <p className="text-[11px] font-black text-emerald-800">{scanResult.nutrition?.fat || 0}г</p>
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-[8px] uppercase font-bold text-emerald-600/60">Углев</p>
                    <p className="text-[11px] font-black text-emerald-800">{scanResult.nutrition?.carbs || 0}г</p>
                  </div>
                </div>
             </div>

             <div className="space-y-2">
                <h4 className="text-[10px] font-black uppercase text-slate-400">Состав</h4>
                <div className="space-y-1">
                  {scanResult.ingredients?.map((ing, i) => (
                    <div key={i} className="text-[11px] bg-white border border-slate-100 p-2 rounded-xl flex items-center gap-2">
                      <span>{ing.health_impact === 'high' ? '🔴' : ing.health_impact === 'medium' ? '🟡' : '🟢'}</span>
                      <span className="font-bold flex-1">{ing.name}</span>
                    </div>
                  ))}
                </div>
             </div>

             <div className="grid grid-cols-2 gap-4">
               <button 
                 onClick={() => setScanResult(null)}
                 className="p-3 bg-slate-100 text-slate-400 rounded-xl font-bold text-sm"
               >СБРОС</button>
               <button 
                 onClick={saveProduct}
                 disabled={scanResult.name === 'Системный объект' || (scanResult as any).category === 'water' || (scanResult as any).category === 'steps'}
                 className={`p-3 rounded-xl font-bold text-sm shadow-md transition-all ${
                   (scanResult.name === 'Системный объект' || (scanResult as any).category === 'water' || (scanResult as any).category === 'steps')
                     ? 'bg-slate-200 text-slate-400 cursor-not-allowed grayscale shadow-none' 
                     : 'bg-emerald-500 text-white shadow-emerald-200 active:scale-95'
                 }`}
               >СОХРАНИТЬ</button>
             </div>
             
             {!(scanResult.name === 'Системный объект' || (scanResult as any).category === 'water' || (scanResult as any).category === 'steps') && quickAddToDiary && (
               <div className="mt-6 pt-6 border-t border-slate-100 space-y-4">
                 <h4 className="text-xs font-black uppercase tracking-wider text-slate-800 flex items-center gap-2">
                   <div className="w-6 h-6 rounded-md bg-blue-50 text-blue-500 flex items-center justify-center">⚡</div>
                   Быстрое добавление в дневник
                 </h4>
                 
                 
                 <div className="grid grid-cols-2 gap-3">
                   <div className="space-y-1">
                     <label className="text-[10px] uppercase font-bold text-slate-400">Прием пищи</label>
                     <select value={quickMealType} onChange={e => setQuickMealType(e.target.value)} className="w-full bg-slate-50 border-none p-2.5 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500">
                       <option value="breakfast">Завтрак</option>
                       <option value="lunch">Обед</option>
                       <option value="dinner">Ужин</option>
                       <option value="snack">Перекус</option>
                     </select>
                   </div>
                   <div className="space-y-1">
                     <label className="text-[10px] uppercase font-bold text-slate-400">Вес (г)</label>
                     <input type="number" value={quickGrams} onChange={e => setQuickGrams(e.target.value)} className="w-full bg-slate-50 border-none p-2.5 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500" />
                   </div>
                   <div className="space-y-1">
                     <label className="text-[10px] uppercase font-bold text-slate-400">Дата</label>
                     <input type="date" value={quickDate} onChange={e => setQuickDate(e.target.value)} className="w-full bg-slate-50 border-none p-2.5 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500" />
                   </div>
                   <div className="space-y-1">
                     <label className="text-[10px] uppercase font-bold text-slate-400">Время</label>
                     <input type="time" value={quickTime} onChange={e => setQuickTime(e.target.value)} className="w-full bg-slate-50 border-none p-2.5 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500" />
                   </div>
                 </div>
                 
                 <div className="flex gap-2 overflow-x-auto custom-scrollbar pb-1">
                   {['Сейчас', '-15 мин', '-1 час', '-2 часа'].map(preset => (
                     <button
                       key={preset}
                       onClick={() => {
                         const d = new Date();
                         if (preset === '-15 мин') d.setMinutes(d.getMinutes() - 15);
                         if (preset === '-1 час') d.setHours(d.getHours() - 1);
                         if (preset === '-2 часа') d.setHours(d.getHours() - 2);
                         setQuickTime(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
                         setQuickDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
                       }}
                       className="whitespace-nowrap px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg text-[10px] font-bold shrink-0 hover:bg-blue-100 transition-colors"
                     >
                       {preset}
                     </button>
                   ))}
                 </div>

                 <button 
                   onClick={() => {
                     const g = parseFloat(quickGrams);
                     if (isNaN(g) || g <= 0) return alert('Введите корректный вес');
                     quickAddToDiary(quickMealType, quickDate, quickTime, g);
                   }}
                   className="w-full bg-blue-500 text-white p-3 rounded-xl font-black hover:bg-blue-600 transition-all shadow-md active:scale-95 text-sm"
                 >
                   ДОБАВИТЬ В ДНЕВНИК
                 </button>
               </div>
             )}

             {scanResult.name === 'Системный объект' && (
               <div className="bg-blue-50 border border-blue-100 p-3 rounded-2xl text-[10px] font-bold text-blue-600 leading-snug">
                 Для учета воды и шагов используйте специальные интерактивные блоки на главном экране. Сохранение этого объекта в общую базу продуктов не требуется.
               </div>
             )}
           </div>
        </motion.div>
      ) : scanMode === 'camera' ? (
        <div className="flex flex-col items-center justify-center pt-10 text-center space-y-8">
          <div className="w-64 h-64 border-2 border-dashed border-slate-200 rounded-[40px] flex flex-col items-center justify-center p-8 space-y-4 bg-white/50">
             <div className="w-20 h-20 bg-emerald-50 text-emerald-500 rounded-3xl flex items-center justify-center shadow-inner">
               <Camera size={40} />
             </div>
             <p className="text-xs font-bold text-slate-400 leading-relaxed uppercase tracking-wider">Наведите камеру<br/>на состав продукта</p>
          </div>
          
          <div className="space-y-3 w-full max-w-[280px]">
            <label className="block w-full bg-slate-900 text-white p-4 rounded-2xl font-black cursor-pointer hover:bg-slate-800 transition-colors shadow-lg active:scale-95 transform transition-transform">
              ОТКРЫТЬ КАМЕРУ
              <input type="file" accept="image/*" className="hidden" onChange={handleScan} />
            </label>
            <label className="block w-full bg-white border border-slate-200 text-slate-600 p-4 rounded-2xl font-black cursor-pointer hover:bg-slate-50 transition-colors active:scale-95 transform transition-transform">
              ВЫБРАТЬ ИЗ ГАЛЕРЕИ
              <input type="file" accept="image/*" className="hidden" onChange={handleScan} />
            </label>
          </div>
        </div>
      ) : (
        <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-4">
          <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100 space-y-4">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 bg-emerald-50 text-emerald-500 rounded-xl flex items-center justify-center"><Info size={20} /></div>
              <h3 className="font-bold text-sm text-left">Вставьте состав текстом</h3>
            </div>
            <textarea 
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Сахар, какао-масло, тертое какао, сухое цельное молоко..."
              className="w-full h-40 bg-slate-50 border-none rounded-2xl p-4 outline-none text-base font-medium resize-none focus:ring-2 focus:ring-emerald-500 transition-all placeholder:text-slate-300"
            />
            <button 
              type="button"
              onClick={(e) => { e.preventDefault(); handleTextScan(inputText); }}
              disabled={!inputText.trim() || isLoading}
              className="w-full bg-emerald-500 text-white p-4 rounded-2xl font-black hover:bg-emerald-600 transition-all shadow-lg shadow-emerald-100 disabled:opacity-50 disabled:grayscale"
            >
              {isLoading ? 'АНАЛИЗ...' : 'АНАЛИЗИРОВАТЬ'}
            </button>
          </div>
        </motion.div>
      )}
    </motion.div>
  );
};

const AuthView: React.FC<{ onAuth: (code: string, isNew: boolean, name?: string) => void }> = ({ onAuth }) => {
  const [step, setStep] = useState<'login' | 'register' | 'showKey'>('login');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [generatedKey, setGeneratedKey] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const generateKey = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let result = '';
    for (let i = 0; i < 10; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  };

  const handleStartRegistration = async () => {
    if (!name.trim()) {
      setError('Введите имя');
      return;
    }
    
    setIsLoading(true);
    setError('');
    const key = generateKey();
    
    try {
      // Direct create attempt. If by some crazy chance it exists, Firestore will just overwrite or fail depending on logic, 
      // but for this app a new key is virtually guaranteed to be unique (32^10 combinations).
      await createUserProfile(key, name);
      setGeneratedKey(key);
      setStep('showKey');
    } catch (err: any) {
      setError('Ошибка при создании профиля. Проверьте интернет или попробуйте позже.');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogin = async () => {
    const cleanCode = code.trim().toUpperCase();
    if (cleanCode.length !== 10) {
      setError('Неверный формат ключа');
      return;
    }

    setIsLoading(true);
    setError('');
    
    try {
      const profile = await getUserProfile(cleanCode) as any;
      if (profile) {
        await updateLastLogin(cleanCode);
        onAuth(cleanCode, false, profile.name);
      } else {
        setError('Ключ не найден или недействителен');
      }
    } catch (err: any) {
      setError('Ошибка при входе. Проверьте интернет.');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <motion.div 
      key="auth-root"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="h-full w-full flex flex-col items-center p-8 bg-gradient-to-b from-white to-emerald-50/50"
    >
      {/* Top Decoration & Logo */}
      <motion.div 
        layout
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="flex-1 flex flex-col items-center justify-center w-full max-w-sm space-y-8 sm:space-y-12"
      >
        <motion.div 
          layout
          layoutId="auth-logo-container"
          className="relative flex items-center justify-center w-28 h-28"
        >
          {/* Wave effect like in image */}
          <div className="absolute w-48 h-48 border-2 border-emerald-500/10 rounded-full animate-pulse"></div>
          <div className="absolute w-64 h-64 border border-emerald-500/5 rounded-full"></div>
          
          <motion.div 
            layout
            layoutId="auth-logo-icon"
            className="relative z-10 w-28 h-28 bg-white/80 backdrop-blur-xl rounded-[44px] flex items-center justify-center shadow-[0_20px_50px_rgba(16,185,129,0.15)] border border-white"
          >
            <Camera size={56} className="text-emerald-500" strokeWidth={1.5} />
          </motion.div>
        </motion.div>

        <motion.div layout layoutId="auth-header" className="text-center space-y-1">
          <h1 className="text-3xl font-black tracking-tighter text-slate-900 uppercase">БИОПРИЗМА</h1>
          <p className="text-[10px] text-emerald-600/60 font-black uppercase tracking-[0.4em] translate-x-1">Health Scanner</p>
        </motion.div>

        {/* Inputs Area */}
        <motion.div layout className="w-full">
          <AnimatePresence mode="popLayout">
            {step === 'login' && (
              <motion.div 
                key="login"
                layout
                initial={{ opacity: 0, scale: 0.98, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.98, y: -10 }}
                className="space-y-4"
              >
                <div className="relative group focus-within:z-10">
                  <input 
                    type="text" 
                    placeholder="Ключ доступа" 
                    value={code}
                    onChange={(e) => {
                      setCode(e.target.value.toUpperCase().slice(0, 10));
                      if (error) setError('');
                    }}
                    className="w-full h-16 bg-white/60 border border-white backdrop-blur shadow-sm p-5 rounded-[24px] font-bold text-slate-900 focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500 outline-none transition-all placeholder:text-slate-300 font-mono tracking-widest text-center text-base"
                  />
                  <div className="absolute inset-y-0 left-6 flex items-center pointer-events-none">
                    <Key size={20} className="text-slate-400/60 group-focus-within:text-emerald-500 transition-colors" />
                  </div>
                </div>
                {error && <p className="text-[10px] text-rose-500 font-black uppercase tracking-widest text-center">{error}</p>}
                
                <button 
                  onClick={handleLogin}
                  disabled={code.length !== 10 || isLoading}
                  className="w-full h-16 bg-emerald-500 text-white rounded-[24px] font-black shadow-2xl shadow-emerald-200/50 hover:bg-emerald-600 transition-all active:scale-95 disabled:opacity-50 disabled:grayscale uppercase tracking-widest flex items-center justify-center gap-2"
                >
                  {isLoading ? <Loader2 className="animate-spin" size={20} /> : 'Войти в аккаунт'}
                </button>
              </motion.div>
            )}

            {step === 'register' && (
              <motion.div 
                key="register"
                layout
                initial={{ opacity: 0, scale: 0.98, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.98, y: -10 }}
                className="space-y-4"
              >
                <div className="relative group focus-within:z-10">
                  <input 
                    type="text" 
                    placeholder="Введите ваше имя" 
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                      if (error) setError('');
                    }}
                    className="w-full h-16 bg-white/60 border border-white backdrop-blur shadow-sm p-5 rounded-[24px] font-bold text-slate-900 focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500 outline-none transition-all placeholder:text-slate-300 text-center text-base"
                  />
                  <div className="absolute inset-y-0 left-6 flex items-center pointer-events-none">
                    <User size={20} className="text-slate-400/60 group-focus-within:text-emerald-500 transition-colors" />
                  </div>
                </div>
                {error && <p className="text-[10px] text-rose-500 font-black uppercase tracking-widest text-center">{error}</p>}
                
                <button 
                  onClick={handleStartRegistration}
                  disabled={isLoading}
                  className="w-full h-16 bg-emerald-500 text-white rounded-[24px] font-black shadow-2xl shadow-emerald-200/50 hover:bg-emerald-600 transition-all active:scale-95 uppercase tracking-widest flex items-center justify-center gap-2"
                >
                  {isLoading ? <Loader2 className="animate-spin" size={20} /> : 'Создать профиль'}
                </button>
              </motion.div>
            )}

            {step === 'showKey' && (
              <motion.div 
                key="key"
                layout
                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: -20 }}
                className="space-y-6 text-center"
              >
                <div className="bg-slate-900 p-8 rounded-[32px] shadow-2xl relative group overflow-hidden">
                  <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-500 to-transparent"></div>
                  <p className="text-xs text-emerald-500/50 font-black uppercase tracking-[0.3em] mb-4">Ваш личный ключ</p>
                  <p className="text-2xl font-black tracking-[0.2em] text-emerald-400 break-all select-all font-mono">
                    {generatedKey}
                  </p>
                </div>
                
                <div className="bg-amber-50 rounded-2xl p-4 border border-amber-100/50">
                   <p className="text-[10px] text-amber-700 font-bold uppercase tracking-widest leading-relaxed">
                     Сохраните этот ключ! <br/>Без него вход будет невозможен.
                   </p>
                </div>

                <button 
                  onClick={() => onAuth(generatedKey, true, name)}
                  className="w-full h-16 bg-emerald-500 text-white rounded-[24px] font-black shadow-2xl shadow-emerald-200 hover:bg-emerald-600 transition-all active:scale-95 uppercase tracking-widest"
                >
                  Я сохранил, войти
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </motion.div>

      {/* Very Bottom Links */}
      <div className="w-full max-w-sm flex justify-between items-center py-6">
        {step === 'login' ? (
          <button 
            onClick={() => setStep('register')}
            className="text-[11px] font-black text-slate-400 uppercase tracking-widest hover:text-emerald-500 transition-colors"
          >
            Создать аккаунт
          </button>
        ) : (
          <button 
            onClick={() => setStep('login')}
            className="text-[11px] font-black text-slate-400 uppercase tracking-widest hover:text-emerald-500 transition-colors"
          >
            Уже есть ключ?
          </button>
        )}
        <button 
          className="text-[11px] font-black text-slate-400 uppercase tracking-widest hover:text-emerald-500 transition-colors"
        >
          Нужна помощь?
        </button>
      </div>
    </motion.div>
  );
};

const InstructionModal = ({ onClose }: { onClose: () => void }) => (
  <motion.div 
    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    className="fixed inset-0 z-[100] flex items-center justify-center px-6 bg-slate-900/60 backdrop-blur-sm"
  >
    <motion.div 
      initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }}
      className="bg-white rounded-[40px] p-8 w-full max-w-sm shadow-2xl space-y-6 text-center"
    >
      <div className="w-16 h-16 bg-blue-50 text-blue-500 rounded-[24px] flex items-center justify-center mx-auto">
        <BookOpen size={30} />
      </div>
      <div className="space-y-2">
        <h2 className="text-xl font-black text-slate-900">Инструкция</h2>
        <p className="text-sm text-slate-400 font-medium leading-relaxed">
          Просто отсканируйте состав любого продукта, и наш интеллект мгновенно проанализирует его на наличие вредных добавок, сахара и ГМО.
        </p>
      </div>
      <button 
        onClick={onClose}
        className="w-full bg-emerald-500 text-white p-4 rounded-2xl font-black shadow-lg shadow-emerald-100 active:scale-95 transition-all"
      >
        ПОЕХАЛИ!
      </button>
    </motion.div>
  </motion.div>
);

const ProfileSetupModal = ({ user, onSave, onClose }: { user: UserProfile, onSave: (bio: any) => Promise<void>, onClose: () => void }) => {
  const [bio, setBio] = useState({
    gender: user.bio?.gender || 'male',
    age: user.bio?.age?.toString() || '25',
    height: user.bio?.height?.toString() || '175',
    weight: user.bio?.weight?.toString() || '70',
    activity: user.bio?.activity || 'medium',
    goalCategory: user.bio?.goalCategory || 'maintenance',
    goalDescription: user.bio?.goalDescription || ''
  });
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    
    const ageNum = Number(bio.age);
    const heightNum = Number(bio.height);
    const weightNum = Number(bio.weight);
    if (!bio.age || isNaN(ageNum) || ageNum <= 0 || 
        !bio.height || isNaN(heightNum) || heightNum <= 0 || 
        !bio.weight || isNaN(weightNum) || weightNum <= 0) {
      const msg = "Необходимо заполнить все поля и указать значения больше 0";
      setError(msg);
      alert(msg);
      return;
    }

    setIsSaving(true);
    try {
      await onSave({
        ...bio,
        age: ageNum,
        height: heightNum,
        weight: weightNum
      });
      onClose();
    } catch (err) {
      alert("Ошибка при сохранении профиля");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
        <motion.div 
          initial={{ opacity: 0, scale: 0.9, y: 30 }} 
          animate={{ opacity: 1, scale: 1, y: 0 }} 
          exit={{ opacity: 0, scale: 0.9, y: 30 }}
          className="relative w-full max-w-sm bg-white rounded-[40px] p-8 shadow-2xl space-y-6 overflow-y-auto max-h-[90vh] custom-scrollbar flex flex-col"
        >
          <button 
            onClick={onClose}
            className="absolute top-6 right-6 p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-2xl transition-all"
          >
            <X size={20} />
          </button>
          <div className="text-center space-y-2">
            <h2 className="text-2xl font-black text-slate-900 leading-tight">
              {user.bio ? 'Редактирование' : 'Ваш профиль'}
            </h2>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">Определите цели для AI</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5 text-left flex-1">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block ml-1">Пол</label>
                <select 
                  value={bio.gender} 
                  onChange={e => setBio({...bio, gender: e.target.value as any})}
                  className="w-full bg-slate-50 p-3.5 rounded-2xl font-bold outline-none border border-slate-100 text-base"
                >
                  <option value="male">Мужской</option>
                  <option value="female">Женский</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block ml-1">Возраст</label>
                <input 
                  type="number" 
                  value={bio.age} 
                  onChange={e => setBio({...bio, age: e.target.value})}
                  placeholder="0"
                  className="w-full bg-slate-50 p-3.5 rounded-2xl font-bold outline-none border border-slate-100 text-base"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block ml-1">Рост (см)</label>
                <input 
                  type="number" 
                  value={bio.height} 
                  onChange={e => setBio({...bio, height: e.target.value})}
                  placeholder="0"
                  className="w-full bg-slate-50 p-3.5 rounded-2xl font-bold outline-none border border-slate-100 text-base"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block ml-1">Вес (кг)</label>
                <input 
                  type="number" 
                  value={bio.weight} 
                  onChange={e => setBio({...bio, weight: e.target.value})}
                  placeholder="0"
                  className="w-full bg-slate-50 p-3.5 rounded-2xl font-bold outline-none border border-slate-100 text-base"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block ml-1">Активность</label>
              <select 
                value={bio.activity} 
                onChange={e => setBio({...bio, activity: e.target.value as any})}
                className="w-full bg-slate-50 p-3.5 rounded-2xl font-bold outline-none border border-slate-100 text-base"
              >
                <option value="low">Низкая</option>
                <option value="medium">Средняя</option>
                <option value="high">Высокая</option>
              </select>
            </div>

            <div className="space-y-2">
               <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block ml-1">Цель</label>
               <div className="grid grid-cols-3 gap-2">
                 {(['weight_loss', 'maintenance', 'weight_gain'] as const).map(goal => (
                   <button
                     key={goal}
                     type="button"
                     onClick={() => setBio({...bio, goalCategory: goal})}
                     className={`py-2.5 px-1 rounded-xl text-[9px] font-black border transition-all ${bio.goalCategory === goal ? 'bg-emerald-500 text-white border-emerald-500 shadow-md shadow-emerald-100' : 'bg-white text-slate-400 border-slate-100'}`}
                   >
                     {goal === 'weight_loss' ? 'ПОХУДЕНИЕ' : goal === 'maintenance' ? 'ПОДДЕРЖКА' : 'НАБОР'}
                   </button>
                 ))}
               </div>
            </div>

            <div className="space-y-1">
              <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block ml-1">Описание цели для AI</label>
              <textarea 
                value={bio.goalDescription}
                onChange={e => setBio({...bio, goalDescription: e.target.value})}
                placeholder="Пример: Набрать 5кг за 2 месяца или убрать 10% веса..."
                className="w-full bg-slate-50 p-4 rounded-2xl font-bold outline-none border border-slate-100 text-base h-24 resize-none placeholder:text-slate-300"
              />
            </div>

            {bio.weight && (
              <div className="bg-slate-50 p-4 rounded-[28px] border border-slate-100 grid grid-cols-2 gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-blue-100 text-blue-500 rounded-xl flex items-center justify-center">
                    <Droplets size={14} />
                  </div>
                  <div>
                    <p className="text-[8px] font-black text-slate-400 uppercase leading-none mb-1">Норма воды</p>
                    <p className="text-xs font-black text-slate-700">~{calculateDefaultWater({ ...bio, weight: Number(bio.weight) } as any)} мл</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-orange-100 text-orange-500 rounded-xl flex items-center justify-center">
                    <Footprints size={14} />
                  </div>
                  <div>
                    <p className="text-[8px] font-black text-slate-400 uppercase leading-none mb-1">Цель шагов</p>
                    <p className="text-xs font-black text-slate-700">{calculateDefaultSteps(bio as any)} ш</p>
                  </div>
                </div>
              </div>
            )}

            {error && (
              <motion.div 
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-rose-50 border border-rose-100 p-4 rounded-2xl"
              >
                <p className="text-[10px] text-rose-500 font-black uppercase tracking-widest text-center">{error}</p>
              </motion.div>
            )}

            <button 
              type="submit" 
              disabled={isSaving}
              className="w-full py-4 bg-slate-900 border-b-4 border-slate-950 text-white font-black rounded-3xl active:translate-y-1 active:border-b-0 transition-all shadow-lg flex items-center justify-center gap-2 text-xs uppercase tracking-widest"
            >
              {isSaving ? <Loader2 size={18} className="animate-spin" /> : (user.bio ? 'Сохранить изменения' : 'Рассчитать нормы')}
            </button>
          </form>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

const getMealTypeName = (type: string) => {
  const map: Record<string, string> = {
    'breakfast': 'Завтрак',
    'lunch': 'Обед',
    'dinner': 'Ужин',
    'snack': 'Перекус',
    'water': 'Вода',
    'steps': 'Шаги'
  };
  return map[type] || type;
};

const MealEntryRow: React.FC<{ entry: DietEntry, idx: number, onRemove: (id: string) => void, onSelect: (entry: DietEntry) => void }> = ({ entry, idx, onRemove, onSelect }) => {
  const isWater = entry.mealType === 'water' || !!entry.water_ml;
  const isSteps = entry.mealType === 'steps' || !!entry.steps_count;
  const primaryName = entry.description || (entry.items && entry.items[0]?.productName) || (isWater ? "Прием воды" : isSteps ? "Активность" : "Прием пищи");

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: idx * 0.05 }}
      className={`p-4 rounded-3xl border shadow-sm flex flex-col gap-3 group active:scale-[0.98] transition-all cursor-pointer ${
        isWater ? 'bg-blue-50/30 border-blue-100' : isSteps ? 'bg-orange-50/30 border-orange-100' : 'bg-white border-slate-100'
      }`}
      onClick={() => onSelect(entry)}
    >
       <div className="flex justify-between items-start">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 shrink-0 aspect-square rounded-2xl flex items-center justify-center text-lg shadow-inner ${
              isWater ? 'bg-blue-100 text-blue-500' : isSteps ? 'bg-orange-100 text-orange-500' : 'bg-slate-50'
            }`}>
              {isWater ? <Droplets size={20} /> : 
               isSteps ? <Footprints size={20} /> : 
               (entry.mealType === 'breakfast' ? '🍳' : entry.mealType === 'lunch' ? '🍱' : entry.mealType === 'dinner' ? '🍲' : '🍫')}
            </div>
            <div className="text-left">
              <h4 className="text-sm font-black text-slate-900 line-clamp-1">{primaryName}</h4>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest leading-none">
                {isWater ? 'Водный баланс' : isSteps ? 'Шаги' : getMealTypeName(entry.mealType)} • {new Date(entry.timestamp).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })} {formatTime24(new Date(entry.timestamp))}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {!isWater && !isSteps && <ScoreBadge score={entry.health_score} warningType={entry.warningType} />}
            <button 
              onClick={(e) => { e.stopPropagation(); onRemove(entry.id); }}
              className="p-2.5 text-slate-300 hover:text-rose-500 transition-colors cursor-pointer"
              title="Удалить запись"
            >
              <Trash2 size={14} />
            </button>
            <ChevronRight size={16} className="text-slate-200" />
          </div>
       </div>

       <div className="grid grid-cols-5 gap-1 pt-2 border-t border-slate-50">
          {!isWater && !isSteps ? (
            <>
              <div className="text-center">
                <p className="text-[7px] uppercase font-bold text-slate-400">Вес</p>
                <p className="text-[10px] font-black">{Math.round(entry.grams)}г</p>
              </div>
              <div className="text-center">
                <p className="text-[7px] uppercase font-bold text-slate-400">Ккал</p>
                <p className="text-[10px] font-black">{Math.round(entry.calories)}</p>
              </div>
              <div className="text-center">
                 <p className="text-[7px] uppercase font-bold text-slate-400">Белки</p>
                 <p className="text-[10px] font-black text-emerald-600">{Math.round(entry.protein || 0)}г</p>
              </div>
              <div className="text-center">
                 <p className="text-[7px] uppercase font-bold text-slate-400">Жиры</p>
                 <p className="text-[10px] font-black text-amber-500">{Math.round(entry.fat || 0)}г</p>
              </div>
              <div className="text-center">
                 <p className="text-[7px] uppercase font-bold text-slate-400">Углев</p>
                 <p className="text-[10px] font-black text-blue-500">{Math.round(entry.carbs || 0)}г</p>
              </div>
            </>
          ) : (
            <>
              <div className="text-center col-span-2">
                <p className="text-[7px] uppercase font-bold text-slate-400">{isWater ? 'Объем' : 'Кол-во'}</p>
                <p className="text-[10px] font-black">{Math.round((isWater ? entry.water_ml : entry.steps_count) || 0)}{isWater ? ' мл' : ' ш'}</p>
              </div>
              <div className="text-center col-span-3 flex items-center justify-end px-2">
                 <span className={`text-[10px] font-black uppercase tracking-tighter ${isWater ? 'text-blue-500' : 'text-orange-500'}`}>
                   {isWater ? 'Влага восполнена' : 'Активность учтена'}
                 </span>
              </div>
            </>
          )}
       </div>
    </motion.div>
  );
};

const MealDetailModal = ({ entry, onClose }: { entry: DietEntry | null, onClose: () => void }) => {
  if (!entry) return null;
  const isWater = entry.mealType === 'water' || !!entry.water_ml;
  const isSteps = entry.mealType === 'steps' || !!entry.steps_count;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[110] flex items-center justify-center p-6">
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
        />
        <motion.div 
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 20 }}
          className="relative w-full max-w-sm bg-white rounded-[40px] p-6 shadow-2xl space-y-6 overflow-hidden max-h-[90vh] flex flex-col"
        >
          <div className="flex justify-between items-start">
            <div className="flex items-center gap-4">
               <div className={`w-12 h-12 shrink-0 aspect-square rounded-2xl flex items-center justify-center text-2xl shadow-inner ${
                 isWater ? 'bg-blue-100 text-blue-500' : isSteps ? 'bg-orange-100 text-orange-500' : 'bg-slate-50'
               }`}>
                {isWater ? <Droplets size={24} /> : 
                 isSteps ? <Footprints size={24} /> : 
                 (entry.mealType === 'breakfast' ? '🍳' : entry.mealType === 'lunch' ? '🍱' : entry.mealType === 'dinner' ? '🍲' : '🍫')}
               </div>
               <div className="text-left">
                 <h3 className="text-lg font-black text-slate-900 leading-tight">
                   {isWater ? 'Водный баланс' : isSteps ? 'Активность' : 'Прием пищи'}
                 </h3>
                 <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest leading-none mt-1">
                   {new Date(entry.timestamp).toLocaleDateString('ru-RU')} • {formatTime24(new Date(entry.timestamp))}
                 </p>
               </div>
            </div>
            {!isWater && !isSteps && <ScoreBadge score={entry.health_score} warningType={entry.warningType} />}
          </div>

          <div className="flex-1 overflow-y-auto space-y-6 custom-scrollbar pr-1">
            {entry.description && (
              <div className="bg-slate-50 p-4 rounded-3xl text-left border border-slate-100">
                <p className="text-[10px] text-slate-400 font-black uppercase mb-1 tracking-widest">Описание</p>
                <p className="text-sm font-medium text-slate-700 italic">"{entry.description}"</p>
              </div>
            )}

            {!isWater && !isSteps ? (
              <div className="grid grid-cols-4 gap-2 text-center">
                <div className="bg-slate-50 rounded-2xl p-3 border border-slate-100">
                  <p className="text-[9px] text-slate-400 uppercase font-black tracking-widest">Ккал</p>
                  <p className="text-xs font-black text-slate-900 mt-1">{Math.round(entry.calories)}</p>
                </div>
                <div className="bg-emerald-50 rounded-2xl p-3 border border-emerald-100">
                  <p className="text-[9px] text-emerald-600 uppercase font-black tracking-widest">Белки</p>
                  <p className="text-xs font-black text-emerald-700 mt-1">{Math.round(entry.protein || 0)}г</p>
                </div>
                <div className="bg-amber-50 rounded-2xl p-3 border border-amber-100">
                  <p className="text-[9px] text-amber-600 uppercase font-black tracking-widest">Жиры</p>
                  <p className="text-xs font-black text-amber-700 mt-1">{Math.round(entry.fat || 0)}г</p>
                </div>
                <div className="bg-blue-50 rounded-2xl p-3 border border-blue-100">
                  <p className="text-[9px] text-blue-600 uppercase font-black tracking-widest">Углев</p>
                  <p className="text-xs font-black text-blue-700 mt-1">{Math.round(entry.carbs || 0)}г</p>
                </div>
              </div>
            ) : (
              <div className={`p-6 rounded-3xl text-center border ${isWater ? 'bg-blue-50 border-blue-100' : 'bg-orange-50 border-orange-100'}`}>
                <p className="text-xs font-black text-slate-500 uppercase tracking-widest mb-2">Всего добавлено</p>
                <p className={`text-4xl font-black ${isWater ? 'text-blue-600' : 'text-orange-600'}`}>
                  {(isWater ? entry.water_ml : entry.steps_count) || 0}
                  <span className="text-xl ml-1 font-bold">{isWater ? 'мл' : 'шагов'}</span>
                </p>
              </div>
            )}

            {entry.items && entry.items.length > 0 && (
              <div className="space-y-3">
                <h4 className="text-[10px] font-black uppercase text-slate-400 tracking-wider text-left pl-1">Детальный состав:</h4>
                <div className="space-y-2">
                  {entry.items.map((item, i) => (
                    <div key={i} className="bg-slate-50/50 border border-slate-100 p-4 rounded-3xl space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="text-xs font-black text-slate-800 truncate max-w-[170px]">{item.productName}</span>
                        <ScoreBadge score={item.health_score} warningType={item.warningType} />
                      </div>
                      <div className="grid grid-cols-4 gap-2 text-center">
                        <div>
                          <p className="text-[7px] text-slate-400 uppercase font-bold">Вес</p>
                          <p className="text-[10px] font-black">{Math.round(item.grams)}г</p>
                        </div>
                        <div>
                          <p className="text-[7px] text-emerald-400 uppercase font-bold">Б</p>
                          <p className="text-[10px] font-black text-emerald-600">{Math.round(item.protein)}г</p>
                        </div>
                        <div>
                          <p className="text-[7px] text-amber-400 uppercase font-bold">Ж</p>
                          <p className="text-[10px] font-black text-amber-600">{Math.round(item.fat)}г</p>
                        </div>
                        <div>
                          <p className="text-[7px] text-blue-400 uppercase font-bold">У</p>
                          <p className="text-[10px] font-black text-blue-600">{Math.round(item.carbs)}г</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <button 
            onClick={onClose}
            className="w-full py-4 bg-slate-900 border-b-4 border-slate-950 text-white font-black rounded-[24px] active:translate-y-1 active:border-b-0 transition-all shadow-lg text-sm uppercase tracking-widest"
          >
            Закрыть
          </button>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

const ConfirmModal = ({ 
  title, 
  message, 
  confirmText, 
  cancelText, 
  onConfirm, 
  onCancel,
  icon,
  variant = 'default'
}: { 
  title: string, 
  message: string, 
  confirmText: string, 
  cancelText: string, 
  onConfirm: () => void, 
  onCancel: () => void,
  icon?: React.ReactNode,
  variant?: 'default' | 'danger'
}) => {
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-6">
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
        onClick={onCancel}
      />
      <motion.div 
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 20 }}
        className="relative w-full max-w-xs bg-white rounded-[32px] p-6 shadow-2xl space-y-6 text-center"
      >
        <div className="flex justify-center">
          {variant === 'danger' ? (
            <div className="w-20 h-20 bg-rose-50 rounded-[32px] flex items-center justify-center">
              <Trash2 size={32} className="text-rose-500" />
            </div>
          ) : (
            <div className="text-4xl">{icon || "⚠️"}</div>
          )}
        </div>
        <div className="space-y-2">
          <h3 className="text-lg font-black text-slate-900 leading-tight">{title}</h3>
          <p className="text-sm text-slate-500 font-medium leading-relaxed">{message}</p>
        </div>
        <div className="flex gap-3 pt-2">
          <button 
            type="button"
            onClick={onCancel}
            className="flex-1 py-4 bg-slate-50 text-slate-500 rounded-2xl font-black text-[10px] uppercase hover:bg-slate-100 transition-colors active:scale-95"
          >
            {cancelText}
          </button>
          <button 
            type="button"
            onClick={onConfirm}
            className={`flex-[1.5] py-4 ${variant === 'danger' ? 'bg-rose-500 shadow-rose-200 hover:bg-rose-600' : 'bg-emerald-500 shadow-emerald-200 hover:bg-emerald-600'} text-white rounded-2xl font-black text-[10px] uppercase shadow-lg transition-all active:scale-95`}
          >
            {confirmText}
          </button>
        </div>
      </motion.div>
    </div>
  );
};

export default function App() {
  const [isAppReady, setIsAppReady] = useState(false);
  const [currentUserCode, setCurrentUserCode] = useState<string | null>(null);
  const [showInstructions, setShowInstructions] = useState(false);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'products' | 'diet' | 'profile' | 'settings' | 'instructions' | 'scan' | 'productDetail'>('dashboard');
  const [products, setProducts] = useState<Product[]>([]);
  const [diet, setDiet] = useState<DietEntry[]>([]);
  const [user, setUser] = useState<UserProfile>({ 
    xp: 0, 
    level: 1, 
    streak: 0, 
    streakAvgScore: 0,
    lastActive: Date.now(),
    registeredAt: Date.now(),
    settings: {
      trackWater: true,
      trackSteps: true
    }
  });
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [aiAdvice, setAiAdvice] = useState<string>("Нажмите на кнопку обновления (↻), чтобы получить совет от AI-диетолога.");
  const [isAdviceLoading, setIsAdviceLoading] = useState(false);
  const [inputText, setInputText] = useState('');
  const [scanMode, setScanMode] = useState<'camera' | 'text'>('camera');
  const [isProfileSetupOpen, setIsProfileSetupOpen] = useState(false);
  const [isGoalExpanded, setIsGoalExpanded] = useState(false);
  const [isImportConfirmOpen, setIsImportConfirmOpen] = useState(false);
  const [entryToDelete, setEntryToDelete] = useState<DietEntry | null>(null);

  const avatarInputRef = React.useRef<HTMLInputElement>(null);
  const importInputRef = React.useRef<HTMLInputElement>(null);
  const [isEditingName, setIsEditingName] = useState(false);
  const [tempName, setTempName] = useState('');

  const [selectedEntryDetail, setSelectedEntryDetail] = useState<DietEntry | null>(null);
  const [geminiApiKey, setGeminiApiKey] = useState<string>(() => localStorage.getItem('user_gemini_api_key') || '');
  const [settingsApiKey, setSettingsApiKey] = useState(geminiApiKey);

  // Sync API Key removed - will be manual via button in settings

  // Meal Audit state
  const [isMealAuditing, setIsMealAuditing] = useState(false);
  
  const deleteProduct = (id: string) => {
    setProducts(prev => prev.filter(p => p.id !== id));
    if (currentUserCode) {
      deleteProductFromStore(currentUserCode, id).catch(err => console.error("Error deleting product from cloud:", err));
    }
  };

  const deleteDietEntry = (id: string) => {
    setDiet(prev => prev.filter(d => d.id !== id));
    if (currentUserCode) {
      deleteDietEntryFromStore(currentUserCode, id).catch(err => console.error("Error deleting diet entry from cloud:", err));
    }
  };

  const [mealInput, setMealInput] = useState('');
  const [entryType, setEntryType] = useState<'meal' | 'water' | 'steps'>('meal');
  const [entryAdvice, setEntryAdvice] = useState<string | null>(null);
  const [mealCategory, setMealCategory] = useState<MealType>('lunch');
  const [mealTime, setMealTime] = useState(formatTime24(new Date()));
  const [activePreset, setActivePreset] = useState<string | null>('сейчас');
  const [quickTimePresets, setQuickTimePresets] = useState<string[]>(() => {
    const saved = localStorage.getItem('diet_quick_time_presets');
    return saved ? JSON.parse(saved) : ['15 мин назад', 'час назад', '2 часа назад'];
  });

  useEffect(() => {
    localStorage.setItem('diet_quick_time_presets', JSON.stringify(quickTimePresets));
  }, [quickTimePresets]);

  // Temporal Integrity (Strict Timestamps) - but allow user to adjust for the diary
  const calculateOffsetTime = (preset: string) => {
    const now = new Date();
    const offsets: Record<string, number> = {
      'сейчас': 0,
      '5 мин назад': -5,
      '5 минут назад': -5,
      '10 мин назад': -10,
      '10 минут назад': -10,
      '15 мин назад': -15,
      '15 минут назад': -15,
      '30 мин назад': -30,
      '30 минут назад': -30,
      'час назад': -60,
      '1 час назад': -60,
      '2 часа назад': -120,
      'два часа назад': -120,
      '3 часа назад': -180,
      'три часа назад': -180
    };
    const offset = offsets[preset] ?? 0;
    const target = new Date(now.getTime() + offset * 60 * 1000);
    return formatTime24(target);
  };

  const QUICK_TIME_OPTIONS = [
    '5 мин назад',
    '10 мин назад',
    '15 мин назад',
    '30 мин назад',
    'час назад',
    '2 часа назад',
    '3 часа назад'
  ];

  const [mealAuditResult, setMealAuditResult] = useState<MealAuditResult | null>(null);

  // Analysis state
  const [scanResult, setScanResult] = useState<Partial<Product> | null>(null);
  
  // Update level based on XP
  useEffect(() => {
    const newLevel = calculateLevel(user.xp);
    if (newLevel !== user.level) {
      setUser(prev => ({ ...prev, level: newLevel }));
    }
  }, [user.xp]);

  // XP and Streak Calculation Engine
  useEffect(() => {
    if (!isAppReady) return;
    
    // Group diet entries by day (YYYY-MM-DD)
    const entriesByDay: Record<string, DietEntry[]> = {};
    diet.forEach(entry => {
      const day = formatDateISO(new Date(entry.timestamp));
      if (!entriesByDay[day]) entriesByDay[day] = [];
      entriesByDay[day].push(entry);
    });

    const todayStr = formatDateISO(new Date());
    const now = new Date();
    const isPast21UTC = now.getUTCHours() >= 21;
    
    const days = Object.keys(entriesByDay).sort();
    
    // XP should NOT reset to 0 even if diary is empty (it's a lifetime counter)
    if (days.length === 0) return;

    let accumulatedXp = 0;
    let streakCount = 0;
    let currentStreakScores: number[] = [];
    let consecutiveInactivity = 0;

    const startDate = parseISODate(days[0]);
    const endDate = parseISODate(todayStr);
    const dayIterator = new Date(startDate);
    
    while (dayIterator <= endDate) {
      const dayStr = formatDateISO(dayIterator);
      const dayEntries = entriesByDay[dayStr];
      const isToday = dayStr === todayStr;
      
      if (dayEntries && dayEntries.length > 0) {
        consecutiveInactivity = 0;
        const avgScore = dayEntries.reduce((sum, e) => sum + e.health_score, 0) / dayEntries.length;

        // Base Passive Multiplier
        let streakMultiplier = 0;
        if (streakCount >= 60) streakMultiplier = 0.50;
        else if (streakCount >= 30) streakMultiplier = 0.25;
        else if (streakCount >= 10) streakMultiplier = 0.15;
        else if (streakCount >= 3) streakMultiplier = 0.10;

        // Active XP (Granted immediately when goals met)
        let dailyActiveXp = 0;
        if (user.goals) {
          const stats = {
            cal: dayEntries.reduce((sum, e) => sum + (e.calories || 0), 0),
            pro: dayEntries.reduce((sum, e) => sum + (e.protein || 0), 0),
            water: dayEntries.reduce((sum, e) => sum + (e.water_ml || 0), 0),
            steps: dayEntries.reduce((sum, e) => sum + (e.steps_count || 0), 0),
          };

          const calTarget = user.goals.calories || 2000;
          const isCalOk = stats.cal >= calTarget * 0.8 && stats.cal <= calTarget * 1.2;
          const isProOk = stats.pro >= (user.goals.protein || 0) * 0.8;
          
          if (isCalOk && isProOk) {
            dailyActiveXp = 30;
          }
        }

        // Passive XP and Streak Bonuses (Finalized at 21:00 UTC or for past days)
        let passiveBase = 0;
        const canFinalizePassive = !isToday || isPast21UTC;

        if (canFinalizePassive && avgScore >= 50) {
          const bracket = Math.floor(avgScore / 10) * 10;
          passiveBase = (bracket / 100) * 30;
        }

        const streakBonus = canFinalizePassive ? (passiveBase * streakMultiplier) : 0;
        
        accumulatedXp += dailyActiveXp + passiveBase + streakBonus;

        if (avgScore >= 50) {
          streakCount++;
          currentStreakScores.push(avgScore);
        } else {
          streakCount = 0;
          currentStreakScores = [];
        }
      } else {
        consecutiveInactivity++;
        if (consecutiveInactivity >= 5) {
          streakCount = 0;
          currentStreakScores = [];
        }
      }
      dayIterator.setDate(dayIterator.getDate() + 1);
    }

    const avgStreakScore = currentStreakScores.length > 0 
      ? currentStreakScores.reduce((a, b) => a + b, 0) / currentStreakScores.length 
      : 0;
    
    // XP MUST NOT DECREASE. Use Math.max to ensure it only goes forward.
    const finalXp = Math.max(user.xp, Math.round(accumulatedXp));
    
    if (user.xp !== finalXp || user.streak !== streakCount || user.streakAvgScore !== avgStreakScore) {
      const updatedUser = { ...user, xp: finalXp, streak: streakCount, streakAvgScore: avgStreakScore };
      setUser(updatedUser);
      if (currentUserCode) {
        saveUserData(currentUserCode, { user: updatedUser });
      }
    }
  }, [diet, user.goals, isAppReady, user.registeredAt]);

  const [dateFilter, setDateFilter] = useState<{ start: string; end: string }>({
    start: formatDateISO(new Date()),
    end: formatDateISO(new Date()),
  });
  const [showDateFilter, setShowDateFilter] = useState(false);

  const [dateRange, setDateRange] = useState<{start: Date, end: Date}>(() => {
    const end = new Date();
    end.setHours(23,59,59,999);
    const start = new Date();
    start.setHours(0,0,0,0);
    return { start, end };
  });
  const [pendingImportFile, setPendingImportFile] = useState<File | null>(null);


  useEffect(() => {
    const tg = (window as any).Telegram?.WebApp;
    const tgUser = tg?.initDataUnsafe?.user;
    let code = localStorage.getItem(STORAGE_KEYS.CURRENT_CODE);
    
    if (tgUser && tgUser.id) {
      // Deterministically encode Telegram ID into a valid 10-char Firestore key matching ^[A-Z2-9]+$
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      let num = Number(tgUser.id);
      let tgCode = '';
      while (num > 0) {
        tgCode = chars.charAt(num % 32) + tgCode;
        num = Math.floor(num / 32);
      }
      code = tgCode.padStart(10, 'A');
      localStorage.setItem(STORAGE_KEYS.CURRENT_CODE, code);
      
      // Auto-initialize Telegram user: create profile if needed and load remote data
      const tgName = tgUser.first_name || tgUser.username || 'Telegram User';
      setCurrentUserCode(code);
      
      (async () => {
        try {
          const remoteData = await loadUserData(code);
          if (remoteData) {
            // User profile exists in Firestore - load everything
            const loadedUser: UserProfile = {
              name: tgName,
              xp: 0,
              level: 1,
              streak: 0,
              lastActive: Date.now(),
              registeredAt: Date.now(),
              ...(remoteData.user || {})
            };
            setUser(loadedUser);
            setProducts(remoteData.products || []);
            setDiet(remoteData.diet || []);
            localStorage.setItem(STORAGE_KEYS.USER(code), JSON.stringify(loadedUser));
            localStorage.setItem(STORAGE_KEYS.PRODUCTS(code), JSON.stringify(remoteData.products || []));
            localStorage.setItem(STORAGE_KEYS.DIET(code), JSON.stringify(remoteData.diet || []));
          } else {
            // First time opening - create profile in Firestore
            try {
              await createUserProfile(code, tgName);
            } catch (e) {
              console.warn('Could not create TG profile, may already exist:', e);
            }
            // Still try to load diet entries (bot may have synced them before profile existed)
            try {
              const freshData = await loadUserData(code);
              if (freshData && freshData.diet && freshData.diet.length > 0) {
                setDiet(freshData.diet);
                localStorage.setItem(STORAGE_KEYS.DIET(code), JSON.stringify(freshData.diet));
              }
            } catch (e) {
              console.warn('Could not load diet after profile creation:', e);
            }
            const newUser: UserProfile = { name: tgName, xp: 0, level: 1, streak: 0, lastActive: Date.now(), registeredAt: Date.now() };
            setUser(newUser);
            localStorage.setItem(STORAGE_KEYS.USER(code), JSON.stringify(newUser));
          }
          await updateLastLogin(code).catch(() => {});
        } catch (e) {
          console.error('Error initializing Telegram user:', e);
          // Fallback to local-only init
          initUserData(code);
        }
        setIsAppReady(true);
      })();
      
      return; // Skip the normal init flow below
    }
    
    if (code) {
      setCurrentUserCode(code);
      initUserData(code);
    } else {
      setIsAppReady(true);
    }
  }, []);

  const initUserData = (code: string) => {
    const savedProducts = localStorage.getItem(STORAGE_KEYS.PRODUCTS(code));
    const savedDiet = localStorage.getItem(STORAGE_KEYS.DIET(code));
    const savedUser = localStorage.getItem(STORAGE_KEYS.USER(code));
    const savedAdvice = localStorage.getItem(STORAGE_KEYS.ADVICE(code));

    if (savedProducts) {
      const parsed = JSON.parse(savedProducts);
      // Normalize products to ensure camelCase warning fields exist
      const normalized = parsed.map((p: any) => ({
        ...p,
        warningType: p.warningType || p.warning_type || 'none',
        warningMessage: p.warningMessage || p.warning_message || ''
      }));
      setProducts(normalized);
    } else setProducts([]);

    if (savedDiet) setDiet(JSON.parse(savedDiet));
    else setDiet([]);
    
    if (savedUser) {
      const parsed = JSON.parse(savedUser);
      // Ensure registeredAt exists for accounting purposes
      if (!parsed.registeredAt) {
        parsed.registeredAt = Date.now();
      }
      setUser(parsed);
    } else {
      setUser({ 
        xp: 0, 
        level: 1, 
        streak: 0, 
        lastActive: Date.now(),
        registeredAt: Date.now()
      });
    }

    if (savedAdvice) {
      setAiAdvice(savedAdvice);
    }

    setTimeout(() => {
      setIsAppReady(true);
    }, 100);
  };

  // Sync Local Storage
  useEffect(() => {
    if (isAppReady && currentUserCode) {
      localStorage.setItem(STORAGE_KEYS.PRODUCTS(currentUserCode), JSON.stringify(products));
      localStorage.setItem(STORAGE_KEYS.USER(currentUserCode), JSON.stringify(user));
      localStorage.setItem(STORAGE_KEYS.DIET(currentUserCode), JSON.stringify(diet));
      localStorage.setItem(STORAGE_KEYS.ADVICE(currentUserCode), aiAdvice);
    }
  }, [products, user, diet, aiAdvice, isAppReady, currentUserCode]);

  // Real-time Cloud Sync
  useEffect(() => {
    if (!currentUserCode || !isAppReady) return;

    const unsubUser = subscribeToUserData(currentUserCode, (remoteUser) => {
      setUser(prev => ({ 
        ...prev, 
        ...remoteUser,
        // Maintain local-only properties if any (though currently all are cloud-synced)
      }));
    });

    const unsubDiet = subscribeToDiet(currentUserCode, (remoteDiet) => {
      // Basic reconciliation: only update if remote data differs significantly from local
      // Snapshot listener with !hasPendingWrites already handles local echoing nicely
      setDiet(remoteDiet);
    });

    const unsubProducts = subscribeToProducts(currentUserCode, (remoteProducts) => {
      setProducts(remoteProducts);
    });

    return () => {
      unsubUser();
      unsubDiet();
      unsubProducts();
    };
  }, [currentUserCode, isAppReady]);

  const handleAuth = async (code: string, isNew: boolean, name?: string) => {
    setIsAppReady(false); // Reset ready state during auth change
    
    if (isNew) {
      localStorage.setItem(STORAGE_KEYS.CURRENT_CODE, code);
      setCurrentUserCode(code);
      const newUser: UserProfile = { 
        name, 
        xp: 0, 
        level: 1, 
        streak: 0, 
        lastActive: Date.now(),
        registeredAt: Date.now()
      };
      setUser(newUser);
      setProducts([]);
      setDiet([]);
      localStorage.setItem(STORAGE_KEYS.USER(code), JSON.stringify(newUser));
      localStorage.setItem(STORAGE_KEYS.PRODUCTS(code), JSON.stringify([]));
      localStorage.setItem(STORAGE_KEYS.DIET(code), JSON.stringify([]));
      
      // Save initial state to Firestore
      await saveUserData(code, { user: newUser });
      setIsAppReady(true);
    } else {
      // Try to load from Firestore first for cross-device support
      try {
        const remoteData = await loadUserData(code);
        if (remoteData) {
          const loadedUser: UserProfile = {
            xp: 0,
            level: 1,
            streak: 0,
            lastActive: Date.now(),
            registeredAt: Date.now(),
            ...(remoteData.user || {})
          };
          setUser(loadedUser);
          setProducts(remoteData.products || []);
          setDiet(remoteData.diet || []);
          
          // Sync to local
          localStorage.setItem(STORAGE_KEYS.USER(code), JSON.stringify(loadedUser));
          localStorage.setItem(STORAGE_KEYS.PRODUCTS(code), JSON.stringify(remoteData.products));
          localStorage.setItem(STORAGE_KEYS.DIET(code), JSON.stringify(remoteData.diet));
          
          localStorage.setItem(STORAGE_KEYS.CURRENT_CODE, code);
          setCurrentUserCode(code);
          setIsAppReady(true);
        } else {
          // Fallback to local if nothing in cloud
          localStorage.setItem(STORAGE_KEYS.CURRENT_CODE, code);
          setCurrentUserCode(code);
          initUserData(code);
        }
      } catch (err) {
        console.error("Auth error:", err);
        initUserData(code);
      }
    }
  };

  const handleSaveBio = async (bio: any) => {
    const [calculatedGoals, refinedGoalText] = await Promise.all([
      calculatePersonalGoals(bio),
      refineGoal(bio)
    ]);
    
    const updatedBio = { 
      ...bio, 
      refinedGoal: refinedGoalText,
      waterTarget: calculatedGoals.water,
      stepsTarget: calculatedGoals.steps
    };
    
    setUser(prev => ({
      ...prev,
      bio: updatedBio,
      goals: calculatedGoals
    }));

    if (currentUserCode) {
      saveUserData(currentUserCode, { 
        user: { 
          ...user,
          bio: updatedBio,
          goals: calculatedGoals
        } 
      });
    }
  };

  const logout = () => {
    setIsAppReady(false);
    localStorage.removeItem(STORAGE_KEYS.CURRENT_CODE);
    setCurrentUserCode(null);
    setProducts([]);
    setDiet([]);
    setUser({ 
      xp: 0, 
      level: 1, 
      streak: 0, 
      lastActive: Date.now(),
      registeredAt: Date.now()
    });
    setTimeout(() => {
      setIsAppReady(true);
    }, 100);
  };

  const lastFetchedDataRef = React.useRef<string>("");
  const lastAdviceErrorAt = React.useRef<number>(0);

  const fetchDailyInsights = async (currentDietData?: DietEntry[], isManual: boolean = false) => {
    const dietToUse = currentDietData || diet;
    const today = new Date().toDateString();
    const currentTodayDiet = dietToUse.filter(d => d.timestamp && new Date(d.timestamp).toDateString() === today);
    
    // Create a unique key for current data to avoid redundant AI calls
    const currentDataKey = JSON.stringify({
      count: currentTodayDiet.length,
      goals: user.goals,
      lastItem: currentTodayDiet.length > 0 ? currentTodayDiet[currentTodayDiet.length - 1].timestamp : 0
    });

    // Check if we already have advice for this data
    if (!isManual && currentDataKey === lastFetchedDataRef.current && aiAdvice !== "Анализирую ваш рацион за сегодня...") {
      return;
    }

    // Rate limit cooldown (5 minutes) - only for auto-trigger
    const COOLDOWN_MS = 5 * 60 * 1000;
    if (!isManual && lastAdviceErrorAt.current && (Date.now() - lastAdviceErrorAt.current < COOLDOWN_MS)) {
      return;
    }

    setIsAdviceLoading(true);
    try {
      console.log("Daily Insights Request:", { items: currentTodayDiet.length, goals: user.goals, manual: isManual });
      
      const advice = await getDailyAdvice(currentTodayDiet, user.goals);
      if (advice) {
        setAiAdvice(advice);
        lastFetchedDataRef.current = currentDataKey;
        // Reset error timer on success
        if (advice.includes("Совет временно недоступен") || advice.includes("перегружен")) {
           lastAdviceErrorAt.current = Date.now();
        } else {
           lastAdviceErrorAt.current = 0;
        }
      }
    } catch (err: any) {
      console.warn("AI Advice Fetch Failed:", err);
      lastAdviceErrorAt.current = Date.now();
      const fallbacks = [
        "Следите за балансом БЖУ и пейте больше воды для поддержания энергии.",
        "Старайтесь добавлять больше свежих овощей к каждому приему пищи.",
        "Помните о важности белка для восстановления мышц и сытости.",
        "Разнообразие — залог здоровья. Попробуйте добавить новые продукты в рацион."
      ];
      setAiAdvice(fallbacks[Math.floor(Math.random() * fallbacks.length)]);
    } finally {
      setIsAdviceLoading(false);
    }
  };

  const addDietEntry = (productId: string, grams: number, mealType: MealType) => {
    let product = products.find(p => p.id === productId);
    const isWater = productId === WATER_PRODUCT_ID || productId === 'water-001' || (product?.category === 'water');
    const isSteps = productId === STEPS_PRODUCT_ID || productId === 'steps-001' || (product?.category === 'steps');

    if (!product) {
      if (isWater) product = WATER_PRODUCT;
      else if (isSteps) product = STEPS_PRODUCT;
    }

    if (!product || !product.nutrition) return;

    const cals = ((product.nutrition.calories || 0) * grams) / 100;
    const prot = ((product.nutrition.protein || 0) * grams) / 100;
    const fats = ((product.nutrition.fat || 0) * grams) / 100;
    const carb = ((product.nutrition.carbs || 0) * grams) / 100;

    const newItem = {
      productId,
      productName: product.name,
      grams,
      calories: cals,
      health_score: product.health_score || 0,
      protein: prot,
      fat: fats,
      carbs: carb,
    };

    const now = Date.now();
    // Disable merging to keep entries separate as per user request
    const existingEntryIndex = -1;

    if (existingEntryIndex !== -1) {
      const updatedDiet = [...diet];
      const entry = { ...updatedDiet[existingEntryIndex] };
      entry.items = [...(entry.items || []), newItem];
      entry.grams += grams;
      entry.calories += cals;
      entry.protein += prot;
      entry.fat += fats;
      entry.carbs += carb;
      
      const totalWeight = entry.grams;
      let totalHealthPoints = 0;
      entry.items.forEach(it => { totalHealthPoints += it.health_score * it.grams; });
      entry.health_score = Math.round(totalHealthPoints / totalWeight);

      updatedDiet[existingEntryIndex] = entry;
      setDiet(updatedDiet);
      if (currentUserCode) {
        saveDietEntryToStore(currentUserCode, entry).catch(console.error);
      }
    } else {
      const entry: DietEntry = {
        id: crypto.randomUUID(),
        mealType,
        grams: isWater || isSteps ? 0 : grams,
        calories: cals,
        health_score: isWater || isSteps ? 100 : (product.health_score || 0),
        protein: prot,
        fat: fats,
        carbs: carb,
        timestamp: now,
        items: isWater || isSteps ? [] : [newItem],
        water_ml: isWater ? grams : undefined,
        steps_count: isSteps ? grams : undefined,
        description: isWater ? 'Прием воды' : isSteps ? 'Активность' : undefined
      };
      setDiet([...diet, entry]);
      if (currentUserCode) {
        saveDietEntryToStore(currentUserCode, entry).catch(console.error);
      }
    }
    setActiveTab('diet');
  };

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = () => {
      const img = new Image();
      img.src = reader.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const size = 200; // Profile pic size
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          // Draw image centered and cropped to square
          const minDim = Math.min(img.width, img.height);
          const sx = (img.width - minDim) / 2;
          const sy = (img.height - minDim) / 2;
          ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, size, size);
          const base64 = canvas.toDataURL('image/jpeg', 0.8);
          const updatedUser = { ...user, avatarUrl: base64 };
          setUser(updatedUser);
          if (currentUserCode) {
            localStorage.setItem(STORAGE_KEYS.USER(currentUserCode), JSON.stringify(updatedUser));
            saveUserData(currentUserCode, { user: updatedUser });
          }
        }
      };
    };
    reader.readAsDataURL(file);
  };

  const handleUpdateName = async () => {
    if (tempName.trim()) {
      const updatedUser = { ...user, name: tempName.trim() };
      setUser(updatedUser);
      if (currentUserCode) {
        localStorage.setItem(STORAGE_KEYS.USER(currentUserCode), JSON.stringify(updatedUser));
        await saveUserData(currentUserCode, { user: updatedUser });
      }
    }
    setIsEditingName(false);
  };

  const handleScan = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsLoading(true);
    const reader = new FileReader();
    reader.onloadend = async () => {
      const img = new Image();
      img.src = reader.result as string;
      img.onload = async () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 1024;
        const MAX_HEIGHT = 1024;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);
        
        const resizedImage = canvas.toDataURL('image/jpeg', 0.8);
        
        try {
          const aiResult = await analyzeProduct({ image: resizedImage }, products);
          
          if (aiResult.error) {
            alert("AI Анализ: " + aiResult.error);
            return;
          }

          // Map AnalysisResult to Partial<Product> for state consistency
          const result: Partial<Product> & { warning_type?: string, warning_message?: string } = {
            ...aiResult,
            warningType: aiResult.warning_type,
            warningMessage: aiResult.warning_message,
            // Keep snake_case for backward compatibility with some UI bits if any
            warning_type: aiResult.warning_type,
            warning_message: aiResult.warning_message
          };

          setScanResult(result);
          setActiveTab('scan');
        } catch (err: any) {
          console.error(err);
          alert("Ошибка анализа: " + err.message);
        } finally {
          setIsLoading(false);
        }
      };
    };
    reader.readAsDataURL(file);
  };

  const saveProduct = () => {
    if (!scanResult) return;
    const newProduct: Product = {
      id: crypto.randomUUID(),
      name: scanResult.name || 'Без названия',
      ingredients: scanResult.ingredients || [],
      health_score: scanResult.health_score || 0,
      nutrition: scanResult.nutrition || { calories: 0, protein: 0, fat: 0, carbs: 0 },
      verdict: scanResult.verdict || '',
      category: (scanResult as any).category,
      warningType: scanResult.warningType || (scanResult as any).warning_type || 'none',
      warningMessage: scanResult.warningMessage || (scanResult as any).warning_message || '',
      createdAt: Date.now()
    };
    setProducts([newProduct, ...products]);
    if (currentUserCode) {
      saveProductToStore(currentUserCode, newProduct).catch(console.error);
    }
    setSelectedProduct(newProduct);
    setScanResult(null);
    setActiveTab('productDetail');
  };

  const quickAddToDiary = (mealType: string, dateStr: string, timeStr: string, grams: number, existingProduct?: Product) => {
    let productToUse = existingProduct;
    if (!productToUse && scanResult) {
      if ((scanResult as any).matched_product_id) {
        productToUse = products.find(p => p.id === (scanResult as any).matched_product_id);
      }
      if (!productToUse) {
        productToUse = {
          id: crypto.randomUUID(),
          name: scanResult.name || 'Без названия',
          ingredients: scanResult.ingredients || [],
          health_score: scanResult.health_score || 0,
          nutrition: scanResult.nutrition || { calories: 0, protein: 0, fat: 0, carbs: 0 },
          verdict: scanResult.verdict || '',
          category: (scanResult as any).category,
          warningType: scanResult.warningType || (scanResult as any).warning_type || 'none',
          warningMessage: scanResult.warningMessage || (scanResult as any).warning_message || '',
          createdAt: Date.now()
        };
        setProducts(prev => [productToUse!, ...prev]);
        if (currentUserCode) {
          saveProductToStore(currentUserCode, productToUse).catch(console.error);
        }
      }
    }
    if (!productToUse) return;

    // Combine dateStr and timeStr into a timestamp
    const [year, month, day] = dateStr.split('-').map(Number);
    const [hour, minute] = timeStr.split(':').map(Number);
    const timestamp = new Date(year, month - 1, day, hour, minute).getTime();
    
    const factor = grams / 100;
    
    const newEntry: DietEntry = {
      id: crypto.randomUUID(),
      mealType: mealType as MealType,
      grams: grams,
      calories: Math.round(productToUse.nutrition.calories * factor),
      protein: Math.round(productToUse.nutrition.protein * factor * 10) / 10,
      fat: Math.round(productToUse.nutrition.fat * factor * 10) / 10,
      carbs: Math.round(productToUse.nutrition.carbs * factor * 10) / 10,
      health_score: productToUse.health_score,
      warningType: productToUse.warningType,
      timestamp,
      items: [{
        productId: productToUse.id,
        productName: productToUse.name,
        grams: grams,
        calories: Math.round(productToUse.nutrition.calories * factor),
        protein: Math.round(productToUse.nutrition.protein * factor * 10) / 10,
        fat: Math.round(productToUse.nutrition.fat * factor * 10) / 10,
        carbs: Math.round(productToUse.nutrition.carbs * factor * 10) / 10,
        health_score: productToUse.health_score,
        warningType: productToUse.warningType
      }]
    };
    
    setDiet(prev => [...prev, newEntry]);
    if (currentUserCode) {
      saveDietEntryToStore(currentUserCode, newEntry).catch(console.error);
    }
    setScanResult(null);
    setActiveTab('diet');
  };

  const handleClearData = async () => {
    if (window.confirm('Вы уверены, что хотите безвозвратно удалить ВСЕ данные (профиль, историю, базу продуктов)? Это действие необратимо.')) {
      if (currentUserCode) {
        // Delete diet from cloud
        for (const entry of diet) {
          await deleteDietEntryFromStore(currentUserCode, entry.id).catch(console.error);
        }
        // Delete products from cloud
        for (const prod of products) {
          await deleteProductFromStore(currentUserCode, prod.id).catch(console.error);
        }
        // Reset user profile
        const emptyUser = { xp: 0, level: 1, streak: 0, lastActive: Date.now() };
        await saveUserData(currentUserCode, { user: emptyUser }).catch(console.error);
      }
      
      // Clear local state
      setDiet([]);
      setProducts([]);
      setUser({ xp: 0, level: 1, streak: 0, lastActive: Date.now() });
      
      localStorage.removeItem(STORAGE_KEYS.DIET(currentUserCode || ''));
      localStorage.removeItem(STORAGE_KEYS.PRODUCTS(currentUserCode || ''));
      localStorage.removeItem(STORAGE_KEYS.USER(currentUserCode || ''));
      localStorage.removeItem(STORAGE_KEYS.CURRENT_CODE);
      
      alert('Все данные успешно очищены.');
      window.location.reload();
    }
  };

  const handleExportData = () => {
    const backupData = {
      version: '2.1',
      timestamp: Date.now(),
      user,
      products,
      diet,
    };
    
    try {
      const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      // Use name if available, otherwise default
      const fileName = user.name ? user.name.replace(/[^a-zA-Z0-9А-Яа-я]/g, '_') : 'bioprisma';
      link.download = `${fileName}_backup_${formatDateISO(new Date())}.bpbackup`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      alert("Ошибка при создании бэкапа");
    }
  };

  const handleImportClick = () => {
    setIsImportConfirmOpen(true);
  };

  const handleConfirmImport = () => {
    setIsImportConfirmOpen(false);
    if (importInputRef.current) {
      importInputRef.current.value = '';
      importInputRef.current.click();
    }
  };

  const handleImportData = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const content = evt.target?.result as string;
        const data = JSON.parse(content);
        
        if (!data.user && !data.products && !data.diet) {
          throw new Error("Неверный формат файла");
        }

        // Use imported data or current state if imported is missing
        const importedUser = data.user || user;
        const importedProducts = data.products || products;
        const importedDiet = data.diet || diet;

        // CRITICAL: Save to localStorage first (Synchronous)
        if (currentUserCode) {
          localStorage.setItem(STORAGE_KEYS.USER(currentUserCode), JSON.stringify(importedUser));
          localStorage.setItem(STORAGE_KEYS.PRODUCTS(currentUserCode), JSON.stringify(importedProducts));
          localStorage.setItem(STORAGE_KEYS.DIET(currentUserCode), JSON.stringify(importedDiet));
        }

        // Update local state (Asynchronous React updates)
        setUser(importedUser);
        setProducts(importedProducts);
        setDiet(importedDiet);

        // Success message
        alert("Импорт завершен! Все данные профиля, продукты и рацион успешно восстановлены.");
        
        // Reset to dashboard to show changes
        setActiveTab('dashboard');

        // Sync with cloud in background
        if (currentUserCode) {
          saveUserData(currentUserCode, { user: importedUser });
          bulkSyncData(currentUserCode, { products: importedProducts, diet: importedDiet }).catch(err => {
            console.error("Could not sync imported data to cloud:", err);
          });
        }
        
        // Clear input
        if (importInputRef.current) importInputRef.current.value = '';
      } catch (err) {
        console.error("Import error:", err);
        alert("Ошибка при импорте. Убедитесь, что файл имеет формат .bpbackup и корректное содержимое.");
        e.target.value = '';
      }
    };
    reader.readAsText(file);
  };

  const handleTextScan = async (text: string) => {
    if (!text.trim()) return;
    setIsLoading(true);
    try {
      const aiResult = await analyzeProduct({ text }, products);
      
      if (aiResult.error) {
        alert("AI Анализ: " + aiResult.error);
        return;
      }

      // Map AnalysisResult to Partial<Product> for state consistency
      const result: Partial<Product> & { warning_type?: string, warning_message?: string } = {
        ...aiResult,
        warningType: aiResult.warning_type,
        warningMessage: aiResult.warning_message,
        // Keep snake_case for backward compatibility
        warning_type: aiResult.warning_type,
        warning_message: aiResult.warning_message
      };

      setScanResult(result);
      setActiveTab('scan');
    } catch (err: any) {
      console.error(err);
      alert("Ошибка сети или AI: " + (err.message || "Не удалось связаться с моделью."));
    } finally {
      setIsLoading(false);
    }
  };

  const handleMealAudit = async () => {
    if (!mealInput.trim()) return;
    setIsLoading(true);
    try {
      const allKnownProducts = products;
      const result = await analyzeMealDescription(mealInput, allKnownProducts);
      
      const waterItem = result.foundItems.find(it => it.productId === WATER_PRODUCT_ID || it.productId === 'water-001');
      const stepsItem = result.foundItems.find(it => it.productId === STEPS_PRODUCT_ID || it.productId === 'steps-001');
      const hasFood = result.foundItems.some(it => 
        it.productId !== WATER_PRODUCT_ID && 
        it.productId !== STEPS_PRODUCT_ID && 
        it.productId !== 'water-001' && 
        it.productId !== 'steps-001'
      );

      let detectedType: 'meal' | 'water' | 'steps' = entryType;
      if (stepsItem && !hasFood && !waterItem && user.settings?.trackSteps !== false) detectedType = 'steps';
      else if (waterItem && !hasFood && user.settings?.trackWater !== false) detectedType = 'water';
      else if (hasFood) detectedType = 'meal';

      if (detectedType !== entryType) {
        const typeNames = { meal: 'Прием пищи', water: 'Вода', steps: 'Шаги' };
        setEntryAdvice(`Мы определили это как «${typeNames[detectedType]}», в следующий раз выбирайте нужную категорию для точности.`);
        setEntryType(detectedType);
        if (detectedType === 'water') setMealCategory('water');
        else if (detectedType === 'steps') setMealCategory('steps');
        else if (mealCategory === 'water' || mealCategory === 'steps') setMealCategory('lunch');
      } else {
        setEntryAdvice(null);
      }

      setMealAuditResult(result);
    } catch (err) {
      alert("Ошибка аудита приема пищи");
    } finally {
      setIsLoading(false);
    }
  };

  const handlePhotoAudit = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsLoading(true);
    const reader = new FileReader();
    reader.onloadend = async () => {
      const img = new Image();
      img.src = reader.result as string;
      img.onload = async () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 1024;
        const MAX_HEIGHT = 1024;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);
        
        const resizedImage = canvas.toDataURL('image/jpeg', 0.8);
        
        try {
          const allKnownProducts = products;
          const result = await analyzeFoodImage(resizedImage, allKnownProducts);
          
          if (result.error) {
            alert("AI Анализ: " + result.error);
            return;
          }

          const waterItem = result.foundItems.find(it => it.productId === WATER_PRODUCT_ID || it.productId === 'water-001');
          const stepsItem = result.foundItems.find(it => it.productId === STEPS_PRODUCT_ID || it.productId === 'steps-001');
          const hasFood = result.foundItems.some(it => 
            it.productId !== WATER_PRODUCT_ID && 
            it.productId !== STEPS_PRODUCT_ID && 
            it.productId !== 'water-001' && 
            it.productId !== 'steps-001'
          );

          let detectedType: 'meal' | 'water' | 'steps' = entryType;
          if (stepsItem && !hasFood && !waterItem && user.settings?.trackSteps !== false) detectedType = 'steps';
          else if (waterItem && !hasFood && user.settings?.trackWater !== false) detectedType = 'water';
          else if (hasFood) detectedType = 'meal';

          if (detectedType !== entryType) {
            const typeNames = { meal: 'Прием пищи', water: 'Вода', steps: 'Шаги' };
            setEntryAdvice(`На фото обнаружено содержимое «${typeNames[detectedType]}», категория переключена.`);
            setEntryType(detectedType);
            if (detectedType === 'water') setMealCategory('water');
            else if (detectedType === 'steps') setMealCategory('steps');
            else if (mealCategory === 'water' || mealCategory === 'steps') setMealCategory('lunch');
          }

          setMealAuditResult(result);
        } catch (err: any) {
          console.error(err);
          alert("Ошибка анализа: " + err.message);
        } finally {
          setIsLoading(false);
        }
      };
    };
    reader.readAsDataURL(file);
  };

  const confirmMealAudit = () => {
    if (!mealAuditResult) return;
    
    // Use selected mealTime
    const [hours, minutes] = mealTime.split(':').map(Number);
    const entryDate = new Date();
    entryDate.setHours(hours, minutes, 0, 0);
    const selectedTimestamp = entryDate.getTime();
    
    const newItemsAdded: DietEntry[] = [];

    // Process system products (water, steps)
    const waterItem = mealAuditResult.foundItems.find(it => it.productId === WATER_PRODUCT_ID || it.productId === 'water-001');
    const stepsItem = mealAuditResult.foundItems.find(it => it.productId === STEPS_PRODUCT_ID || it.productId === 'steps-001');
    
    // Filter out system products from regular items list
    const filteredFoundItems = mealAuditResult.foundItems.filter(it => 
      it.productId !== WATER_PRODUCT_ID && it.productId !== STEPS_PRODUCT_ID && it.productId !== 'water-001' && it.productId !== 'steps-001'
    );

    // 1. Food Entry
    if (filteredFoundItems.length > 0) {
      const foodGrams = filteredFoundItems.reduce((sum, it) => sum + it.weight, 0);
      const foodCals = filteredFoundItems.reduce((sum, it) => sum + it.calories, 0);
      const foodP = filteredFoundItems.reduce((sum, it) => sum + it.protein, 0);
      const foodF = filteredFoundItems.reduce((sum, it) => sum + it.fat, 0);
      const foodC = filteredFoundItems.reduce((sum, it) => sum + it.carbs, 0);
      const foodScore = foodGrams > 0 
        ? Math.round(filteredFoundItems.reduce((sum, it) => sum + it.health_score * it.weight, 0) / foodGrams)
        : 0;

      const newItems = filteredFoundItems.map(item => ({
        productId: item.productId,
        productName: item.productName,
        grams: item.weight,
        calories: item.calories,
        health_score: item.health_score,
        protein: item.protein,
        fat: item.fat,
        carbs: item.carbs,
      }));

      newItemsAdded.push({
        id: crypto.randomUUID(),
        mealType: mealCategory,
        grams: foodGrams,
        calories: foodCals,
        health_score: foodScore,
        protein: foodP,
        fat: foodF,
        carbs: foodC,
        timestamp: selectedTimestamp,
        description: mealInput,
        items: newItems
      });
    }

    // 2. Water Entry
    if (waterItem && user.settings?.trackWater !== false) {
      newItemsAdded.push({
        id: crypto.randomUUID(),
        mealType: 'water',
        grams: 0,
        calories: 0,
        health_score: 100,
        protein: 0,
        fat: 0,
        carbs: 0,
        timestamp: selectedTimestamp,
        description: `Вода ${waterItem.weight}мл`,
        water_ml: waterItem.weight,
        items: []
      });
    }

    // 3. Steps Entry
    if (stepsItem && user.settings?.trackSteps !== false) {
      newItemsAdded.push({
        id: crypto.randomUUID(),
        mealType: 'steps',
        grams: 0,
        calories: 0,
        health_score: 100,
        protein: 0,
        fat: 0,
        carbs: 0,
        timestamp: selectedTimestamp,
        description: `Активность: ${stepsItem.weight} шагов`,
        steps_count: stepsItem.weight,
        items: []
      });
    }

    if (newItemsAdded.length > 0) {
      setDiet([...diet, ...newItemsAdded]);
      if (currentUserCode) {
        newItemsAdded.forEach(entry => {
          saveDietEntryToStore(currentUserCode, entry).catch(err => console.error("Error saving AI entry to cloud:", err));
        });
      }
    }

    setMealAuditResult(null);
    setIsMealAuditing(false);
    setMealInput('');
  };


  if (!isAppReady) {
    return (
      <div className="max-w-[375px] h-screen mx-auto bg-white flex flex-col items-center justify-center sm:border-8 sm:border-slate-900 sm:rounded-[40px] sm:shadow-2xl">
        <motion.div 
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="text-center space-y-4"
        >
          <div className="w-20 h-20 bg-emerald-500 rounded-3xl mx-auto flex items-center justify-center shadow-lg shadow-emerald-200">
            <Camera className="text-white w-10 h-10" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-emerald-600 tracking-tighter">БИОПРИЗМА</h1>
            <p className="text-[10px] text-slate-400 uppercase font-bold tracking-[0.2em]">AI Health Intelligence</p>
          </div>
          <div className="pt-8">
            <Loader2 className="animate-spin text-emerald-500 mx-auto" size={24} />
          </div>
        </motion.div>
      </div>
    );
  }

  if (!currentUserCode) {
    return (
      <div className="max-w-[375px] h-screen mx-auto bg-white flex flex-col items-center justify-center sm:border-8 sm:border-slate-900 sm:rounded-[40px] sm:shadow-2xl overflow-hidden">
        <AuthView onAuth={handleAuth} />
      </div>
    );
  }

  return (
    <div className="max-w-[375px] h-screen mx-auto bg-white overflow-hidden flex flex-col relative sm:border-8 sm:border-slate-900 sm:rounded-[40px] sm:shadow-2xl">
      {/* Meal Detail Modal */}
      <MealDetailModal entry={selectedEntryDetail} onClose={() => setSelectedEntryDetail(null)} />
      
      {/* App Header (Persistent area to prevent jumping) */}
      <header className="h-24 shrink-0 relative z-20 px-6 py-6 flex justify-between items-center">
        <div onClick={() => setActiveTab('dashboard')} className="cursor-pointer shrink-0">
          <h1 className="text-xl font-black tracking-tighter text-emerald-600 leading-none">БИОПРИЗМА</h1>
          <p className="text-[9px] text-slate-400 uppercase tracking-widest font-black mt-1">AI Health Scanner</p>
        </div>

        <div 
          onClick={() => setActiveTab('profile')}
          className="flex items-center bg-emerald-50 px-3 py-1.5 rounded-full border border-emerald-100 cursor-pointer hover:scale-105 transition-transform shrink-0"
        >
          <span className="text-emerald-700 text-xs font-black">{user.xp} XP</span>
          <div className="ml-2 w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 px-6 overflow-y-auto custom-scrollbar relative">
        <AnimatePresence mode="wait">
          <motion.div 
            key="app-content"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            transition={{ duration: 0.2, ease: "circOut" }}
            className="h-full flex flex-col"
          >
            <AnimatePresence mode="wait">
              {activeTab === 'dashboard' && <Dashboard key="dash" diet={diet} user={user} setActiveTab={setActiveTab} aiAdvice={aiAdvice} isAdviceLoading={isAdviceLoading} fetchAdvice={() => fetchDailyInsights(diet, true)} onOpenSetup={() => setIsProfileSetupOpen(true)} addDietEntry={addDietEntry} setDiet={setDiet} setSelectedProduct={setSelectedProduct} setShowInstructions={setShowInstructions} />}
              {activeTab === 'products' && <ProductList key="list" products={products} setSelectedProduct={setSelectedProduct} setActiveTab={setActiveTab} deleteProduct={deleteProduct} settings={user.settings} />}
              {activeTab === 'productDetail' && <ProductDetails key="detail" selectedProduct={selectedProduct} setActiveTab={setActiveTab} quickAddToDiary={quickAddToDiary} />}
              {activeTab === 'scan' && (
                  <ScanView 
                    key="scan" 
                    isLoading={isLoading} 
                    scanResult={scanResult} 
                    setScanResult={setScanResult} 
                    handleScan={handleScan} 
                    handleTextScan={handleTextScan} 
                    saveProduct={saveProduct}
                    scanMode={scanMode}
                    setScanMode={setScanMode}
                    inputText={inputText}
                    setInputText={setInputText}
                    quickAddToDiary={quickAddToDiary}
                  />
                )}
                {/* Tabs below will be handled by this AnimatePresence */}
          
          {activeTab === 'diet' && (
            <motion.div 
              key="diet"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -15 }}
              transition={{ duration: 0.2, ease: "circOut" }}
              className="space-y-4 pb-24"
            >
              <div className="flex justify-between items-center">
                <div className="flex flex-col gap-1 text-left">
                  <h2 className="text-2xl font-black">Дневник</h2>
                  <p className="text-[10px] text-slate-400 uppercase font-black tracking-widest leading-none">Хронология здоровья</p>
                </div>
                <div className="flex gap-2">
                  <button 
                    onClick={() => setShowDateFilter(!showDateFilter)}
                    className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all ${showDateFilter ? 'bg-slate-900 text-white shadow-xl' : 'bg-slate-50 text-slate-400 border border-slate-100 hover:bg-slate-100'}`}
                  >
                    <Calendar size={20} />
                  </button>
                </div>
              </div>

              <AnimatePresence>
                {showDateFilter && (
                  <motion.div 
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="bg-white border border-slate-100 rounded-3xl p-4 shadow-sm space-y-4 overflow-hidden"
                  >

                    <div className="flex items-center justify-between">
                       <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Фильтр по датам</span>
                       <button onClick={() => setShowDateFilter(false)} className="text-slate-300 hover:text-slate-500"><X size={16} /></button>
                    </div>
                    <div className="flex items-center gap-2">
                       <input type="date" value={dateRange.start.toISOString().split('T')[0]} onChange={e => { const d = new Date(e.target.value); if (!isNaN(d.getTime())) setDateRange(prev => ({ ...prev, start: d })); }} className="flex-1 bg-slate-50 border-none p-2 rounded-xl text-xs font-bold outline-none" />
                       <span className="text-slate-300">-</span>
                       <input type="date" value={dateRange.end.toISOString().split('T')[0]} onChange={e => { const d = new Date(e.target.value); d.setHours(23,59,59,999); if (!isNaN(d.getTime())) setDateRange(prev => ({ ...prev, end: d })); }} className="flex-1 bg-slate-50 border-none p-2 rounded-xl text-xs font-bold outline-none" />
                    </div>
                    <div className="flex flex-wrap gap-3">
                       {[
                         { label: 'Сегодня', days: 0 },
                         { label: 'Вчера', days: 1 },
                         { label: 'Неделя', days: 6 },
                         { label: 'Месяц', days: 29 },
                         { label: 'Год', days: 364 },
                       ].map((btn) => {
                         const getRange = () => {
                           const end = new Date();
                           const start = new Date();
                           start.setDate(start.getDate() - btn.days);
                           start.setHours(0,0,0,0);
                           end.setHours(23,59,59,999);
                           return { start, end };
                         };
                         return (
                           <button 
                             key={btn.label}
                             onClick={() => setDateRange(getRange())}
                             className="px-4 py-2 bg-slate-50 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 transition-colors"
                           >
                             {btn.label}
                           </button>
                         );
                       })}
                    </div>

                  </motion.div>
                )}
              </AnimatePresence>

              <div className="mt-8 space-y-4">
                {(() => {
                  const { start, end } = dateRange;
                  const filteredEntries = diet.filter(d => {
                    if (d.timestamp < start.getTime() || d.timestamp > end.getTime()) return false;
                    const isWater = d.mealType === 'water' || !!d.water_ml;
                    const isSteps = d.mealType === 'steps' || !!d.steps_count;
                    if (isWater && user.settings?.trackWater === false) return false;
                    if (isSteps && user.settings?.trackSteps === false) return false;
                    return true;
                  });
                  
                  if (filteredEntries.length === 0) {
                    return (
                      <div className="text-center py-20 pr-4">
                        <div className="text-4xl mb-4 grayscale">🍽</div>
                        <p className="text-slate-400 text-sm font-medium italic">В этом диапазоне пусто... <br/>Попробуйте другие даты.</p>
                      </div>
                    );
                  }

                  return (
                    <div className="space-y-3">
                      {[...filteredEntries].reverse().map((entry, idx) => (
                        <MealEntryRow 
                          key={entry.id} 
                          entry={entry} 
                          idx={idx} 
                          onRemove={() => setEntryToDelete(entry)} 
                          onSelect={(e) => setSelectedEntryDetail(e)}
                        />
                      ))}
                    </div>
                  );
                })()}
              </div>
            </motion.div>
          )}

          
          {activeTab === 'profile' && (
             <motion.div 
                key="profile"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -15 }}
                transition={{ duration: 0.2, ease: "circOut" }}
                className="text-center space-y-5 pt-4 pb-24"
             >
                <div className="relative inline-block mt-4">
                   <div 
                     onClick={() => avatarInputRef.current?.click()}
                     className="w-28 h-28 bg-slate-100 rounded-[36px] mx-auto flex items-center justify-center text-4xl shadow-inner overflow-hidden cursor-pointer relative z-10 group"
                   >
                     {user.avatarUrl ? (
                       <img src={user.avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
                     ) : (
                       <span className="opacity-40">👤</span>
                     )}
                     <div className="absolute inset-0 bg-black/20 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                       <Camera size={24} className="text-white" />
                     </div>
                   </div>

                   <input 
                     type="file" 
                     ref={avatarInputRef} 
                     className="hidden" 
                     accept="image/*" 
                     onChange={handleAvatarChange} 
                   />
                   <div className="absolute -bottom-2 -right-2 bg-amber-500 text-white w-8 h-8 rounded-full flex items-center justify-center font-black border-4 border-white pointer-events-none z-30 shadow-md">
                      {user.level}
                   </div>
                </div>
                
                <div className="space-y-1">
                   <h2 className="text-2xl font-black text-slate-900">Профиль</h2>
                   <div className="flex items-center justify-center gap-1.5">
                      {isEditingName ? (
                        <input 
                          autoFocus
                          value={tempName}
                          onChange={(e) => setTempName(e.target.value)}
                          onBlur={handleUpdateName}
                          onKeyDown={(e) => e.key === 'Enter' && handleUpdateName()}
                          className="text-xs font-black text-slate-900 bg-slate-100 border-none rounded-xl text-center outline-none px-3 py-1.5 w-32"
                        />
                      ) : (
                        <div className="flex items-center gap-1 cursor-pointer group" onClick={() => { setTempName(user.name || ''); setIsEditingName(true); }}>
                          <span className="text-xs font-black tracking-widest text-slate-400 uppercase">{user.name || 'Аноним'}</span>
                          <Pencil size={12} className="text-slate-300 group-hover:text-emerald-500 transition-colors" />
                        </div>
                      )}
                   </div>
                </div>
                
                <div className="bg-white p-5 rounded-[32px] border border-slate-100 shadow-sm space-y-1">
                   <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                         <div className="w-12 h-12 bg-emerald-50 rounded-full flex items-center justify-center text-emerald-500 shrink-0">
                            <User size={20} />
                         </div>
                         <div className="text-left">
                            <h3 className="font-black text-slate-900 text-sm flex items-center">
                              Данные и цели 
                              <ChevronDown size={14} className="text-slate-300 ml-1 inline" />
                            </h3>
                         </div>
                      </div>
                      <div 
                        onClick={() => setIsProfileSetupOpen(true)}
                        className="w-10 h-10 bg-slate-50 text-slate-400 rounded-full flex items-center justify-center hover:bg-slate-100 transition-colors cursor-pointer shrink-0"
                      >
                         <Pencil size={16} />
                      </div>
                   </div>
                   <p className="text-left text-slate-500 text-xs font-semibold leading-relaxed mt-3 pl-1">
                      {user.bio?.refinedGoal || "Задайте ваши физические параметры и цели для персонализации питания"}
                   </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                   <div className="bg-slate-50/50 p-5 rounded-[32px] border border-slate-100 flex flex-col items-center justify-center text-center space-y-1.5">
                      <Flame size={24} className="text-orange-500 fill-orange-500" />
                      <p className="text-3xl font-black text-slate-900">{user.streak}</p>
                      <p className="text-[9px] font-black tracking-wider text-slate-400/80">ДНЯ В РЕЖИМЕ</p>
                   </div>
                   <div className="bg-slate-50/50 p-5 rounded-[32px] border border-slate-100 flex flex-col items-center justify-center text-center space-y-1.5">
                      <Star size={24} className="text-amber-500 fill-amber-500" />
                      <p className="text-3xl font-black text-slate-900">{user.xp}</p>
                      <p className="text-[9px] font-black tracking-wider text-slate-400/80">ВСЕГО XP</p>
                   </div>
                </div>

                <div className="pt-2">
                   <div className="flex justify-between items-center text-[10px] font-black tracking-wider text-slate-400">
                      <span>ПРОГРЕСС УРОВНЯ</span>
                      <span className="text-slate-600">{user.xp} / {LEVEL_THRESHOLDS[user.level - 1] || 80} XP</span>
                   </div>
                   <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden mt-1.5">
                      <div 
                         className="bg-emerald-500 h-full rounded-full transition-all duration-500" 
                         style={{ width: `${Math.min(100, Math.max(0, (user.xp / (LEVEL_THRESHOLDS[user.level - 1] || 80)) * 100))}%` }}
                      />
                   </div>
                </div>

                <button 
                  onClick={logout}
                  className="w-full py-4 text-xs font-black uppercase tracking-wider text-red-500 bg-white border border-slate-100 rounded-3xl hover:bg-red-50 transition-colors mt-6"
                >
                   выйти из профиля
                </button>
             </motion.div>
          )}

          {activeTab === 'settings' && (
            <motion.div 
              key="settings"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -15 }}
              transition={{ duration: 0.2, ease: "circOut" }}
              className="space-y-6 pb-24 text-left"
            >
              <h2 className="text-2xl font-black text-slate-900 mt-2 mb-4">Настройки</h2>
              
              <div className="bg-[#f0fdf4]/50 border border-emerald-100 rounded-[32px] p-6 space-y-5">
                 <div>
                    <div className="flex items-center gap-2 mb-3">
                       <span className="text-lg">🤖</span>
                       <span className="font-bold text-slate-900 text-sm">AI Key</span>
                    </div>
                    <input 
                      type="password"
                      value={settingsApiKey}
                      onChange={(e) => setSettingsApiKey(e.target.value)}
                      className="w-full bg-white p-3 px-4 rounded-2xl border border-emerald-200/60 outline-none font-bold text-sm text-slate-700 placeholder-slate-300"
                      placeholder="AIzaSy..."
                    />
                    <button 
                      onClick={() => {
                        localStorage.setItem('user_gemini_api_key', settingsApiKey);
                        setGeminiApiKey(settingsApiKey);
                        alert('Ключ сохранен!');
                      }}
                      className="w-full py-3 bg-emerald-500 text-white font-black rounded-2xl mt-3 text-sm hover:bg-emerald-600 transition-colors"
                    >
                      Сохранить ключ
                    </button>
                 </div>

                 <div className="border-t border-emerald-100/60 pt-4 space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-slate-700">
                        <span className="text-base">💧</span>
                        <span className="font-bold text-xs">Подсчет воды</span>
                      </div>
                      <button 
                        onClick={() => {
                          const newSettings = { ...user.settings, trackWater: !(user.settings?.trackWater !== false) };
                          setUser({ ...user, settings: newSettings });
                          saveUserData(currentUserCode!, { settings: newSettings }).catch(console.error);
                        }}
                        className={`w-12 h-6 rounded-full transition-colors flex items-center p-1 ${user.settings?.trackWater !== false ? 'bg-emerald-500' : 'bg-slate-200'}`}
                      >
                        <div className={`w-4 h-4 bg-white rounded-full transition-transform ${user.settings?.trackWater !== false ? 'translate-x-6' : ''}`} />
                      </button>
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-slate-700">
                        <span className="text-base text-orange-500">👣</span>
                        <span className="font-bold text-xs">Подсчет шагов</span>
                      </div>
                      <button 
                        onClick={() => {
                          const newSettings = { ...user.settings, trackSteps: !(user.settings?.trackSteps !== false) };
                          setUser({ ...user, settings: newSettings });
                          saveUserData(currentUserCode!, { settings: newSettings }).catch(console.error);
                        }}
                        className={`w-12 h-6 rounded-full transition-colors flex items-center p-1 ${user.settings?.trackSteps !== false ? 'bg-emerald-500' : 'bg-slate-200'}`}
                      >
                        <div className={`w-4 h-4 bg-white rounded-full transition-transform ${user.settings?.trackSteps !== false ? 'translate-x-6' : ''}`} />
                      </button>
                    </div>
                 </div>
              </div>

              <div className="space-y-4">
                 <label className="bg-white p-5 rounded-3xl shadow-sm border border-slate-100 flex items-center justify-between cursor-pointer group hover:bg-slate-50 transition-colors w-full">
                    <div>
                       <h3 className="font-bold text-slate-900 text-sm">Импорт (.bpbackup)</h3>
                       <p className="text-slate-400 text-[10px] font-semibold mt-0.5">Восстановить полный бэкап</p>
                    </div>
                    <div className="w-10 h-10 bg-emerald-50 text-emerald-500 rounded-full flex items-center justify-center shrink-0">
                       <Upload size={18} />
                    </div>
                    <input type="file" accept=".json" className="hidden" onChange={(e) => {
                      if (e.target.files && e.target.files.length > 0) {
                        setPendingImportFile(e.target.files[0]);
                        setIsImportConfirmOpen(true);
                      }
                      e.target.value = '';
                    }} />
                 </label>

                 <div 
                   onClick={handleExportData}
                   className="bg-white p-5 rounded-3xl shadow-sm border border-slate-100 flex items-center justify-between cursor-pointer hover:bg-slate-50 transition-colors w-full"
                 >
                    <div>
                       <h3 className="font-bold text-slate-900 text-sm">Экспорт (.bpbackup)</h3>
                       <p className="text-slate-400 text-[10px] font-semibold mt-0.5">Полный бэкап всех данных</p>
                    </div>
                    <div className="w-10 h-10 bg-emerald-50 text-emerald-500 rounded-full flex items-center justify-center shrink-0">
                       <Download size={18} />
                    </div>
                 </div>

                 <button 
                   onClick={handleClearData}
                   className="w-full bg-rose-50 text-rose-500 font-bold p-5 rounded-3xl shadow-sm border border-rose-100 flex items-center justify-between hover:bg-rose-100 transition-colors mt-4"
                 >
                    <div className="text-left">
                       <h3 className="text-sm">Очистить данные</h3>
                       <p className="text-rose-400 text-[10px] font-semibold mt-0.5">Удалить профиль, историю и базу</p>
                    </div>
                    <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center shrink-0 shadow-sm text-rose-500">
                       <Trash2 size={18} />
                    </div>
                 </button>
              </div>
            </motion.div>
          )}

            </AnimatePresence>
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Bottom Navigation */}
      <nav className="h-[76px] bg-white border-t border-slate-100 flex items-center justify-around px-2 relative z-10 shrink-0">
        <NavButton 
          active={activeTab === 'products' || activeTab === 'productDetail'} 
          icon={<LayoutGrid size={20} />} 
          label="КАРТОЧКИ" 
          onClick={() => setActiveTab('products')} 
        />
        <NavButton 
          active={activeTab === 'diet'} 
          icon="🍽" 
          label="ДНЕВНИК" 
          onClick={() => setActiveTab('diet')} 
        />
          
          {/* Main Action (Scan) Integrated */}
          <div 
            onClick={() => setActiveTab('scan')}
            className={`flex flex-col items-center gap-1 cursor-pointer transition-all ${activeTab === 'scan' ? 'text-emerald-600' : 'text-slate-400'}`}
          >
            <div className="h-10 flex items-center justify-center">
              <div className={`w-10 h-10 rounded-2xl flex items-center justify-center transition-all ${activeTab === 'scan' ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-100' : 'bg-slate-50'}`}>
                <Camera size={18} className={activeTab === 'scan' ? 'text-white' : 'text-slate-400'} />
              </div>
            </div>
            <span className="text-[8px] font-black tracking-widest uppercase text-center w-full">СКАНЕР</span>
            {activeTab === 'scan' && <motion.div layoutId="nav-glow" className="w-1 h-1 bg-emerald-500 rounded-full" />}
          </div>

          <NavButton 
            active={activeTab === 'profile'} 
            icon="👤" 
            label="ПРОФИЛЬ" 
            onClick={() => setActiveTab('profile')} 
          />
          <NavButton 
            active={activeTab === 'settings'} 
            icon="⚙️" 
            label="ОПЦИИ" 
            onClick={() => setActiveTab('settings')} 
          />
        </nav>
      
      <AnimatePresence>
        {entryToDelete && (
          <ConfirmModal 
            variant="danger"
            title="Удалить запись?"
            message={`Вы уверены, что хотите удалить запись "${entryToDelete.description || (entryToDelete.items && entryToDelete.items[0]?.productName) || "Прием пищи"}"? Это действие нельзя отменить.`}
            confirmText="Удалить"
            cancelText="Отмена"
            onConfirm={() => {
              deleteDietEntry(entryToDelete.id);
              setEntryToDelete(null);
            }}
            onCancel={() => setEntryToDelete(null)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isImportConfirmOpen && (
          <ConfirmModal 
            title="Заменить все данные?"
            message="ВНИМАНИЕ! Это полностью ЗАМЕНИТ все ваши текущие данные информацией из файла. Ваши текущие данные будут удалены навсегда."
            confirmText="Да, заменить"
            cancelText="Отмена"
            onConfirm={handleConfirmImport}
            onCancel={() => setIsImportConfirmOpen(false)}
          />
        )}
      </AnimatePresence>

      {showInstructions && <InstructionModal onClose={() => setShowInstructions(false)} />}

      <AnimatePresence>
        {isProfileSetupOpen && (
          <ProfileSetupModal 
            user={user} 
            onSave={handleSaveBio} 
            onClose={() => setIsProfileSetupOpen(false)} 
          />
        )}
      </AnimatePresence>


      {/* Home Indicator */}
      <div className="h-6 w-full flex justify-center items-center pb-2 shrink-0 sm:hidden">
        <div className="w-24 h-1 bg-slate-200 rounded-full"></div>
      </div>
    </div>
  );
}

function NavButton({ active, icon, label, onClick, disabled = false, extraClass = "" }: { active: boolean, icon: React.ReactNode, label: string, onClick: () => void, disabled?: boolean, extraClass?: string }) {
  return (
    <div 
      onClick={() => !disabled && onClick()}
      className={`flex flex-col items-center gap-1 cursor-pointer transition-all ${extraClass} ${active ? 'text-emerald-600' : 'text-slate-400'} ${disabled ? 'opacity-20 grayscale cursor-not-allowed' : 'opacity-100'}`}
    >
      <div className="h-10 flex items-center justify-center text-lg filter grayscale-0">
        {typeof icon === 'string' ? icon : React.cloneElement(icon as React.ReactElement, { size: 20, className: active ? 'text-emerald-600' : 'text-slate-400' })}
      </div>
      <span className="text-[8px] font-black tracking-widest uppercase">{label}</span>
      {active && !disabled && <motion.div layoutId="nav-glow" className="w-1 h-1 bg-emerald-500 rounded-full" />}
    </div>
  );
}
