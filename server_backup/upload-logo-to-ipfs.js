import { PinataSDK } from "pinata-web3";
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import dotenv from 'dotenv';

// للحصول على __dirname في ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// قراءة متغيرات البيئة
dotenv.config();

async function uploadLogoToIPFS() {
  const pinataJWT = process.env.PINATA_JWT;
  
  if (!pinataJWT) {
    console.error('❌ لم يتم العثور على PINATA_JWT');
    console.error('💡 تأكد من إضافة PINATA_JWT في Replit Secrets');
    process.exit(1);
  }
  
  const pinata = new PinataSDK({
    pinataJwt: pinataJWT,
    pinataGateway: "gateway.pinata.cloud"
  });

  try {
    // المسار للصورة المراد رفعها
    const logoPath = path.join(__dirname, 'access-logo-1 ipfs.png');
    
    // تحقق من وجود الملف
    if (!fs.existsSync(logoPath)) {
      console.error('❌ ملف اللوغو غير موجود:', logoPath);
      console.error('📁 تحقق من المسار الصحيح');
      process.exit(1);
    }

    // احصل على حجم الملف
    const stats = fs.statSync(logoPath);
    const fileSizeInKB = stats.size / 1024;
    console.log(`📊 حجم الملف: ${fileSizeInKB.toFixed(2)} KB`);

    // قراءة الملف
    const fileBuffer = fs.readFileSync(logoPath);
    
    console.log('📤 جاري رفع الصورة إلى IPFS...');
    
    // إنشاء Blob من Buffer
    const { Blob } = await import('buffer');
    const blob = new Blob([fileBuffer], { type: 'image/png' });
    
    // إنشاء File object
    const file = Object.assign(blob, {
      name: 'access-logo-1.png',
      lastModified: Date.now()
    });
    
    // رفع الملف إلى Pinata
    const upload = await pinata.upload.file(file);
    
    console.log('\n✅ تم الرفع بنجاح!');
    console.log('📌 IPFS CID:', upload.IpfsHash);
    console.log('🌐 IPFS URL:', `ipfs://${upload.IpfsHash}`);
    console.log('🔗 Gateway URL:', `https://gateway.pinata.cloud/ipfs/${upload.IpfsHash}`);
    
    // احفظ الـ CID في ملف للمرجعية
    const cidFile = path.join(__dirname, 'ipfs-cids.json');
    let cids = {};
    
    if (fs.existsSync(cidFile)) {
      const content = fs.readFileSync(cidFile, 'utf-8');
      cids = JSON.parse(content);
    }
    
    cids['access-logo-1'] = {
      ipfsHash: upload.IpfsHash,
      gateway: `https://gateway.pinata.cloud/ipfs/${upload.IpfsHash}`,
      uploadedAt: new Date().toISOString()
    };
    
    fs.writeFileSync(cidFile, JSON.stringify(cids, null, 2));
    console.log('\n✅ تم حفظ الـ CID في ipfs-cids.json');

  } catch (error) {
    console.error('❌ خطأ في رفع الملف:', error.message);
    console.error('\n💡 تأكد من:');
    console.error('1. أن JWT صحيح وموجود في Replit Secrets');
    console.error('2. أن حسابك نشط في Pinata');
    console.error('3. أن الملف موجود في المسار الصحيح');
    process.exit(1);
  }
}

uploadLogoToIPFS();
