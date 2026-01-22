/**
 * 🔄 Load Balancer - توزيع الحمل على عدة سيرفرات
 * 
 * الفكرة: بدلاً من سيرفر واحد، لديك 3 سيرفرات
 * إذا سقط واحد = الاثنين الباقيين يستمرون
 * المستخدم لا يلاحظ شيء!
 * 
 * ┌─────────────────────────────────────────────────────┐
 * │                    المستخدمين                        │
 * │                        ↓                             │
 * │              ┌─────────────────┐                     │
 * │              │  Load Balancer  │                     │
 * │              │   (الموزع)      │                     │
 * │              └────────┬────────┘                     │
 * │           ┌───────────┼───────────┐                  │
 * │           ↓           ↓           ↓                  │
 * │      ┌────────┐  ┌────────┐  ┌────────┐             │
 * │      │Server 1│  │Server 2│  │Server 3│             │
 * │      │  :5001 │  │  :5002 │  │  :5003 │             │
 * │      └────────┘  └────────┘  └────────┘             │
 * │           ↓           ↓           ↓                  │
 * │      ┌─────────────────────────────────┐            │
 * │      │     PostgreSQL Database         │            │
 * │      │      (قاعدة بيانات واحدة)        │            │
 * │      └─────────────────────────────────┘            │
 * └─────────────────────────────────────────────────────┘
 */

import http from 'http';

class SimpleLoadBalancer {
  constructor(servers) {
    // قائمة السيرفرات
    this.servers = servers.map(s => ({
      ...s,
      alive: true,
      connections: 0,
      lastCheck: Date.now()
    }));
    
    this.currentIndex = 0;
    
    // فحص صحة السيرفرات كل 10 ثواني
    setInterval(() => this.healthCheck(), 10000);
  }

  /**
   * 🔄 اختيار السيرفر التالي (Round Robin)
   */
  getNextServer() {
    const aliveServers = this.servers.filter(s => s.alive);
    
    if (aliveServers.length === 0) {
      console.error('❌ كل السيرفرات ميتة!');
      return null;
    }
    
    // Round Robin - كل طلب يذهب للسيرفر التالي
    this.currentIndex = (this.currentIndex + 1) % aliveServers.length;
    return aliveServers[this.currentIndex];
  }

  /**
   * 💓 فحص صحة السيرفرات
   */
  async healthCheck() {
    for (const server of this.servers) {
      try {
        const isAlive = await this.pingServer(server);
        
        if (isAlive && !server.alive) {
          console.log(`✅ Server ${server.host}:${server.port} عاد للحياة!`);
        } else if (!isAlive && server.alive) {
          console.log(`❌ Server ${server.host}:${server.port} سقط!`);
        }
        
        server.alive = isAlive;
        server.lastCheck = Date.now();
      } catch (e) {
        server.alive = false;
      }
    }
    
    const aliveCount = this.servers.filter(s => s.alive).length;
    console.log(`💓 Health Check: ${aliveCount}/${this.servers.length} servers alive`);
  }

  pingServer(server) {
    return new Promise((resolve) => {
      const req = http.get({
        host: server.host,
        port: server.port,
        path: '/health',
        timeout: 3000
      }, (res) => {
        resolve(res.statusCode === 200);
      });
      
      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
    });
  }

  /**
   * 🚀 توجيه الطلب للسيرفر المناسب
   */
  proxyRequest(clientReq, clientRes) {
    const server = this.getNextServer();
    
    if (!server) {
      clientRes.writeHead(503);
      clientRes.end('Service Unavailable - All servers are down');
      return;
    }

    console.log(`→ Routing to ${server.host}:${server.port}`);
    server.connections++;

    const proxyReq = http.request({
      host: server.host,
      port: server.port,
      path: clientReq.url,
      method: clientReq.method,
      headers: clientReq.headers
    }, (proxyRes) => {
      clientRes.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(clientRes);
      server.connections--;
    });

    proxyReq.on('error', (err) => {
      console.error(`❌ Proxy error to ${server.host}:${server.port}:`, err.message);
      server.alive = false;
      server.connections--;
      
      // حاول سيرفر آخر
      this.proxyRequest(clientReq, clientRes);
    });

    clientReq.pipe(proxyReq);
  }

  /**
   * 🎯 بدء Load Balancer
   */
  start(port = 80) {
    const server = http.createServer((req, res) => {
      this.proxyRequest(req, res);
    });

    server.listen(port, () => {
      console.log(`\n🔄 Load Balancer running on port ${port}`);
      console.log(`📊 Distributing to ${this.servers.length} servers:`);
      this.servers.forEach(s => {
        console.log(`   - ${s.host}:${s.port}`);
      });
    });

    return server;
  }
}

// ============================================================
// 📋 مثال الاستخدام
// ============================================================

const loadBalancer = new SimpleLoadBalancer([
  { host: 'localhost', port: 5001 },  // السيرفر 1
  { host: 'localhost', port: 5002 },  // السيرفر 2
  { host: 'localhost', port: 5003 },  // السيرفر 3
]);

// تشغيل Load Balancer على port 5000
// loadBalancer.start(5000);

export default SimpleLoadBalancer;

/**
 * ============================================================
 * 🎯 كيف يعمل؟
 * ============================================================
 * 
 * 1. المستخدم يرسل طلب → Load Balancer (port 5000)
 * 2. Load Balancer يختار سيرفر متاح
 * 3. يوجه الطلب للسيرفر المختار
 * 4. السيرفر يرد → Load Balancer → المستخدم
 * 
 * إذا سقط سيرفر:
 * - Health Check يكتشف السقوط
 * - يُزيله من القائمة مؤقتاً
 * - الطلبات تذهب للسيرفرات الأخرى
 * - المستخدم لا يلاحظ شيء!
 * 
 * ============================================================
 * 📱 كيف تستخدمه على الإنتاج؟
 * ============================================================
 * 
 * الطريقة 1: Render (سهلة)
 * - أنشئ 3 Web Services بنفس الكود
 * - استخدم Render's Load Balancer
 * - التكلفة: ~$21/شهر (3 × $7)
 * 
 * الطريقة 2: Nginx (أفضل)
 * - سيرفر واحد يشغل Nginx
 * - Nginx يوزع على 3 سيرفرات
 * - أداء أفضل وتكلفة أقل
 * 
 * الطريقة 3: Cloudflare (الأسهل)
 * - Cloudflare يوزع الحمل تلقائياً
 * - حماية DDoS مجانية
 * - CDN عالمي
 * 
 * ============================================================
 */
