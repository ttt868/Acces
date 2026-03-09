#!/bin/bash
# 📋 عرض سجلات السيرفر
if [ -z "$SSHPASS" ]; then
  echo "❌ Set SSHPASS environment variable first: export SSHPASS='your-password'"
  exit 1
fi
sshpass -e ssh -o StrictHostKeyChecking=no root@89.167.14.197 "pm2 logs --lines 50"
