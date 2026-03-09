#!/bin/bash
# 🚀 سكربت التحديث الآمن لـ Hetzner - لا يحذف node_modules
# الأسرار تُقرأ من متغيرات البيئة أو يطلبها السكربت

if [ -z "$SSHPASS" ]; then
  echo "⚠️ SSHPASS غير مضبوط. أدخل كلمة سر SSH للسيرفر:"
  read -rs SSHPASS
  export SSHPASS
fi

echo "📦 جاري ضغط المشروع..."
cd /workspaces/Acces
tar -czvf /tmp/update.tar.gz --exclude='node_modules' --exclude='.git' --exclude='*.log' --exclude='.env' Acces/RealisticHonorableDeskscan Acces/database-config.js 2>/dev/null

echo "📤 جاري الرفع للسيرفر..."
sshpass -e scp -o StrictHostKeyChecking=no /tmp/update.tar.gz root@89.167.14.197:/tmp/

echo "🔄 جاري التحديث على السيرفر..."
sshpass -e ssh -o StrictHostKeyChecking=no root@89.167.14.197 '
set -e

# حفظ .env و node_modules
cp /var/www/Acces/RealisticHonorableDeskscan/.env /tmp/.env.backup 2>/dev/null || true
if [ -d /var/www/Acces/RealisticHonorableDeskscan/node_modules ]; then
  mv /var/www/Acces/RealisticHonorableDeskscan/node_modules /tmp/node_modules_backup
fi

cd /var/www
rm -rf Acces
tar -xzf /tmp/update.tar.gz

# استعادة node_modules
if [ -d /tmp/node_modules_backup ]; then
  mv /tmp/node_modules_backup /var/www/Acces/RealisticHonorableDeskscan/node_modules
fi

# استعادة .env
cp /tmp/.env.backup /var/www/Acces/RealisticHonorableDeskscan/.env 2>/dev/null || true

# إذا لم يوجد .env، أنشئ واحد جديد (يجب تعبئة القيم يدوياً)
if [ ! -f /var/www/Acces/RealisticHonorableDeskscan/.env ]; then
cat > /var/www/Acces/RealisticHonorableDeskscan/.env << ENVEOF
DATABASE_URL=CHANGE_ME
DEPLOYMENT_ENV=production
NODE_ENV=production
PORT=3000
BLOCKCHAIN_PORT=5000
GOOGLE_CLIENT_ID=CHANGE_ME
VAPID_PUBLIC_KEY=CHANGE_ME
VAPID_PRIVATE_KEY=CHANGE_ME
VAPID_SUBJECT=mailto:admin@access-network.com
CHAIN_ID=22888
SESSION_SECRET=CHANGE_ME
ENCRYPTION_KEY=CHANGE_ME
SMTP_HOST=mail.privateemail.com
SMTP_PORT=587
SMTP_USER=CHANGE_ME
SMTP_PASS=CHANGE_ME
ENVEOF
echo "⚠️ تم إنشاء .env جديد - يجب تعبئة القيم الحقيقية يدوياً على السيرفر!"
fi

# نسخ database-config.js
cp /var/www/Acces/database-config.js /var/www/Acces/RealisticHonorableDeskscan/
sed -i "s|from \x27../database-config.js\x27|from \x27./database-config.js\x27|g" /var/www/Acces/RealisticHonorableDeskscan/db.js

cd /var/www/Acces/RealisticHonorableDeskscan
npm install --production 2>/dev/null

# إعادة تشغيل والتحقق
pm2 restart access-network
sleep 8
if ss -tlnp | grep -q 3000; then
  echo "✅ تم التحديث بنجاح! المنفذ 3000 يعمل"
else
  echo "⚠️ المنفذ 3000 لم يفتح بعد، انتظر..."
  sleep 10
  ss -tlnp | grep 3000 && echo "✅ يعمل الآن" || echo "❌ مشكلة في البدء"
fi
pm2 list
'

rm -f /tmp/update.tar.gz
echo "🎉 انتهى!"
