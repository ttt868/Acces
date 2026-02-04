// Install Prompt System for PWA
// يطلب من المستخدم تثبيت التطبيق مباشرة من المتصفح

let deferredPrompt;
let installButton;

// ترجمات حسب لغة الجهاز
const installTranslations = {
  ar: {
    title: 'تثبيت Access Digital',
    description: 'ثبّت التطبيق للوصول السريع وتجربة أفضل',
    install: 'تثبيت الآن',
    later: 'لاحقاً'
  },
  en: {
    title: 'Install Access Digital',
    description: 'Install the app for quick access and better experience',
    install: 'Install Now',
    later: 'Later'
  },
  fr: {
    title: 'Installer Access Digital',
    description: 'Installez l\'app pour un accès rapide',
    install: 'Installer',
    later: 'Plus tard'
  },
  es: {
    title: 'Instalar Access Digital',
    description: 'Instala la app para acceso rápido',
    install: 'Instalar',
    later: 'Más tarde'
  },
  de: {
    title: 'Access Digital installieren',
    description: 'Installieren Sie die App für schnellen Zugriff',
    install: 'Installieren',
    later: 'Später'
  },
  tr: {
    title: 'Access Digital Yükle',
    description: 'Hızlı erişim için uygulamayı yükleyin',
    install: 'Şimdi Yükle',
    later: 'Sonra'
  },
  zh: {
    title: '安装 Access Digital',
    description: '安装应用以获得更好的体验',
    install: '立即安装',
    later: '稍后'
  },
  ja: {
    title: 'Access Digital をインストール',
    description: 'アプリをインストールして快適に',
    install: 'インストール',
    later: '後で'
  },
  ko: {
    title: 'Access Digital 설치',
    description: '빠른 액세스를 위해 앱을 설치하세요',
    install: '지금 설치',
    later: '나중에'
  },
  pt: {
    title: 'Instalar Access Digital',
    description: 'Instale o app para acesso rápido',
    install: 'Instalar',
    later: 'Depois'
  },
  ru: {
    title: 'Установить Access Digital',
    description: 'Установите приложение для быстрого доступа',
    install: 'Установить',
    later: 'Позже'
  },
  hi: {
    title: 'Access Digital इंस्टॉल करें',
    description: 'त्वरित पहुँच के लिए ऐप इंस्टॉल करें',
    install: 'अभी इंस्टॉल करें',
    later: 'बाद में'
  },
  it: {
    title: 'Installa Access Digital',
    description: 'Installa l\'app per un accesso rapido e una migliore esperienza',
    install: 'Installa ora',
    later: 'Più tardi'
  },
  id: {
    title: 'Instal Access Digital',
    description: 'Instal aplikasi untuk akses cepat dan pengalaman yang lebih baik',
    install: 'Instal Sekarang',
    later: 'Nanti'
  },
  pl: {
    title: 'Zainstaluj Access Digital',
    description: 'Zainstaluj aplikację dla szybkiego dostępu i lepszego doświadczenia',
    install: 'Zainstaluj teraz',
    later: 'Później'
  },
  nl: {
    title: 'Installeer Access Digital',
    description: 'Installeer de app voor snelle toegang en betere ervaring',
    install: 'Nu installeren',
    later: 'Later'
  },
  vi: {
    title: 'Cài đặt Access Digital',
    description: 'Cài đặt ứng dụng để truy cập nhanh và trải nghiệm tốt hơn',
    install: 'Cài đặt ngay',
    later: 'Để sau'
  },
  th: {
    title: 'ติดตั้ง Access Digital',
    description: 'ติดตั้งแอปเพื่อการเข้าถึงที่รวดเร็วและประสบการณ์ที่ดีขึ้น',
    install: 'ติดตั้งเลย',
    later: 'ภายหลัง'
  }
};

// الحصول على الترجمة حسب لغة الجهاز
function getInstallText() {
  const userLang = navigator.language.split('-')[0];
  return installTranslations[userLang] || installTranslations.en;
}

// تخزين حدث التثبيت
window.addEventListener('beforeinstallprompt', (e) => {
  console.log('Install prompt available');
  e.preventDefault();
  deferredPrompt = e;
  showInstallButton();
});

// إنشاء زر التثبيت
function createInstallButton() {
  // إذا كان موجود مسبقاً، لا تنشئه
  if (document.getElementById('install-btn')) return;
  
  const text = getInstallText();
  
  installButton = document.createElement('div');
  installButton.id = 'install-btn';
  installButton.innerHTML = `
    <div class="install-prompt-overlay" id="install-overlay">
      <div class="install-prompt-card">
        <img src="access-logo-1ipfs.png" alt="Access Digital" class="install-icon">
        <h3>${text.title}</h3>
        <p>${text.description}</p>
        <div class="install-buttons">
          <button id="install-yes" class="install-btn-primary">${text.install}</button>
          <button id="install-no" class="install-btn-secondary">${text.later}</button>
        </div>
      </div>
    </div>
  `;
  
  const style = document.createElement('style');
  style.textContent = `
    .install-prompt-overlay {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0,0,0,0.85);
      z-index: 99999;
      justify-content: center;
      align-items: center;
      animation: fadeIn 0.3s ease;
    }
    
    .install-prompt-overlay.show {
      display: flex;
    }
    
    .install-prompt-card {
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      border-radius: 24px;
      padding: 35px;
      text-align: center;
      max-width: 320px;
      margin: 20px;
      box-shadow: 0 25px 80px rgba(0,0,0,0.6);
      border: 1px solid rgba(255,255,255,0.1);
    }
    
    .install-icon {
      width: 90px;
      height: 90px;
      border-radius: 50%;
      margin-bottom: 20px;
      box-shadow: 0 8px 30px rgba(102, 126, 234, 0.4);
      border: 3px solid rgba(255,255,255,0.2);
    }
    
    .install-prompt-card h3 {
      color: #fff;
      margin: 0 0 12px 0;
      font-size: 22px;
      font-weight: 600;
    }
    
    .install-prompt-card p {
      color: #aaa;
      margin: 0 0 25px 0;
      font-size: 14px;
      line-height: 1.5;
    }
    
    .install-buttons {
      display: flex;
      gap: 12px;
      justify-content: center;
    }
    
    .install-btn-primary {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border: none;
      padding: 14px 28px;
      border-radius: 12px;
      font-size: 16px;
      font-weight: bold;
      cursor: pointer;
      transition: all 0.3s;
      box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
    }
    
    .install-btn-primary:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(102, 126, 234, 0.5);
    }
    
    .install-btn-secondary {
      background: transparent;
      color: #888;
      border: 1px solid #444;
      padding: 14px 28px;
      border-radius: 12px;
      font-size: 16px;
      cursor: pointer;
      transition: all 0.3s;
    }
    
    .install-btn-secondary:hover {
      border-color: #666;
      color: #aaa;
    }
    
    @keyframes fadeIn {
      from { opacity: 0; transform: scale(0.9); }
      to { opacity: 1; transform: scale(1); }
    }
  `;
  
  document.head.appendChild(style);
  document.body.appendChild(installButton);
  
  // أحداث الأزرار
  document.getElementById('install-yes').addEventListener('click', installApp);
  document.getElementById('install-no').addEventListener('click', hideInstallPrompt);
  document.getElementById('install-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'install-overlay') hideInstallPrompt();
  });
}

// إظهار زر التثبيت
function showInstallButton() {
  // لا تظهر إذا مثبت مسبقاً
  if (window.matchMedia('(display-mode: standalone)').matches) {
    console.log('App already installed');
    return;
  }
  
  // لا تظهر إذا رفض المستخدم مؤخراً
  const dismissed = localStorage.getItem('install-dismissed');
  if (dismissed) {
    const dismissedTime = parseInt(dismissed);
    const hoursSinceDismissed = (Date.now() - dismissedTime) / (1000 * 60 * 60);
    if (hoursSinceDismissed < 24) return; // انتظر 24 ساعة
  }
  
  createInstallButton();
  
  // أظهر بعد 5 ثواني
  setTimeout(() => {
    const overlay = document.getElementById('install-overlay');
    if (overlay) overlay.classList.add('show');
  }, 5000);
}

// إخفاء نافذة التثبيت
function hideInstallPrompt() {
  const overlay = document.getElementById('install-overlay');
  if (overlay) overlay.classList.remove('show');
  localStorage.setItem('install-dismissed', Date.now().toString());
}

// تثبيت التطبيق
async function installApp() {
  if (!deferredPrompt) {
    console.log('No install prompt available');
    return;
  }
  
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  console.log('Install outcome:', outcome);
  
  if (outcome === 'accepted') {
    console.log('User accepted install');
    localStorage.setItem('app-installed', 'true');
  }
  
  deferredPrompt = null;
  hideInstallPrompt();
}

// التحقق من التثبيت
window.addEventListener('appinstalled', () => {
  console.log('App installed successfully!');
  localStorage.setItem('app-installed', 'true');
  hideInstallPrompt();
});

// تهيئة
document.addEventListener('DOMContentLoaded', () => {
  console.log('Install prompt system loaded');
});
