// Balance Privacy Toggle System - Visual Hide Only (No Value Changes)
class BalancePrivacyManager {
  constructor() {
    this.isBalanceHidden = localStorage.getItem('balanceHidden') === 'true';
    this.hiddenText = '••••••••';
    this.originalValues = new Map(); // تخزين القيم الأصلية
    this._mutationTimeout = null;
    this.init();
  }

  init() {
    // تطبيق الإخفاء فوراً إذا كان مخفياً (قبل DOMContentLoaded)
    if (this.isBalanceHidden) {
      // إخفاء فوري باستخدام MutationObserver للعناصر التي تُضاف لاحقاً
      this.setupImmediateHide();
    }
    
    // انتظار تحميل DOM
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.setupPrivacyToggles());
    } else {
      this.setupPrivacyToggles();
    }

    // تطبيق الحالة الأولية
    this.updateEyeIcon();
    this.applyPrivacyState();

    // مراقبة تغييرات الصفحة
    this.observePageChanges();
  }
  
  setupImmediateHide() {
    // مراقب يخفي الرصيد فوراً عند إضافة أي عنصر
    const observer = new MutationObserver(() => {
      if (this.isBalanceHidden) {
        this.hideAllBalances();
      }
    });
    
    // بدء المراقبة فوراً
    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        observer.observe(document.body, { childList: true, subtree: true });
      });
    }
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
      '#network-coins'
    ];

    balanceSelectors.forEach(selector => {
        const element = document.querySelector(selector);
        if (element && element.textContent) {
          const currentText = element.textContent.trim();
          if ((currentText.match(/^\d+(\.\d+)?$/) || currentText.match(/^\d{1,3}(,\d{3})*(\.\d+)?$/)) && currentText !== this.hiddenText) {
            this.originalValues.set(selector, currentText);
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
          icon.className = 'fas fa-eye-slash';
        } else {
          // العين مفتوحة
          icon.className = 'fas fa-eye';
        }
      }
      // تأكد أن الزر ظاهر دائماً
      button.style.display = 'inline-flex';
      button.style.visibility = 'visible';
      button.style.opacity = '1';
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
      '#network-coins'
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
    // إزالة class الإخفاء الأولي من html
    document.documentElement.classList.remove('balance-hidden-initial');
    document.documentElement.classList.remove('bh');
    
    // جلب الرصيد من currentUser مباشرة واستخدام formatNumberSmart من script.js
    let balance = '0.00';
    if (window.currentUser && window.currentUser.coins !== undefined) {
      // استخدام formatNumberSmart من window إذا وجد، وإلا استخدم toFixed
      if (typeof window.formatNumberSmart === 'function') {
        balance = window.formatNumberSmart(window.currentUser.coins);
      } else {
        balance = parseFloat(window.currentUser.coins).toFixed(2);
      }
    }
    
    // استخدام querySelectorAll لتحديث جميع العناصر (بما فيها صفحة Network)
    const balanceSelectors = '#user-coins, #profile-coins, #Transfer-balance, #network-coins';

    document.querySelectorAll(balanceSelectors).forEach(element => {
      if (element) {
        element.textContent = balance;
        element.classList.remove('balance-hidden');
        element.style.visibility = 'visible';
        element.style.color = '';
      }
    });
    
    // إظهار كلمة Points
    document.querySelectorAll('.balance-currency-unit').forEach(el => {
      el.style.display = '';
    });

    // إظهار كلمة "access" مرة أخرى عند فك التشفير
    this.showAccessText();
  }

  // حفظ قيمة جديدة عند تحديث الرصيد
  updateBalance(selector, newValue) {
    // استخدام formatNumberSmart من window
    let formattedValue;
    if (typeof window.formatNumberSmart === 'function') {
      formattedValue = window.formatNumberSmart(newValue);
    } else {
      formattedValue = parseFloat(newValue).toFixed(2);
    }
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
    const observer = new MutationObserver(() => {
      // debounce لمنع الوميض - تنفيذ مرة واحدة فقط بعد استقرار DOM
      if (this._mutationTimeout) clearTimeout(this._mutationTimeout);
      this._mutationTimeout = setTimeout(() => {
        this.updateEyeIcon();
        this.applyPrivacyState();
      }, 50);
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
        // تأجيل قصير ليكتمل عرض الصفحة الجديدة أولاً
        setTimeout(() => {
          this.updateEyeIcon();
          this.applyPrivacyState();
        }, 100);
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

}

// Initialize the balance privacy system only
const balancePrivacyManager = new BalancePrivacyManager();

// Make it globally available
window.BalancePrivacyManager = balancePrivacyManager;
window.balancePrivacy = balancePrivacyManager;

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


