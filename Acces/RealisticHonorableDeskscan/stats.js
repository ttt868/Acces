// Balance Privacy Toggle System - Visual Hide Only (No Value Changes)
class BalancePrivacyManager {
  constructor() {
    this.isBalanceHidden = localStorage.getItem('balanceHidden') === 'true';
    this.hiddenText = '••••••••';
    this.originalValues = new Map(); // تخزين القيم الأصلية
    this.init();
  }

  init() {
    // انتظار تحميل DOM
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.setupPrivacyToggles());
    } else {
      this.setupPrivacyToggles();
    }

    // تطبيق الحالة الأولية فوراً
    this.updateEyeIcon();
    this.applyPrivacyState();

    // مراقبة تغييرات الصفحة
    this.observePageChanges();
  }

  setupPrivacyToggles() {
    // حفظ القيم الأصلية فور تحميل الصفحة
    this.saveAllOriginalValues();

    // إعداد مراقب التغييرات للمحتوى المضاف ديناميكياً
    this.setupMutationObserver();
  }

  saveAllOriginalValues() {
    const balanceSelectors = [
      '#user-coins',
      '#profile-coins', 
      '#Transfer-balance',
      '.wallet-balance span' // رصيد البلوك تشين في صفحة blockchain
    ];

    balanceSelectors.forEach(selector => {
        const element = document.querySelector(selector);
        if (element && element.textContent) {
          const currentText = element.textContent.trim();
          // يتعامل مع الأرقام العادية والأرقام التي تحتوي على فواصل
          if ((currentText.match(/^\d+(\.\d+)?$/) || currentText.match(/^\d{1,3}(,\d{3})*(\.\d+)?$/)) && currentText !== this.hiddenText) {
            this.originalValues.set(selector, currentText);

            // تحديث العرض فوراً إذا لم يكن مخفياً
            if (!this.isBalanceHidden) {
              // القيمة محفوظة ومعروضة بشكل صحيح
            }
          }
        }
      });
  }

  togglePrivacy() {
    this.isBalanceHidden = !this.isBalanceHidden;
    localStorage.setItem('balanceHidden', this.isBalanceHidden.toString());

    // تحديث أيقونة العين فوراً
    this.updateEyeIcon();

    // تطبيق حالة الخصوصية الجديدة
    this.applyPrivacyState();
  }

  updateEyeIcon() {
    const eyeButtons = document.querySelectorAll('.balance-privacy-toggle');
    eyeButtons.forEach(button => {
      const icon = button.querySelector('i');
      if (icon) {
        if (this.isBalanceHidden) {
          // العين مغلقة مع خط
          icon.className = 'far fa-eye-slash';
        } else {
          // العين مفتوحة
          icon.className = 'far fa-eye';
        }
      }
    });
  }

  applyPrivacyState() {
    if (this.isBalanceHidden) {
      this.hideAllBalances();
    } else {
      this.showAllBalances();
    }
  }

  hideAllBalances() {
    const balanceSelectors = [
      '#user-coins',
      '#profile-coins', 
      '#Transfer-balance',
      '.wallet-balance span' // رصيد البلوك تشين يتشفر
    ];

    balanceSelectors.forEach(selector => {
        const element = document.querySelector(selector);
        if (element && element.textContent) {
          const currentText = element.textContent.trim();

          // حفظ القيمة الحالية إذا لم تكن محفوظة من قبل
          // يتعامل مع الأرقام العادية والأرقام التي تحتوي على فواصل
          if ((currentText.match(/^\d+(\.\d+)?$/) || currentText.match(/^\d{1,3}(,\d{3})*(\.\d+)?$/)) && currentText !== this.hiddenText) {
            this.originalValues.set(selector, currentText);
          }

          // إخفاء الرصيد فقط إذا لم يكن مخفياً بالفعل
          if (currentText !== this.hiddenText) {
            element.textContent = this.hiddenText;
            element.classList.add('balance-hidden');
          }
        }
      });

    // إخفاء كلمة "access" تماماً عند تشفير الرصيد
    this.hideAccessText();
  }

  showAllBalances() {
    const balanceSelectors = [
      '#user-coins',
      '#profile-coins', 
      '#Transfer-balance',
      '.wallet-balance span' // استعادة رصيد البلوك تشين
    ];

    balanceSelectors.forEach(selector => {
      const element = document.querySelector(selector);
      if (element && element.classList.contains('balance-hidden')) {
        // استعادة القيمة الأصلية المحفوظة بدون أي تعديل
        const originalValue = this.originalValues.get(selector);
        if (originalValue) {
          element.textContent = originalValue;
        }
        element.classList.remove('balance-hidden');
      }
    });

    // إظهار كلمة "access" مرة أخرى عند فك التشفير
    this.showAccessText();
  }

  // حفظ قيمة جديدة عند تحديث الرصيد
  updateBalance(selector, newValue) {
    // حفظ القيمة الجديدة مع التنسيق المناسب
    const formattedValue = this.formatNumberSmart(newValue);
    this.originalValues.set(selector, formattedValue);

    const element = document.querySelector(selector);
    if (element) {
      if (this.isBalanceHidden) {
        // إذا كان مخفياً، اتركه مخفياً
        element.textContent = this.hiddenText;
        element.classList.add('balance-hidden');
      } else {
        // إذا لم يكن مخفياً، اعرض القيمة المنسقة
        element.textContent = formattedValue;
        element.classList.remove('balance-hidden');
      }
    }
  }

  setupMutationObserver() {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach(mutation => {
        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach(node => {
            if (node.nodeType === 1) {
              // حفظ القيم الجديدة عند إضافة عناصر جديدة فوراً
              this.saveAllOriginalValues();
              this.updateEyeIcon();
              this.applyPrivacyState();
            }
          });
        }
      });
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  observePageChanges() {
    // الاستماع لتنقل الصفحات
    document.addEventListener('click', (e) => {
      const navLink = e.target.closest('.nav-link, .mobile-nav-item');
      if (navLink) {
        this.saveAllOriginalValues();
        this.updateEyeIcon();
        this.applyPrivacyState();
      }
    });

    // الاستماع لتحديثات الرصيد
    document.addEventListener('balanceUpdated', (event) => {
      const newBalance = event.detail.newBalance;
      if (newBalance !== undefined) {
        this.updateBalance('#user-coins', newBalance);
      }
    });

    // الاستماع لتغييرات رؤية الصفحة
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        this.saveAllOriginalValues();
        this.updateEyeIcon();
        this.applyPrivacyState();
      }
    });

    // حفظ حالة الخصوصية عند إعادة التحميل
    window.addEventListener('beforeunload', () => {
      localStorage.setItem('balanceHidden', this.isBalanceHidden.toString());
    });
  }



  // إخفاء كلمة "access" تماماً
  hideAccessText() {
    if (!document.getElementById('hide-access-style')) {
      const style = document.createElement('style');
      style.id = 'hide-access-style';
      style.textContent = `
        #dashboard-page .balance-value #user-coins::before {
          display: none !important;
        }
        .dark-theme #dashboard-page .balance-value #user-coins::before {
          display: none !important;
        }
      `;
      document.head.appendChild(style);
    }
  }

  // إظهار كلمة "access" مرة أخرى
  showAccessText() {
    const hideStyle = document.getElementById('hide-access-style');
    if (hideStyle) {
      hideStyle.remove();
    }
  }

  // دالة التنسيق الذكي للأرقام - إزالة الأصفار الزائدة مع الحفاظ على فواصل الآلاف
  formatNumberSmart(number) {
    if (typeof number !== 'number') {
      number = parseFloat(number) || 0;
    }

    // للأرقام الصحيحة، أعدها مع فواصل الآلاف
    if (Number.isInteger(number)) {
      return number.toLocaleString('en-US');
    }

    // تحويل إلى نص مع دقة عالية
    let formatted = number.toFixed(8);
    
    // إزالة الأصفار الزائدة من النهاية والنقطة إذا لم تعد هناك أرقام عشرية
    formatted = formatted.replace(/\.?0+$/, '');
    
    // إذا انتهت بنقطة، احذفها
    if (formatted.endsWith('.')) {
      formatted = formatted.slice(0, -1);
    }

    // التأكد من عدم إرجاع نص فارغ
    if (!formatted || formatted === '') {
      return '0';
    }
    
    // تطبيق فواصل الآلاف على الرقم المنسق
    const parts = formatted.split('.');
    parts[0] = parseInt(parts[0]).toLocaleString('en-US');
    
    return parts.join('.');
  }

}

// Initialize the balance privacy system only
const balancePrivacyManager = new BalancePrivacyManager();

// Make it globally available
window.BalancePrivacyManager = balancePrivacyManager;

// Override the global updateUserCoins function to work with privacy manager
if (typeof window.updateUserCoins === 'function') {
  const originalUpdateUserCoins = window.updateUserCoins;
  window.updateUserCoins = function(newBalance) {
    // Call original function
    originalUpdateUserCoins(newBalance);

    // Update privacy manager with formatted value
    if (window.BalancePrivacyManager) {
      window.BalancePrivacyManager.updateBalance('#user-coins', newBalance);
    }
  };
}







