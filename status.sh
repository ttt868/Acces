#!/bin/bash
# 📊 حالة السيرفر
if [ -z "$SSHPASS" ]; then
  echo "❌ Set SSHPASS environment variable first: export SSHPASS='your-password'"
  exit 1
fi
sshpass -e ssh -o StrictHostKeyChecking=no root@89.167.14.197 "
echo '=== PM2 ===' && pm2 list
echo '' && echo '=== PostgreSQL ===' && systemctl status postgresql | head -3
echo '' && echo '=== البيانات ===' && sudo -u postgres psql -d access_db -c \"SELECT 'users', COUNT(*) FROM users UNION ALL SELECT 'blocks', COUNT(*) FROM ethereum_blocks;\"
echo '' && echo '=== الذاكرة ===' && free -h | head -2
"
