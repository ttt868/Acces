/**
 * NFT Mint Test Script
 * اختبار نشر عقد NFT وصك NFT جديد
 */

import { SmartContractEngine } from './contract-engine.js';
import { pool } from './db.js';

// محاكاة Access Node للاختبار
const mockAccessNode = {
  async getNonceForAddress(address) {
    return 0;
  },
  stateStorage: {
    accounts: new Map(),
    async getAccount(address) {
      return this.accounts.get(address.toLowerCase());
    },
    async putAccount(address, account) {
      this.accounts.set(address.toLowerCase(), account);
    }
  }
};

async function testNFTDeploymentAndMint() {
  console.log('\n🧪 بدء اختبار نظام NFT Mint\n');
  
  try {
    // 1. إنشاء Smart Contract Engine
    const contractEngine = new SmartContractEngine(mockAccessNode);
    console.log('✅ تم إنشاء محرك العقود الذكية');
    
    // 2. نشر عقد NFT جديد
    const deployerAddress = '0x1234567890123456789012345678901234567890';
    const nftContractData = {
      name: 'Access Network NFT',
      symbol: 'ANFT',
      baseURI: 'https://api.access-network.io/nft/',
      maxSupply: 10000
    };
    
    console.log('\n📝 نشر عقد NFT...');
    const deployment = await contractEngine.deployContract(
      deployerAddress,
      nftContractData,
      'ERC721'
    );
    
    console.log(`✅ تم نشر عقد NFT:`);
    console.log(`   عنوان العقد: ${deployment.contractAddress}`);
    console.log(`   المنشئ: ${deployment.deployer}`);
    console.log(`   النوع: ${deployment.type}`);
    
    // 3. صك NFT جديد
    console.log('\n🎨 صك NFT جديد...');
    const recipientAddress = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';
    const tokenURI = 'https://api.access-network.io/nft/metadata/1';
    const txHash = '0x' + Array.from({length: 64}, () => 
      Math.floor(Math.random() * 16).toString(16)
    ).join('');
    
    // الحصول على العقد
    const contract = await contractEngine.getContract(deployment.contractAddress);
    
    // صك NFT
    const tokenId = await contractEngine.erc721Mint(
      deployment.contractAddress,
      contract,
      recipientAddress,
      tokenURI,
      deployerAddress,
      txHash
    );
    
    console.log(`✅ تم صك NFT:`);
    console.log(`   Token ID: #${tokenId}`);
    console.log(`   المالك: ${recipientAddress}`);
    console.log(`   Token URI: ${tokenURI}`);
    console.log(`   Transaction Hash: ${txHash}`);
    
    // 4. التحقق من حفظ البيانات في قاعدة البيانات
    console.log('\n🔍 التحقق من قاعدة البيانات...');
    const result = await pool.query(
      'SELECT * FROM nft_mints WHERE tx_hash = $1',
      [txHash]
    );
    
    if (result.rows.length > 0) {
      const mintData = result.rows[0];
      console.log(`✅ تم حفظ البيانات في قاعدة البيانات:`);
      console.log(`   Contract: ${mintData.contract_address}`);
      console.log(`   Minter: ${mintData.minter_address}`);
      console.log(`   Recipient: ${mintData.recipient_address}`);
      console.log(`   Token ID: ${mintData.token_id}`);
      console.log(`   NFT Name: ${mintData.nft_name}`);
      console.log(`   NFT Symbol: ${mintData.nft_symbol}`);
    } else {
      console.log('❌ لم يتم العثور على البيانات في قاعدة البيانات');
    }
    
    // 5. صك المزيد من NFTs للاختبار
    console.log('\n🎨 صك 5 NFTs إضافية للاختبار...');
    for (let i = 2; i <= 6; i++) {
      const newTxHash = '0x' + Array.from({length: 64}, () => 
        Math.floor(Math.random() * 16).toString(16)
      ).join('');
      
      const newTokenURI = `https://api.access-network.io/nft/metadata/${i}`;
      const newRecipient = '0x' + Array.from({length: 40}, () => 
        Math.floor(Math.random() * 16).toString(16)
      ).join('');
      
      await contractEngine.erc721Mint(
        deployment.contractAddress,
        contract,
        newRecipient,
        newTokenURI,
        deployerAddress,
        newTxHash
      );
      
      console.log(`   ✓ NFT #${i} تم صكه للمالك: ${newRecipient.substring(0, 10)}...`);
    }
    
    // 6. عرض إحصائيات
    console.log('\n📊 إحصائيات NFT Mints:');
    const stats = await pool.query(`
      SELECT 
        COUNT(*) as total_mints,
        COUNT(DISTINCT contract_address) as total_contracts,
        COUNT(DISTINCT minter_address) as total_minters,
        COUNT(DISTINCT recipient_address) as total_recipients
      FROM nft_mints
    `);
    
    if (stats.rows.length > 0) {
      const s = stats.rows[0];
      console.log(`   إجمالي NFTs: ${s.total_mints}`);
      console.log(`   إجمالي العقود: ${s.total_contracts}`);
      console.log(`   إجمالي Minters: ${s.total_minters}`);
      console.log(`   إجمالي المستلمين: ${s.total_recipients}`);
    }
    
    console.log('\n✅ اكتمل الاختبار بنجاح!\n');
    console.log('🌐 يمكنك الآن زيارة latest-mint.html لرؤية NFT mints');
    console.log('📝 أو استخدام API: GET /api/nft/mints\n');
    
  } catch (error) {
    console.error('\n❌ خطأ في الاختبار:', error);
    throw error;
  } finally {
    // إغلاق الاتصال بقاعدة البيانات
    await pool.end();
  }
}

// تشغيل الاختبار
if (import.meta.url === `file://${process.argv[1]}`) {
  testNFTDeploymentAndMint()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

export { testNFTDeploymentAndMint };
