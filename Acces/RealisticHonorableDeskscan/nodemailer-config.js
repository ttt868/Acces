// nodemailer-config.js
import 'dotenv/config';
import nodemailer from 'nodemailer';

// إعدادات SMTP - تُقرأ من متغيرات البيئة .env
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'mail.privateemail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  },
  tls: {
    rejectUnauthorized: false
  }
});

export default transporter;
