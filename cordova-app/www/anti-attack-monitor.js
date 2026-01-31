
// Advanced Anti-Attack Monitoring System for Access Network
// نظام مراقبة متقدم ضد الهجمات لشبكة Access

class AntiAttackMonitor {
  constructor() {
    this.suspiciousActivities = new Map();
    this.blockedAddresses = new Set();
    this.attackPatterns = new Map();
    this.monitoringEnabled = true;
    this.alertThresholds = {
      rapidTransactions: 5, // 5 transactions in 10 seconds
      duplicateNonce: 3, // 3 attempts with same nonce
      balanceManipulation: 10, // 10 failed balance checks
      timeWindow: 10000 // 10 seconds
    };
    
    // Anti-Attack Monitor initialized silently
  }

  // Monitor for rapid transaction attempts (potential spam/DoS)
  checkRapidTransactions(address) {
    const now = Date.now();
    const activities = this.suspiciousActivities.get(address) || [];
    
    // Clean old activities
    const recentActivities = activities.filter(time => (now - time) < this.alertThresholds.timeWindow);
    
    recentActivities.push(now);
    this.suspiciousActivities.set(address, recentActivities);
    
    if (recentActivities.length >= this.alertThresholds.rapidTransactions) {
      this.flagSuspiciousActivity(address, 'rapid_transactions', {
        count: recentActivities.length,
        timeWindow: this.alertThresholds.timeWindow
      });
      return false; // Block transaction
    }
    
    return true; // Allow transaction
  }

  // Monitor for double spending attempts
  // ⚡ FIX: السماح بإعادة إرسال نفس المعاملة خلال 60 ثانية (للمحافظ التي تعيد المحاولة)
  checkDoubleSpending(address, nonce, txHash) {
    const patternKey = `${address}:${nonce}`;
    const pattern = this.attackPatterns.get(patternKey) || [];
    const now = Date.now();
    
    // ⚡ تنظيف المحاولات القديمة (أكثر من 60 ثانية)
    const recentPattern = pattern.filter(p => (now - p.timestamp) < 60000);
    
    // ⚡ إذا كان نفس الـ txHash، اسمح به (نفس المعاملة)
    const sameHashExists = recentPattern.some(p => p.txHash === txHash);
    if (sameHashExists) {
      return true; // نفس المعاملة - اسمح
    }
    
    // Check if this nonce was already used recently
    if (recentPattern.length > 0) {
      recentPattern.push({
        txHash: txHash,
        timestamp: now,
        attempt: recentPattern.length + 1
      });
      
      this.attackPatterns.set(patternKey, recentPattern);
      
      // ⚡ فقط إذا كان هناك أكثر من 5 محاولات في 60 ثانية
      if (recentPattern.length >= 5) {
        this.flagSuspiciousActivity(address, 'double_spending_attempt', {
          nonce: nonce,
          attempts: recentPattern.length,
          txHashes: recentPattern.map(p => p.txHash)
        });
        
        if (recentPattern.length >= this.alertThresholds.duplicateNonce + 2) {
          this.blockAddress(address, 'Multiple double spending attempts');
          return false;
        }
      }
    } else {
      this.attackPatterns.set(patternKey, [{
        txHash: txHash,
        timestamp: now,
        attempt: 1
      }]);
    }
    
    return true;
  }

  // Monitor for balance manipulation attempts
  checkBalanceManipulation(address, reason) {
    const key = `balance_manipulation:${address}`;
    const attempts = this.suspiciousActivities.get(key) || [];
    const now = Date.now();
    
    // Clean old attempts
    const recentAttempts = attempts.filter(time => (now - time) < 60000); // 1 minute
    recentAttempts.push(now);
    
    this.suspiciousActivities.set(key, recentAttempts);
    
    if (recentAttempts.length >= this.alertThresholds.balanceManipulation) {
      this.flagSuspiciousActivity(address, 'balance_manipulation', {
        attempts: recentAttempts.length,
        reason: reason
      });
      this.blockAddress(address, 'Repeated balance manipulation attempts');
      return false;
    }
    
    return true;
  }

  // Flag suspicious activity for logging and alerts
  flagSuspiciousActivity(address, type, details) {
    const alert = {
      timestamp: Date.now(),
      address: address,
      type: type,
      details: details,
      severity: this.calculateSeverity(type, details)
    };
    
    console.log(`🚨 SUSPICIOUS ACTIVITY DETECTED: ${type}`);
    console.log(`📍 Address: ${address}`);
    console.log(`⚠️ Severity: ${alert.severity}`);
    console.log(`📊 Details:`, details);
    
    // Auto-block for high severity attacks
    if (alert.severity === 'HIGH') {
      this.blockAddress(address, `High severity ${type} detected`);
    }
    
    // Store for analysis
    this.storeSecurityAlert(alert);
    
    return alert;
  }

  // Calculate severity based on attack type and frequency
  calculateSeverity(type, details) {
    switch (type) {
      case 'double_spending_attempt':
        return details.attempts >= 3 ? 'HIGH' : 'MEDIUM';
      case 'rapid_transactions':
        return details.count >= 10 ? 'HIGH' : 'MEDIUM';
      case 'balance_manipulation':
        return details.attempts >= 5 ? 'HIGH' : 'MEDIUM';
      default:
        return 'LOW';
    }
  }

  // Block address temporarily or permanently
  blockAddress(address, reason) {
    this.blockedAddresses.add(address);
    
    console.log(`🔒 ADDRESS BLOCKED: ${address}`);
    console.log(`📝 Reason: ${reason}`);
    console.log(`⏰ Blocked at: ${new Date().toISOString()}`);
    
    // Auto-unblock after 1 hour (60 minutes)
    setTimeout(() => {
      this.unblockAddress(address);
    }, 60 * 60 * 1000);
    
    return true;
  }

  // Unblock address
  unblockAddress(address) {
    if (this.blockedAddresses.has(address)) {
      this.blockedAddresses.delete(address);
      console.log(`🔓 ADDRESS UNBLOCKED: ${address}`);
    }
  }

  // Check if address is blocked
  isBlocked(address) {
    return this.blockedAddresses.has(address);
  }

  // Store security alert for analysis
  async storeSecurityAlert(alert) {
    try {
      const { pool } = await import('./db.js');
      
      // Create security_alerts table if it doesn't exist
      await pool.query(`
        CREATE TABLE IF NOT EXISTS security_alerts (
          id SERIAL PRIMARY KEY,
          timestamp BIGINT NOT NULL,
          address TEXT NOT NULL,
          alert_type TEXT NOT NULL,
          severity TEXT NOT NULL,
          details JSONB,
          resolved BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      
      await pool.query(
        'INSERT INTO security_alerts (timestamp, address, alert_type, severity, details) VALUES ($1, $2, $3, $4, $5)',
        [alert.timestamp, alert.address, alert.type, alert.severity, JSON.stringify(alert.details)]
      );
      
    } catch (error) {
      console.error('Error storing security alert:', error);
    }
  }

  // Clean up old data to prevent memory bloat
  cleanup() {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours
    
    // Clean suspicious activities
    for (const [key, activities] of this.suspiciousActivities.entries()) {
      if (Array.isArray(activities)) {
        const recentActivities = activities.filter(time => (now - time) < maxAge);
        if (recentActivities.length > 0) {
          this.suspiciousActivities.set(key, recentActivities);
        } else {
          this.suspiciousActivities.delete(key);
        }
      }
    }
    
    // Clean attack patterns
    for (const [key, patterns] of this.attackPatterns.entries()) {
      const recentPatterns = patterns.filter(pattern => (now - pattern.timestamp) < maxAge);
      if (recentPatterns.length > 0) {
        this.attackPatterns.set(key, recentPatterns);
      } else {
        this.attackPatterns.delete(key);
      }
    }
    
    console.log(`🧹 Anti-Attack Monitor cleanup completed`);
  }

  // Get security statistics
  getSecurityStats() {
    return {
      blockedAddresses: this.blockedAddresses.size,
      suspiciousActivities: this.suspiciousActivities.size,
      attackPatterns: this.attackPatterns.size,
      monitoringEnabled: this.monitoringEnabled
    };
  }
}

// Export for use in other modules
export { AntiAttackMonitor };
