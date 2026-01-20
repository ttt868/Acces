
# دليل إعداد Trusted Web Activity (TWA)

## المشكلة: ظهور شريط المتصفح في التطبيق

### الحل الكامل:

#### 1. الحصول على SHA-256 Fingerprint

بعد رفع التطبيق على Google Play Console:

1. اذهب إلى: **Release > Setup > App Integrity**
2. انسخ **SHA-256 certificate fingerprint**
3. استبدله في `.well-known/assetlinks.json`

#### 2. تحديث assetlinks.json

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "com.access.network",
      "sha256_cert_fingerprints": [
        "YOUR_ACTUAL_SHA256_HERE"
      ]
    }
  }
]
```

#### 3. التحقق من الملف

تأكد من أن الملف متاح على:
```
https://your-domain/.well-known/assetlinks.json
```

#### 4. انتظر التحقق

- Google تحتاج **24-48 ساعة** للتحقق من Digital Asset Links
- بعدها سيختفي شريط المتصفح تلقائياً

#### 5. اختبار التحقق

```bash
adb shell pm get-app-links com.access.network
```

يجب أن ترى: `verified`

## ملاحظات مهمة:

- ✅ لا تستخدم Debug SHA-256 في Production
- ✅ تأكد من `package_name` مطابق للتطبيق
- ✅ الملف يجب أن يكون بصيغة JSON صحيحة
- ✅ لا تنسى إعادة نشر التطبيق بعد التحديث
