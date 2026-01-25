#!/bin/bash
# 📋 عرض سجلات السيرفر
sshpass -p "Access2026Hetzner" ssh -o StrictHostKeyChecking=no root@89.167.14.197 "pm2 logs --lines 50"
