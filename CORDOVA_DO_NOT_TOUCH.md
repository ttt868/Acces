# ⚠️ ملفات Cordova - لا تلمسها أبداً!

هذه الملفات تعمل بشكل صحيح للصورة والحساب.
**لا تعدّلها أبداً** عند إصلاح المستكشف أو أي شيء آخر:

## ملفات الصورة والحساب (لا تلمسها!):
- `cordova-app/www/index.html`
- `cordova-app/www/script.js`
- `cordova-app/www/cordova-init.js`

## ملفات المستكشف (يمكن تعديلها):
- `cordova-app/www/access-explorer.html`
- `cordova-app/www/transactions.html`
- `cordova-app/www/transaction-details.html`
- `cordova-app/www/blocks.html`
- `cordova-app/www/block-details.html`
- `cordova-app/www/address-details.html`
- `cordova-app/www/top-accounts.html`
- `cordova-app/www/latest-mint.html`
- `cordova-app/www/gastracker.html`
- `cordova-app/www/developer-api.html`

## الإصدار الصحيح للملفات المحمية:
Commit: 54b3a2587

للاسترجاع إذا حدث خطأ:
```bash
git show 54b3a2587:cordova-app/www/index.html > cordova-app/www/index.html
git show 54b3a2587:cordova-app/www/script.js > cordova-app/www/script.js
git show 54b3a2587:cordova-app/www/cordova-init.js > cordova-app/www/cordova-init.js
```
