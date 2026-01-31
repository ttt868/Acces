
// إعدادات التطوير لتقليل الضوضاء في الكونسول
export const developmentConfig = {
  // تشغيل الوضع الصامت أثناء التطوير
  silentMode: true,
  
  // فترات الحفظ أثناء التطوير (بالمليثانية)
  saveIntervals: {
    chainData: 300000,    // 5 دقائق
    state: 300000,        // 5 دقائق
    performance: 600000,  // 10 دقائق
    health: 300000        // 5 دقائق
  },
  
  // رسائل مخففة أثناء التطوير
  reducedLogging: {
    storage: true,        // تقليل رسائل التخزين
    performance: true,    // تقليل تقارير الأداء
    network: true,        // تقليل رسائل الشبكة
    consensus: true       // تقليل رسائل الإجماع
  },
  
  // عرض الرسائل المهمة فقط
  showOnlyImportant: {
    errors: true,         // عرض الأخطاء دائماً
    warnings: true,       // عرض التحذيرات
    transactions: false,  // إخفاء رسائل المعاملات (لا يوجد مستخدمين بعد)
    blocks: false,        // إخفاء رسائل الكتل
    processing: false         // إخفاء رسائل التعدين
  },
  
  // رسائل موجزة للتطوير
  developmentMessages: {
    startup: '🚀 Access Network - Development Mode',
    saveComplete: '💾 Data saved',
    performanceCheck: '📊 Performance OK',
    networkHealth: '💚 Network healthy'
  }
};

// دالة لفحص ما إذا كنا في وضع التطوير
export function isDevelopmentMode() {
  return process.env.NODE_ENV === 'development' || !process.env.NODE_ENV;
}

// دالة للتحكم في عرض الرسائل
export function shouldLog(messageType) {
  if (!developmentConfig.silentMode) return true;
  
  return developmentConfig.showOnlyImportant[messageType] || false;
}

// دالة لعرض رسالة مطورة مخففة
export function devLog(message, type = 'info') {
  if (!isDevelopmentMode()) return;
  
  if (shouldLog(type)) {
    console.log(`🔧 [DEV] ${message}`);
  }
}
