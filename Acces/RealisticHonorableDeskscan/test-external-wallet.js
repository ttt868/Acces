// External Wallet Testing Script for Access Network
console.log('🔗 Starting External Wallet Test Script');

// Test configuration
const TEST_CONFIG = {
  rpcUrl: 'https://1cc9135a-3ebc-402c-aff5-4380b0bd6bcb-00-3pdmmadfncvlr.riker.replit.dev:5000',
  chainId: '0x5968', // 22888 in hex
  networkId: '22888',
  networkName: 'Access Network',
  currency: {
    name: 'Access Network',  
    symbol: 'ACCESS',
    decimals: 18
  }
};

// Test wallet addresses from your screenshot
const TEST_ADDRESSES = [
  '0x3e1a39cfee55aab399cfdf6d31c67c857b444d66',
  '0x2d29fd7f8024c2b7c008b187d1dc749b5f66725f',
  '0x76b512910a463100bb52ac3ce0c021c58e06af4e',
  '0xd82b3ae10ed3423f481e0bc6a00b1355eb4af8ed'
];

// Test functions
async function testNetworkConnection() {
  console.log('📡 Testing network connection...');

  try {
    const response = await fetch(TEST_CONFIG.rpcUrl);
    if (response.ok) {
      const data = await response.json();
      console.log('✅ Network connection successful:', data);
      return true;
    }
  } catch (error) {
    console.error('❌ Network connection failed:', error.message);
    return false;
  }
}

async function testWalletBalance(address) {
  console.log(`💰 Testing balance for: ${address}`);

  try {
    const response = await fetch(TEST_CONFIG.rpcUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_getBalance',
        params: [address, 'latest'],
        id: 1
      })
    });

    const data = await response.json();
    if (data.result) {
      const balance = parseInt(data.result, 16) / 1e18;
      console.log(`✅ Balance for ${address}: ${balance.toFixed(8)} ACCESS`);
      return balance;
    }
  } catch (error) {
    console.error(`❌ Error getting balance for ${address}:`, error.message);
    return 0;
  }
}

async function testWalletRegistration(address) {
  console.log(`📝 Testing wallet registration for: ${address}`);

  try {
    const response = await fetch(TEST_CONFIG.rpcUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'access_registerExternalWallet',
        params: [{
          address: address,
          userAgent: 'Test-Script',
          chainId: TEST_CONFIG.chainId,
          timestamp: Date.now()
        }],
        id: 2
      })
    });

    const data = await response.json();
    if (data.result && data.result.success) {
      console.log(`✅ Wallet registered successfully: ${address}`);
      return true;
    }
  } catch (error) {
    console.error(`❌ Error registering wallet ${address}:`, error.message);
    return false;
  }
}

async function testNetworkInfo() {
  console.log('🌐 Testing network information...');

  try {
    const response = await fetch(TEST_CONFIG.rpcUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'access_getNetworkInfo',
        params: [],
        id: 3
      })
    });

    const data = await response.json();
    if (data.result) {
      console.log('✅ Network info:', data.result);
      return data.result;
    }
  } catch (error) {
    console.error('❌ Error getting network info:', error.message);
    return null;
  }
}

// Main test function
async function runAllTests() {
  console.log('🚀 Starting comprehensive external wallet tests...');
  console.log('='.repeat(50));

  // Test 1: Network connection
  const isConnected = await testNetworkConnection();
  if (!isConnected) {
    console.log('❌ Cannot proceed - network connection failed');
    return;
  }

  console.log(''); // Empty line for readability

  // Test 2: Network information
  await testNetworkInfo();

  console.log(''); // Empty line for readability

  // Test 3: Wallet balances
  console.log('💰 Testing wallet balances...');
  for (const address of TEST_ADDRESSES) {
    await testWalletBalance(address);
  }

  console.log(''); // Empty line for readability

  // Test 4: Wallet registration
  console.log('📝 Testing wallet registration...');
  for (const address of TEST_ADDRESSES) {
    await testWalletRegistration(address);
  }

  console.log(''); // Empty line for readability
  console.log('✅ All tests completed!');
  console.log('='.repeat(50));
}

// Run tests
runAllTests().catch(error => {
  console.error('❌ Test execution failed:', error);
});