#!/bin/bash
# 🚀 سكربت التحديث السريع لـ Hetzner

export SSHPASS='Midouyaya1@$.'

echo "📦 جاري ضغط المشروع..."
cd /workspaces/Acces
tar -czvf /tmp/update.tar.gz --exclude='node_modules' --exclude='.git' --exclude='*.log' --exclude='.env' Acces/RealisticHonorableDeskscan Acces/database-config.js 2>/dev/null

echo "📤 جاري الرفع للسيرفر..."
sshpass -e scp -o StrictHostKeyChecking=no /tmp/update.tar.gz root@89.167.14.197:/tmp/

echo "🔄 جاري التحديث على السيرفر..."
sshpass -e ssh -o StrictHostKeyChecking=no root@89.167.14.197 '
# حفظ .env القديم
cp /var/www/Acces/RealisticHonorableDeskscan/.env /tmp/.env.backup 2>/dev/null

cd /var/www
rm -rf Acces
tar -xzf /tmp/update.tar.gz

# استعادة .env
cp /tmp/.env.backup /var/www/Acces/RealisticHonorableDeskscan/.env 2>/dev/null

# إذا لم يوجد .env، أنشئ واحد جديد
if [ ! -f /var/www/Acces/RealisticHonorableDeskscan/.env ]; then
cat > /var/www/Acces/RealisticHonorableDeskscan/.env << ENVEOF
DATABASE_URL=postgresql://access_user:AccessDB2026Secure@localhost:5432/access_db
DEPLOYMENT_ENV=production
NODE_ENV=production
PORT=3000
BLOCKCHAIN_PORT=5000
GOOGLE_CLIENT_ID=586936149662-ja0tlfjfinl2sl17j9ntp3m1avnf3dhn.apps.googleusercontent.com
VAPID_PUBLIC_KEY=BFw1vQWhw4Whdjfvb0vsdgwUf1ZNZLcJ212nkYk_frPBNKZuzS0JXsgOQZCyQVBFzxpi72sLbMNL6KkbIKmZWA0
VAPID_PRIVATE_KEY=4X5gioNCIvoO6f_DQTyEXoVeRoSHvgJoeIy-URNk1oQ
VAPID_SUBJECT=mailto:admin@access-network.com
CHAIN_ID=22888
SESSION_SECRET=AccessNetwork2026SecretKey
ENVEOF
fi

# نسخ database-config.js
cp /var/www/Acces/database-config.js /var/www/Acces/RealisticHonorableDeskscan/
sed -i "s|from \x27../database-config.js\x27|from \x27./database-config.js\x27|g" /var/www/Acces/RealisticHonorableDeskscan/db.js

cd /var/www/Acces/RealisticHonorableDeskscan
npm install --production 2>/dev/null
pm2 restart access-network
echo "✅ تم التحديث بنجاح!"
pm2 list
'

rm /tmp/update.tar.gz
echo "🎉 انتهى!"
