
// سكريبت ترحيل الأرصدة الموجودة إلى البلوك تشين
async function migrateBalances() {
  try {
    const response = await fetch('http://localhost:3000/rpc', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'access_migrateBalances',
        params: [],
        id: 1
      })
    });

    const result = await response.json();
    
    if (result.result && result.result.success) {
      console.log('✅ Migration completed successfully!');
      console.log(`📊 Total migrated: ${result.result.totalMigrated} coins`);
      console.log(`👥 Users migrated: ${result.result.usersCount}`);
      console.log(`🔗 Block hash: ${result.result.blockHash}`);
      console.log(`📦 Block index: ${result.result.blockIndex}`);
    } else {
      console.error('❌ Migration failed:', result.result.error || result.error);
    }

    // التحقق من المعروض المحدث
    const networkResponse = await fetch('http://localhost:3000/rpc');
    const networkInfo = await networkResponse.json();
    
    console.log('\n📈 Updated Network Info:');
    console.log(`Total Supply: ${networkInfo.totalSupply}`);
    console.log(`Circulating Supply: ${networkInfo.circulatingSupply}`);
    console.log(`Block Height: ${networkInfo.blockHeight}`);

  } catch (error) {
    console.error('Error during migration:', error);
  }
}

// تشغيل الترحيل
migrateBalances();
