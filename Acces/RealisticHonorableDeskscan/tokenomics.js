/**
 * ════════════════════════════════════════════════════════════════
 * ACCESS Network - نظام الاقتصاد المركزي (Tokenomics)
 * ════════════════════════════════════════════════════════════════
 * 
 * هذا الملف هو المصدر الوحيد لجميع ثوابت ودوال الاقتصاد:
 * - Max Supply: 25,000,000 ACCESS
 * - Halving: المكافأة تتنصف عند كل حد
 * - Dev Fee: 10% من كل مكافأة تعدين للمؤسس
 * - Max Supply Protection: لا يمكن تجاوز الحد الأقصى
 * 
 * جميع الملفات الأخرى تستخدم هذا الملف كمرجع وحيد.
 * 
 * @module tokenomics
 */

// ═══════════════════════════════════════════════════
// الثوابت الأساسية
// ═══════════════════════════════════════════════════

/** الحد الأقصى المطلق — لا يمكن إنشاء عملات أكثر من هذا */
const MAX_SUPPLY = 25_000_000;

/** المكافأة الأولية لكل جلسة تعدين (24 ساعة) */
const INITIAL_BASE_REWARD = 0.25;

/** الحد الأول للتنصيف — عند هذا المبلغ تنخفض المكافأة للنصف */
const FIRST_HALVING_THRESHOLD = 5_000_000;

/** عنوان المؤسس — يحصل على Dev Fee تلقائياً */
const FOUNDER_ADDRESS = '0x90C423C2A9d3ec691D683fe040e4371D8c0eDcda';

/** نسبة Dev Fee — 10% من كل مكافأة */
const DEV_FEE_PERCENT = 0.10;

/** أصغر مكافأة ممكنة — إذا وصلت أقل من هذا تبقى عند هذا الحد */
const MIN_REWARD = 0.00000001; // 1 satoshi ACCESS (8 decimals)

// ═══════════════════════════════════════════════════
// جدول التنصيف (Halving Schedule)
// ═══════════════════════════════════════════════════
// 
// المتداول < 5M       → 0.25 ACCESS
// المتداول 5M-8.75M   → 0.125 ACCESS
// المتداول 8.75M-10.625M → 0.0625 ACCESS
// المتداول 10.625M-11.5625M → 0.03125 ACCESS
// ... وهكذا — لا يتوقف أبداً
//
// رياضياً: المجموع الكلي يقترب من MAX_SUPPLY لكن لا يتجاوزه
// ═══════════════════════════════════════════════════

/**
 * حساب المكافأة الأساسية الحالية بناءً على المعروض المتداول
 * نظام Halving — المكافأة تتنصف عند كل حد
 * 
 * @param {number} circulatingSupply - المعروض المتداول الحالي (بالـ ACCESS)
 * @returns {number} المكافأة الأساسية الحالية (قبل boost وقبل Dev Fee)
 * 
 * @example
 * getCurrentBaseReward(1075)       // → 0.25 (المرحلة 1)
 * getCurrentBaseReward(5000000)    // → 0.125 (المرحلة 2)
 * getCurrentBaseReward(8750000)    // → 0.0625 (المرحلة 3)
 */
function getCurrentBaseReward(circulatingSupply) {
  if (circulatingSupply < 0) circulatingSupply = 0;
  
  let reward = INITIAL_BASE_REWARD;
  let threshold = FIRST_HALVING_THRESHOLD;
  
  // كل مرة المتداول يتجاوز الحد → نصّف المكافأة والحد التالي = الحد الحالي + نصف المتبقي
  while (circulatingSupply >= threshold && reward > MIN_REWARD) {
    reward = reward / 2;
    // الحد التالي = الحد الحالي + (المكافأة الجديدة × عدد الجلسات اللازمة لتعبئة النصف التالي)
    // ببساطة: threshold += (MAX_SUPPLY - threshold) / 2
    const remaining = MAX_SUPPLY - threshold;
    threshold = threshold + (remaining / 2);
    
    // حماية من حلقة لا نهائية
    if (threshold >= MAX_SUPPLY * 0.9999) break;
  }
  
  // حماية: لا تقل عن الحد الأدنى
  return Math.max(reward, MIN_REWARD);
}

/**
 * حساب المكافأة بعد خصم Dev Fee
 * 
 * @param {number} baseReward - المكافأة الأساسية (من getCurrentBaseReward)
 * @param {number} boostMultiplier - مضاعف Boost (من computeHashrateMultiplier)
 * @returns {{ minerReward: number, founderReward: number, totalReward: number }}
 * 
 * @example
 * splitReward(0.25, 1.0)  // → { minerReward: 0.225, founderReward: 0.025, totalReward: 0.25 }
 * splitReward(0.25, 1.12) // → { minerReward: 0.252, founderReward: 0.028, totalReward: 0.28 }
 */
function splitReward(baseReward, boostMultiplier = 1.0) {
  const totalReward = roundReward(baseReward * boostMultiplier);
  const founderReward = roundReward(totalReward * DEV_FEE_PERCENT);
  const minerReward = roundReward(totalReward - founderReward);
  
  return {
    minerReward,
    founderReward,
    totalReward
  };
}

/**
 * التحقق مما إذا كان يمكن إضافة عملات جديدة (حماية Max Supply)
 * 
 * @param {number} circulatingSupply - المعروض المتداول الحالي
 * @param {number} amountToAdd - المبلغ المراد إضافته
 * @returns {{ allowed: boolean, adjustedAmount: number, reason: string }}
 */
function validateSupplyLimit(circulatingSupply, amountToAdd) {
  if (circulatingSupply >= MAX_SUPPLY) {
    return {
      allowed: false,
      adjustedAmount: 0,
      reason: `⛔ Max Supply reached (${MAX_SUPPLY.toLocaleString()} ACCESS)`
    };
  }
  
  const remainingCapacity = MAX_SUPPLY - circulatingSupply;
  
  if (amountToAdd > remainingCapacity) {
    return {
      allowed: true,
      adjustedAmount: roundReward(remainingCapacity),
      reason: `⚠️ Amount adjusted to fit Max Supply (${remainingCapacity.toFixed(8)} remaining)`
    };
  }
  
  return {
    allowed: true,
    adjustedAmount: amountToAdd,
    reason: 'OK'
  };
}

/**
 * الحصول على معلومات المرحلة الحالية
 * 
 * @param {number} circulatingSupply - المعروض المتداول الحالي
 * @returns {{ phase: number, baseReward: number, nextHalvingAt: number, progress: number }}
 */
function getCurrentPhase(circulatingSupply) {
  if (circulatingSupply < 0) circulatingSupply = 0;
  
  let reward = INITIAL_BASE_REWARD;
  let threshold = FIRST_HALVING_THRESHOLD;
  let phase = 1;
  let prevThreshold = 0;
  
  while (circulatingSupply >= threshold && reward > MIN_REWARD) {
    reward = reward / 2;
    prevThreshold = threshold;
    const remaining = MAX_SUPPLY - threshold;
    threshold = threshold + (remaining / 2);
    phase++;
    
    if (threshold >= MAX_SUPPLY * 0.9999) break;
  }
  
  const phaseStart = phase === 1 ? 0 : prevThreshold;
  const phaseSize = threshold - phaseStart;
  const progressInPhase = (circulatingSupply - phaseStart) / phaseSize;
  
  return {
    phase,
    baseReward: Math.max(reward, MIN_REWARD),
    nextHalvingAt: threshold,
    previousHalvingAt: phaseStart,
    progress: Math.min(1, Math.max(0, progressInPhase)),
    remainingToHalving: Math.max(0, threshold - circulatingSupply)
  };
}

/**
 * تقريب المكافأة لـ 8 أماكن عشرية (مثل Bitcoin satoshi)
 */
function roundReward(amount) {
  return Math.round(amount * 100000000) / 100000000;
}

/**
 * الحصول على كل الثوابت (للعرض في API)
 */
function getTokenomicsInfo(circulatingSupply = 0) {
  const phase = getCurrentPhase(circulatingSupply);
  const split = splitReward(phase.baseReward, 1.0);
  
  return {
    maxSupply: MAX_SUPPLY,
    circulatingSupply,
    initialBaseReward: INITIAL_BASE_REWARD,
    currentBaseReward: phase.baseReward,
    currentPhase: phase.phase,
    nextHalvingAt: phase.nextHalvingAt,
    remainingToHalving: phase.remainingToHalving,
    halvingProgress: phase.progress,
    devFeePercent: DEV_FEE_PERCENT * 100,
    founderAddress: FOUNDER_ADDRESS,
    minerRewardPerSession: split.minerReward,
    founderRewardPerSession: split.founderReward,
    minReward: MIN_REWARD
  };
}

// ═══════════════════════════════════════════════════
// Exports
// ═══════════════════════════════════════════════════

export {
  // ثوابت
  MAX_SUPPLY,
  INITIAL_BASE_REWARD,
  FIRST_HALVING_THRESHOLD,
  FOUNDER_ADDRESS,
  DEV_FEE_PERCENT,
  MIN_REWARD,
  
  // دوال
  getCurrentBaseReward,
  splitReward,
  validateSupplyLimit,
  getCurrentPhase,
  roundReward,
  getTokenomicsInfo
};

// CommonJS fallback
export default {
  MAX_SUPPLY,
  INITIAL_BASE_REWARD,
  FIRST_HALVING_THRESHOLD,
  FOUNDER_ADDRESS,
  DEV_FEE_PERCENT,
  MIN_REWARD,
  getCurrentBaseReward,
  splitReward,
  validateSupplyLimit,
  getCurrentPhase,
  roundReward,
  getTokenomicsInfo
};
