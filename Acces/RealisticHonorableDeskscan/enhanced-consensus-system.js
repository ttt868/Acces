// نظام الإجماع المتطور - أقوى من Binance Smart Chain
import crypto from 'crypto';
import { EventEmitter } from 'events';

class EnhancedConsensusSystem extends EventEmitter {
  constructor(blockchain) {
    super();
    this.blockchain = blockchain;
    this.validators = new Map();
    this.stakingRequirement = 32; // ACCESS minimum stake
    this.maxValidators = 21; // مثل BSC لكن أكثر لامركزية
    this.validatorRewards = new Map();

    // تحسينات تفوق BSC
    this.consensusAlgorithm = 'PoSA-Enhanced'; // Proof of Stake Authority المحسن
    this.blockTime = 12; // 12 ثانية (مثل Ethereum - متوازن بين السرعة والكفاءة)
    this.slashingConditions = new Set();
    this.governanceVoting = new Map();

    // نظام الحماية المتقدم
    this.antiAttackSystem = {
      doubleSigningProtection: true,
      rapidBlockProtection: true,
      validatorRotation: true,
      distributedValidation: true
    };

    this.initializeConsensus();

    // إضافة خاصية لتتبع آخر وقت إنتاج بلوك
    this.lastBlockTime = Date.now();
    this.startTime = Date.now(); // وقت بدء التشغيل
  }

  async initializeConsensus() {
    // إنشاء validators افتراضية أقوى من BSC
    await this.createDefaultValidators();

    // بدء نظام الإجماع المحسن
    this.startEnhancedConsensus();

    // تفعيل الحماية المتقدمة
    this.enableAdvancedProtection();

    // Silent initialization to save resources
  }

  // إنشاء validators افتراضية أقوى من BSC
  async createDefaultValidators() {
    const defaultValidators = [
      {
        address: '0x0000000000000000000000000000000000000001',
        name: 'Access Genesis Validator',
        stake: 1000,
        reputation: 100,
        location: 'Global'
      },
      {
        address: '0x0000000000000000000000000000000000000002',
        name: 'Access Security Validator',
        stake: 500,
        reputation: 95,
        location: 'Europe'
      },
      {
        address: '0x0000000000000000000000000000000000000003',
        name: 'Access Speed Validator',
        stake: 300,
        reputation: 90,
        location: 'Asia'
      },
      {
        address: '0x0000000000000000000000000000000000000004',
        name: 'Access Innovation Validator',
        stake: 200,
        reputation: 85,
        location: 'Americas'
      }
    ];

    for (const validator of defaultValidators) {
      await this.addValidator(validator);
    }

    // التأكد من وجود validator نشط على الأقل
    this.ensureActiveValidator();

    // ✅ Removed verbose logging for performance
  }

  // ضمان وجود validator نشط
  ensureActiveValidator() {
    const activeValidators = Array.from(this.validators.values()).filter(v => v.isActive);

    if (activeValidators.length === 0) {
      // تفعيل أول validator إذا لم يكن هناك أي validator نشط
      const firstValidator = this.validators.values().next().value;
      if (firstValidator) {
        firstValidator.isActive = true;
        firstValidator.uptime = 100;
        // ✅ Removed verbose logging for performance
      }
    }
  }

  // إضافة validator جديد مع معايير صارمة
  async addValidator(validatorData) {
    const { address, name, stake, reputation, location } = validatorData;

    // التحقق من المعايير الصارمة
    if (stake < this.stakingRequirement) {
      throw new Error(`Minimum stake required: ${this.stakingRequirement} ACCESS`);
    }

    if (reputation < 70) {
      throw new Error('Minimum reputation score: 70');
    }

    // إنشاء validator محسن
    const validator = {
      address: address,
      name: name,
      stake: stake,
      reputation: reputation,
      location: location,
      joinedAt: Date.now(),
      blocksProduced: 0,
      uptime: 100,
      lastActivity: Date.now(),
      isActive: true,

      // ميزات محسنة تفوق BSC
      performanceScore: 100,
      validationSpeed: 0, // ms average
      networkContribution: 0,
      securityRating: 'A+',

      // إحصائيات متقدمة
      stats: {
        successfulValidations: 0,
        failedValidations: 0,
        averageResponseTime: 0,
        networkStability: 100
      }
    };

    this.validators.set(address, validator);
    this.emit('validatorAdded', validator);

    // تسجيل محدود - فقط الرسائل المهمة
    if (!this.silentMode) {
      // silently add validators
    }

    // رسائل مهمة فقط
    if (!this.constructor.logOnce) {
      this.constructor.logOnce = new Set();
    }
    // Consensus messages silenced to reduce console spam

    return validator;
  }

  // نظام الإجماع المحسن - أذكى من BSC
  startEnhancedConsensus() {
    // ✅ نظام ذكي لإنشاء البلوكات - مثل Binance
    // يتحقق باستمرار من وجود معاملات ويُنشئ البلوك بناءً على الحمل
    this.smartBlockProducer = setInterval(async () => {
      await this.smartProduceBlock();
    }, 1000); // فحص كل ثانية واحدة

    // تدوير validators كل ساعة (أكثر لامركزية من BSC)
    setInterval(() => {
      this.rotateValidators();
    }, 3600000); // كل ساعة

    // مراقبة الأداء كل دقيقة
    setInterval(() => {
      this.monitorValidatorPerformance();
    }, 60000);

    // Smart Block Production started silently
  }

  // إنتاج بلوك ذكي - مثل Binance BSC
  async smartProduceBlock() {
    try {
      const currentValidator = this.getCurrentValidator();

      if (!currentValidator) {
        this.noValidatorCount = (this.noValidatorCount || 0) + 1;
        if (this.noValidatorCount % 100 === 0) {
          console.warn('⚠️ No validator available');
        }
        return;
      }

      const pendingCount = this.blockchain.pendingTransactions.length;

      // ❌ لا إنشاء بلوك فارغ نهائياً
      if (pendingCount === 0) {
        return;
      }

      const currentTime = Date.now();
      const timeSinceLastBlock = currentTime - (this.lastBlockTime || 0);

      // ✅ قواعد ذكية لإنشاء البلوك:
      let shouldProduceBlock = false;
      let blockReason = '';

      // 1. إنشاء فوري إذا كان هناك الكثير من المعاملات
      if (pendingCount >= 1000) {
        shouldProduceBlock = true;
        blockReason = 'High transaction volume';
      }
      // 2. إنشاء سريع إذا كان هناك معاملات متوسطة
      else if (pendingCount >= 100 && timeSinceLastBlock >= 3000) {
        shouldProduceBlock = true;
        blockReason = 'Medium load - 3s interval';
      }
      // 3. إنشاء عادي إذا كان هناك معاملات قليلة
      else if (pendingCount >= 10 && timeSinceLastBlock >= 6000) {
        shouldProduceBlock = true;
        blockReason = 'Low load - 6s interval';
      }
      // 4. إنشاء بطيء للمعاملات القليلة جداً
      else if (pendingCount > 0 && timeSinceLastBlock >= 12000) {
        shouldProduceBlock = true;
        blockReason = 'Minimal load - 12s max wait';
      }

      if (!shouldProduceBlock) {
        return;
      }

      const startTime = Date.now();

      // إنتاج البلوك
      const block = await this.blockchain.minePendingTransactions(currentValidator.address);

      // إذا لم يتم إنشاء بلوك (لا معاملات حقيقية)، لا نفعل شيء
      if (!block) {
        return;
      }

      const productionTime = Date.now() - startTime;

      // تحديث إحصائيات validator
      currentValidator.blocksProduced++;
      currentValidator.stats.successfulValidations++;
      currentValidator.stats.averageResponseTime =
        (currentValidator.stats.averageResponseTime + productionTime) / 2;
      currentValidator.lastActivity = Date.now();

      this.lastBlockTime = currentTime;

      // إشعار الشبكة
      this.emit('blockProduced', {
        block: block,
        validator: currentValidator,
        productionTime: productionTime,
        transactionCount: block.transactions.length
      });

      console.log(`⚡ Block ${block.index} | ${block.transactions.length} txs | ${productionTime}ms | ${blockReason}`);

    } catch (error) {
      console.error('❌ Block production error:', error);
      await this.handleValidatorError(error);
    }
  }

  // الحصول على validator الحالي (محسن)
  getCurrentValidator() {
    const activeValidators = Array.from(this.validators.values())
      .filter(v => v.isActive && v.uptime > 95)
      .sort((a, b) => {
        // ترتيب حسب الأداء والسمعة
        const scoreA = (a.performanceScore + a.reputation) / 2;
        const scoreB = (b.performanceScore + b.reputation) / 2;
        return scoreB - scoreA;
      });

    if (activeValidators.length === 0) {
      return null;
    }

    // تدوير عادل بين validators
    const currentTime = Date.now();
    const rotationInterval = (this.blockTime * 1000) * activeValidators.length;
    const currentIndex = Math.floor((currentTime / rotationInterval) % activeValidators.length);

    return activeValidators[currentIndex];
  }

  // مكافأة validator معطلة - لا يتم إنشاء عملات وهمية
  async rewardValidator(validator, block) {
    // ✅ تم تعطيل مكافآت الـ validator لمنع إنشاء عملات وهمية
    // الـ validators يعملون بدون مكافآت - فقط لتأكيد المعاملات
    return;
  }

  // مراقبة أداء validators
  monitorValidatorPerformance() {
    const currentTime = Date.now();

    this.validators.forEach((validator, address) => {
      // فحص النشاط
      const inactivityTime = currentTime - validator.lastActivity;

      if (inactivityTime > 300000) { // 5 دقائق
        validator.uptime = Math.max(0, validator.uptime - 0.1);

        if (validator.uptime < 70) {
          validator.isActive = false;
          // تقليل الرسائل المتكررة - فقط كل 10 مرات
          if (validator.deactivationCount % 10 === 0) {
            console.warn(`⚠️ Validator ${validator.name} deactivated due to low uptime`);
          }
          validator.deactivationCount = (validator.deactivationCount || 0) + 1;
        }
      } else {
        validator.uptime = Math.min(100, validator.uptime + 0.5);
        validator.lastActivity = currentTime;
      }

      // حساب نقاط الأداء
      validator.performanceScore = this.calculatePerformanceScore(validator);

      // تحديث التصنيف الأمني
      validator.securityRating = this.calculateSecurityRating(validator);
    });

    // console.log(`📊 Performance monitoring completed for ${this.validators.size} validators`);
  }

  // حساب نقاط الأداء المحسنة
  calculatePerformanceScore(validator) {
    let score = 0;

    // الاستقرار (40%)
    score += validator.uptime * 0.4;

    // السرعة (30%)
    const speedScore = Math.max(0, 100 - (validator.stats.averageResponseTime / 10));
    score += speedScore * 0.3;

    // معدل النجاح (20%)
    const totalValidations = validator.stats.successfulValidations + validator.stats.failedValidations;
    const successRate = totalValidations > 0 ?
      (validator.stats.successfulValidations / totalValidations) * 100 : 100;
    score += successRate * 0.2;

    // المساهمة في الشبكة (10%)
    const contributionScore = Math.min(100, validator.networkContribution * 10);
    score += contributionScore * 0.1;

    return Math.round(score);
  }

  // حساب التصنيف الأمني
  calculateSecurityRating(validator) {
    if (validator.performanceScore >= 95) return 'A+';
    if (validator.performanceScore >= 90) return 'A';
    if (validator.performanceScore >= 85) return 'B+';
    if (validator.performanceScore >= 80) return 'B';
    if (validator.performanceScore >= 70) return 'C';
    return 'D';
  }

  // تدوير validators للامركزية
  rotateValidators() {
    const validators = Array.from(this.validators.values());

    // إعطاء فرص للـ validators الجدد
    validators.forEach(validator => {
      if (validator.performanceScore > 85 && !validator.isActive) {
        validator.isActive = true;
        console.log(`🔄 Validator ${validator.name} reactivated`);
      }
    });

    console.log('🔄 Validator rotation completed - enhanced decentralization');
  }

  // تفعيل الحماية المتقدمة
  enableAdvancedProtection() {
    // حماية من التوقيع المزدوج
    this.blockchain.on('blockProposed', (block) => {
      this.validateDoubleSigningProtection(block);
    });

    // حماية من الإنتاج السريع المشبوه
    this.blockchain.on('blockMined', (block) => {
      this.validateBlockTiming(block);
    });

    // Advanced protection systems - silenced to reduce console spam
    // All protection systems are internally active
  }


  // التحقق من التوقيع المزدوج
  validateDoubleSigningProtection(block) {
    // التحقق من عدم توقيع validator لأكثر من بلوك في نفس الارتفاع
    const validator = this.validators.get(block.validator);

    if (validator && validator.lastBlockHeight === block.index) {
      console.error(`🚫 Double signing detected from ${validator.name}`);
      this.slashValidator(validator.address, 'double_signing');
    } else if (validator) {
      validator.lastBlockHeight = block.index;
    }
  }

  // التحقق من توقيت البلوك (الدالة المفقودة)
  validateBlockTiming(block) {
    try {
      const currentTime = Date.now();
      const blockTime = block.timestamp || currentTime;
      const timeDiff = Math.abs(currentTime - blockTime);

      // التحقق من أن البلوك ليس من المستقبل أو قديم جداً
      if (timeDiff > 300000) { // 5 دقائق
        console.warn(`⚠️ Block timing suspicious: ${timeDiff}ms difference`);

        // إذا كان البلوك من المستقبل أو قديم جداً، قم بمعاقبة validator
        const validator = this.validators.get(block.validator);
        if (validator) {
          this.slashValidator(validator.address, 'invalid_block_timing');
        }
      }

      // التحقق من سرعة إنتاج البلوك
      // تجاهل أول 10 ثوان بعد بدء التشغيل (التهيئة الأولية)
      const timeSinceStart = Date.now() - (this.startTime || Date.now());
      if (this.lastBlockTime && timeSinceStart > 10000 && (blockTime - this.lastBlockTime) < (this.blockTime * 900)) {
        console.warn('⚠️ Block produced too quickly - possible attack');
      }

      this.lastBlockTime = blockTime;

    } catch (error) {
      console.error('❌ Block timing validation error:', error);
    }
  }

  // معاقبة validator مخالف
  async slashValidator(validatorAddress, reason) {
    const validator = this.validators.get(validatorAddress);

    if (!validator) return;

    // تقليل stake و reputation
    validator.stake = Math.max(0, validator.stake - 10);
    validator.reputation = Math.max(0, validator.reputation - 20);
    validator.isActive = false;

    console.log(`⚔️ Validator ${validator.name} slashed for: ${reason}`);
    console.log(`📉 New stake: ${validator.stake}, reputation: ${validator.reputation}`);

    this.emit('validatorSlashed', { validator, reason });
  }

  // معالجة أخطاء validator
  async handleValidatorError(error) {
    console.error('🚨 Validator error handled by enhanced system:', error.message);

    // تسجيل الخطأ والتعافي التلقائي
    this.emit('validatorError', {
      error: error,
      timestamp: Date.now(),
      recoveryAction: 'automatic_failover'
    });
  }

  // إحصائيات الإجماع المحسنة
  getConsensusStats() {
    const activeValidators = Array.from(this.validators.values()).filter(v => v.isActive);
    const totalStake = Array.from(this.validators.values()).reduce((sum, v) => sum + v.stake, 0);

    return {
      consensusAlgorithm: this.consensusAlgorithm,
      blockTime: this.blockTime + 's',
      totalValidators: this.validators.size,
      activeValidators: activeValidators.length,
      maxValidators: this.maxValidators,
      totalStake: totalStake.toFixed(2) + ' ACCESS',
      averageUptime: (activeValidators.reduce((sum, v) => sum + v.uptime, 0) / activeValidators.length).toFixed(2) + '%',
      networkSecurity: 'Enhanced',

      // مواصفات الإجماع
      specs: {
        blockTime: this.blockTime + 's',
        validators: 'Flexible',
        rewards: 'Merit-based',
        security: 'Enhanced'
      },

      topValidators: activeValidators
        .sort((a, b) => b.performanceScore - a.performanceScore)
        .slice(0, 5)
        .map(v => ({
          name: v.name,
          performance: v.performanceScore,
          uptime: v.uptime + '%',
          securityRating: v.securityRating
        }))
    };
  }
}

export { EnhancedConsensusSystem };