// nodemailer-config.js
import nodemailer from 'nodemailer';

// إعدادات SMTP لـ Namecheap Private Email
const transporter = nodemailer.createTransport({
  host: 'mail.privateemail.com',
  port: 587,
  secure: false,
  auth: {
    user: 'support@accesschain.org',
    pass: 'Midouyaya1@'
  },
  tls: {
    rejectUnauthorized: false
  }
});

export default transporter;
