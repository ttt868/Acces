
// API للوصول لبيانات التخزين الخارجي
import ExternalWalletStorageManager from './external-wallet-storage.js';

const externalStorage = new ExternalWalletStorageManager();

// API endpoints للتخزين الخارجي
export async function handleStorageAPI(req, res, pathname, method) {
  try {
    // GET /api/storage/wallet/:address - الحصول على بيانات محفظة خارجية
    if (pathname.match(/^\/api\/storage\/wallet\/0x[a-fA-F0-9]{40}$/) && method === 'GET') {
      const address = pathname.split('/')[4];
      
      const balance = await externalStorage.getWalletBalance(address);
      const transactions = await externalStorage.getWalletTransactions(address, 50);
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        address: address,
        balance: balance,
        transactions: transactions,
        source: 'external_storage'
      }));
      return true;
    }

    // GET /api/storage/wallet/:address/transactions - معاملات المحفظة من التخزين
    if (pathname.match(/^\/api\/storage\/wallet\/0x[a-fA-F0-9]{40}\/transactions$/) && method === 'GET') {
      const address = pathname.split('/')[4];
      const url = new URL(req.url, `http://${req.headers.host}`);
      const limit = parseInt(url.searchParams.get('limit')) || 50;
      
      const transactions = await externalStorage.getWalletTransactions(address, limit);
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        address: address,
        transactions: transactions,
        count: transactions.length,
        source: 'external_storage'
      }));
      return true;
    }

    // GET /api/storage/stats - إحصائيات التخزين
    if (pathname === '/api/storage/stats' && method === 'GET') {
      const stats = externalStorage.getStorageStats();
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        stats: stats
      }));
      return true;
    }

    // POST /api/storage/cleanup - تنظيف البيانات القديمة
    if (pathname === '/api/storage/cleanup' && method === 'POST') {
      const cleaned = await externalStorage.cleanupOldData();
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        cleanedFiles: cleaned,
        message: `تم تنظيف ${cleaned} ملف قديم`
      }));
      return true;
    }

    return false;
  } catch (error) {
    console.error('Storage API error:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: false,
      error: error.message
    }));
    return true;
  }
}
