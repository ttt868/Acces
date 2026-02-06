# نظام تخزين الحالة على معيار ACCESS Network

## 🌳 نظرة عامة

تم تطبيق نظام تخزين احترافي مثل **ACCESS Network** تماماً باستخدام:

- **LevelDB**: قاعدة بيانات مفاتيح-قيم (Key-Value Store)
- **Merkle Patricia Trie**: بنية شجرية للتحقق من سلامة البيانات
- **RLP Encoding**: تشفير البيانات على معيار ACCESS Network

## ⭐ المزايا

### ✅ مثل ACCESS Network بالضبط
- نفس بنية تخزين الحسابات التي تستخدمها ACCESS Network
- كل حساب يحتوي على:
  - `nonce`: عدد المعاملات المرسلة
  - `balance`: الرصيد بالـ ACCESS (smallest unit) (أصغر وحدة)
  - `storageRoot`: جذر تخزين العقود الذكية
  - `codeHash`: hash كود العقود الذكية

### ✅ تخزين دائم باستخدام LevelDB
- لا توجد قاعدة بيانات علائقية (PostgreSQL) للأرصدة
- التخزين في ملفات LevelDB مثل **Geth** (ACCESS Network client)
- أداء عالٍ جداً للقراءة والكتابة

### ✅ التحقق من سلامة البيانات
- **State Root**: hash واحد يمثل كامل حالة الشبكة
- **Merkle Proofs**: إمكانية إثبات وجود حساب بدون تحميل كل البيانات
- نفس الأمان المستخدم في ACCESS Network

## 📁 هيكل الملفات

```
Acces/RealisticHonorableDeskscan/
├── access-state-storage.js       # نظام State Trie + LevelDB
├── leveldb-storage.js              # نظام LevelDB للبلوكات
├── network-system.js               # تم تحديثه لاستخدام State Trie
└── access-network-data/
    └── state/
        └── chaindata/              # بيانات LevelDB
            ├── MANIFEST
            ├── CURRENT
            ├── LOG
            └── *.ldb               # ملفات LevelDB
```

## 🔧 كيفية الاستخدام

### 1. إنشاء نظام التخزين

```javascript
import { ACCESS NetworkStateStorage } from './access-state-storage.js';

const stateStorage = new ACCESS NetworkStateStorage();
```

### 2. الحصول على رصيد محفظة

```javascript
// async
const balance = await stateStorage.getBalance('0x...');
console.log(`الرصيد: ${balance} ACCESS (smallest unit)`);
```

### 3. تحديث رصيد محفظة

```javascript
// async
await stateStorage.updateBalance('0x...', '1000000000000000000'); // 1 ACCESS
```

### 4. الحصول على State Root

```javascript
const stateRoot = stateStorage.getStateRoot();
console.log(`State Root: ${stateRoot}`);
```

### 5. إنشاء Merkle Proof

```javascript
const proof = await stateStorage.createProof('0x...');
console.log('Merkle Proof:', proof);
```

## 📊 الفرق بين النظام القديم والجديد

| الميزة | النظام القديم | النظام الجديد (ACCESS Network-Style) |
|--------|---------------|-------------------------------|
| **تخزين الأرصدة** | PostgreSQL (external_wallets) | LevelDB + Merkle Patricia Trie |
| **البنية** | جدول قاعدة بيانات علائقية | State Trie (مثل ACCESS Network) |
| **التحقق من البيانات** | لا يوجد | State Root + Merkle Proofs |
| **الأداء** | متوسط (SQL queries) | عالٍ جداً (Key-Value Store) |
| **التوافق مع ACCESS Network** | ❌ | ✅ |
| **إمكانية التوسع** | محدودة | ممتازة (شاردينج ممكن) |

## 🔐 الأمان

### State Root
كل تحديث للحالة ينتج `stateRoot` جديد:
- hash SHA3 لكامل حالة الشبكة
- تغيير أي رصيد = تغيير stateRoot
- إمكانية التحقق من سلامة البيانات

### Merkle Proofs
- إثبات وجود حساب بدون تحميل كل البيانات
- حجم الإثبات صغير (~1-2 KB)
- نفس التقنية المستخدمة في Light Clients

## 📈 الأداء

- **القراءة**: O(log n) - سريع جداً
- **الكتابة**: O(log n) - سريع جداً
- **الضغط**: تلقائي باستخدام Snappy
- **التخزين**: كفاءة عالية

## 🚀 التكامل مع network-system.js

تم تحديث `network-system.js` ليستخدم `ACCESS NetworkStateStorage`:

```javascript
// عند التهيئة
this.accessStateStorage = new ACCESS NetworkStateStorage();

// عند تحديث الرصيد
updateBalance(address, newBalance) {
  // تحديث cache محلي
  this.balances.set(normalizedAddress, finalBalance);
  
  // تحديث State Trie (async)
  this.updateBalanceInStateTrie(normalizedAddress, finalBalance);
}

// دالة async للتحديث
async updateBalanceInStateTrie(address, newBalance) {
  const balanceInACCESS (smallest unit) = Math.floor(newBalance * 1e18);
  await this.accessStateStorage.updateBalance(address, balanceInACCESS (smallest unit).toString());
  await this.accessStateStorage.flush(this.chain.length - 1);
}
```

## 🗄️ النسخ الاحتياطي والاستعادة

### إنشاء نسخة احتياطية

```javascript
await stateStorage.backup('./backup/state-backup.json');
```

### استعادة من نسخة احتياطية

```javascript
await stateStorage.restore('./backup/state-backup.json');
```

## 📊 الإحصائيات

```javascript
const stats = await stateStorage.getStats();
console.log(stats);
/*
{
  storage_type: 'ACCESS Network State Trie (Merkle Patricia Trie)',
  database_backend: 'LevelDB',
  state_root: '0x...',
  total_accounts: 100,
  total_balance: '1000000000000000000000',
  ethereum_compatible: true
}
*/
```

## 🔄 الترحيل من PostgreSQL

> **ملاحظة**: الأرصدة لن تُخزن بعد الآن في `external_wallets` في PostgreSQL
> 
> كل الأرصدة الآن تُخزن في **LevelDB + State Trie**

التخزين الوحيد في PostgreSQL:
- معلومات المستخدمين (البريد الإلكتروني، الاسم، إلخ)
- المعاملات للأرشفة والاستعلام التاريخي
- البيانات الإدارية الأخرى

## 🎯 الخلاصة

✅ **نظام احترافي 100%**  
✅ **نفس معيار ACCESS Network**  
✅ **أداء عالٍ جداً**  
✅ **أمان متقدم**  
✅ **قابل للتوسع**

---

**تم التطوير بمعايير احترافية عالمية 🌍**
