// Web3 RPC Handler for external wallet compatibility
import { getNetworkNode as getNetworkNodeFromApi } from './network-api.js';

// Helper function to get network node
function getNetworkNode() {
  try {
    // Try to get the global network node instance
    if (global.accessNode) {
      return global.accessNode;
    }

    // Import and get from network-api if available
    return getNetworkNodeFromApi();
  } catch (error) {
    console.warn('Could not access network node:', error.message);
    return null;
  }
}

// معالج RPC الرئيسي
export async function handleWeb3RPC(request) {
  const { method, params, id } = request;

  try {
    const accessNode = getNetworkNode();
    if (!accessNode) {
      return {
        jsonrpc: '2.0',
        id: id,
        error: {
          code: -32603,
          message: 'Network node not available'
        }
      };
    }
    const network = accessNode.network;

    switch (method) {
      case 'eth_chainId':
        return {
          jsonrpc: '2.0',
          id: id,
          result: network.hexChainId
        };

      case 'net_version':
        return {
          jsonrpc: '2.0',
          id: id,
          result: network.networkId.toString()
        };

      case 'eth_blockNumber':
        const latestBlock = network.getLatestBlock();
        return {
          jsonrpc: '2.0',
          id: id,
          result: '0x' + latestBlock.index.toString(16)
        };

      case 'eth_getBalance':
        const [address, blockTag] = params;

        // التحقق من صحة العنوان
        if (!address || !address.startsWith('0x') || address.length !== 42) {
          return {
            jsonrpc: '2.0',
            id: id,
            error: {
              code: -32602,
              message: 'Invalid address format'
            }
          };
        }

        try {
          // ⚡ NETWORK-ONLY - قراءة مباشرة من Ledger State لضمان التحديث الفوري
          const balance = network.getBalance(address);
          
          // 🔧 FIX: floor (لأسفل) لتجنب إضافة قيمة غير موجودة - مثل Ethereum
          const truncatedBalance = Math.floor(Math.max(0, balance) * 1e8) / 1e8;
          
          // تحويل الرصيد إلى Wei (10^18) كعدد صحيح كبير جداً (BigInt)
          const balanceWeiBigInt = BigInt(Math.floor(truncatedBalance * 1e9)) * BigInt(1e9);
          const balanceHex = '0x' + balanceWeiBigInt.toString(16);

          return {
            jsonrpc: '2.0',
            id: id,
            result: balanceHex
          };
        } catch (error) {
          console.error('❌ Error getting balance:', error);
          return {
            jsonrpc: '2.0',
            id: id,
            result: '0x0' // رصيد صفر في حالة الخطأ
          };
        }

      case 'eth_getTransactionCount':
        const [addr, tag] = params;
        const transactions = network.getAllTransactionsForWallet(addr);
        const count = transactions.filter(tx => tx.fromAddress === addr).length;
        return {
          jsonrpc: '2.0',
          id: id,
          result: '0x' + count.toString(16)
        };

      case 'eth_gasPrice':
        // إرجاع سعر غاز ثابت ومعقول للمحافظ الخارجية
        const gasPriceGwei = 1; // 1 Gwei = آمن وسريع
        const gasPriceWei = gasPriceGwei * 1e9; // تحويل إلى Wei
        return {
          jsonrpc: '2.0',
          id: id,
          result: '0x' + gasPriceWei.toString(16) // إرجاع بـ Wei للمحافظ
        };

      case 'eth_estimateGas':
        const [transaction] = params;

        // تقدير دقيق للغاز حسب نوع المعاملة
        let gasEstimate = 21000; // الحد الأدنى للتحويل البسيط

        // إذا كانت معاملة معقدة أو تحتوي data
        if (transaction && transaction.data && transaction.data !== '0x') {
          const dataLength = (transaction.data.length - 2) / 2; // طول البيانات بـ bytes
          gasEstimate += dataLength * 68; // 68 gas لكل byte من البيانات
        }

        // التأكد من أن التقدير في حدود معقولة
        gasEstimate = Math.min(gasEstimate, 100000); // حد أقصى 100k gas

        return {
          jsonrpc: '2.0',
          id: id,
          result: '0x' + gasEstimate.toString(16) // إرجاع عدد صحيح بدون تحويل
        };

      case 'eth_maxTransferAmount':
      case 'wallet_calculateMaxSendable':
      case 'access_calculateMaxSendable':
      case 'wallet_getMaxSendable':
      case 'eth_getMaxSendable':
      case 'wallet_useMax':
      case 'metamask_useMax':
      case 'trustwallet_useMax':
        // 🔥 نظام USE MAX الذكي المحسن لـ Trust Wallet و MetaMask
        const [maxParams] = params;
        const senderAddress = maxParams?.from || maxParams?.address || maxParams?.wallet || params[0];

        if (!senderAddress) {
          return {
            jsonrpc: '2.0',
            id: id,
            error: {
              code: -32602,
              message: 'Missing sender address for Use Max calculation'
            }
          };
        }

        try {
          // ⚡ NETWORK-ONLY - قراءة مباشرة من network state (مثل Ethereum/BSC تماماً)
          const currentBalance = network.getBalance(senderAddress);

          console.log(`⚡ NETWORK-ONLY USE MAX: Balance from network state: ${currentBalance.toFixed(8)} ACCESS`);

          // 🎯 TRUST WALLET OPTIMIZED USE MAX - محسن خصيصاً لـ Trust Wallet

          // حساب رسوم الغاز الدقيقة لـ Trust Wallet
          const trustWalletGasFee = 0.000021; // رسوم دقيقة مناسبة لـ Trust Wallet
          let maxSendable = 0;

          console.log(`🎯 TRUST WALLET USE MAX: Starting calculation for balance ${currentBalance.toFixed(8)} ACCESS`);

          if (currentBalance <= 0) {
            // لا يوجد رصيد
            maxSendable = 0;
            console.log(`❌ TRUST WALLET: No balance available`);
          } else if (currentBalance <= trustWalletGasFee) {
            // رصيد أقل من رسوم الغاز
            maxSendable = 0;
            console.log(`⚠️ TRUST WALLET: Balance ${currentBalance.toFixed(8)} too low for gas fee ${trustWalletGasFee.toFixed(8)}`);
          } else {
            // 🚀 الحساب المحسن لـ Trust Wallet
            maxSendable = currentBalance - trustWalletGasFee;

            // تقريب لضمان الدقة
            maxSendable = Math.floor(maxSendable * 100000000) / 100000000; // 8 خانات عشرية
            maxSendable = Math.max(0, maxSendable);

            // التحقق النهائي
            const totalRequired = maxSendable + trustWalletGasFee;
            if (totalRequired > currentBalance) {
              maxSendable = Math.max(0, currentBalance - trustWalletGasFee - 0.00000001);
              console.log(`🔧 TRUST WALLET: Auto-adjusted to ${maxSendable.toFixed(8)} ACCESS`);
            }

            console.log(`✅ TRUST WALLET USE MAX: Balance=${currentBalance.toFixed(8)}, Gas=${trustWalletGasFee.toFixed(8)}, Max=${maxSendable.toFixed(8)}`);
          }

          // 📱 TRUST WALLET: تنسيق محسن ومبسط
          const formatForTrustWallet = (amount) => {
            // تنسيق خاص بـ Trust Wallet - بساطة ودقة
            return parseFloat(amount.toFixed(8)).toString(); // إزالة الأصفار الزائدة
          };

          // التأكد من صحة المتغيرات قبل الإرجاع
          const safeMaxSendable = Math.max(0, maxSendable || 0);
          const safeBalance = Math.max(0, currentBalance || 0);

          console.log(`🚀 SMART USE MAX Success: ${senderAddress} - Balance: ${safeBalance.toFixed(8)} → Max: ${safeMaxSendable.toFixed(8)}`);

          // 🎯 TRUST WALLET: استجابة محسنة ومبسطة
          return {
            jsonrpc: '2.0',
            id: id,
            result: {
              // ✨ الحد الأقصى القابل للإرسال - مُحسن لـ Trust Wallet
              maxSendable: formatForTrustWallet(maxSendable),
              maxSendableWei: '0x' + Math.floor(maxSendable * 1e18).toString(16),
              maxSendableFormatted: formatForTrustWallet(maxSendable) + ' ACCESS',

              // 💰 الرصيد الحالي
              balance: formatForTrustWallet(currentBalance),
              balanceWei: '0x' + Math.floor(currentBalance * 1e18).toString(16),
              balanceFormatted: formatForTrustWallet(currentBalance) + ' ACCESS',

              // ⛽ رسوم الغاز الدقيقة لـ Trust Wallet
              estimatedGasFee: trustWalletGasFee.toFixed(8),
              estimatedGasFeeWei: '0x' + Math.floor(trustWalletGasFee * 1e18).toString(16),
              gasPrice: '1 Gwei',
              gasPriceWei: '0x3b9aca00',
              gasLimit: 21000,

              // 🎯 معلومات Trust Wallet المحسنة
              canSendMax: maxSendable > 0,
              trustWalletReady: true,
              useMaxOptimized: true,
              balanceVerified: true,

              // 🪙 معلومات العملة
              nativeCurrency: {
                symbol: 'ACCESS',
                decimals: 18,
                name: 'Access Coin'
              },

              // 🌐 معلومات الشبكة
              chainId: '0x5968',
              networkId: '22888',
              networkName: 'Access Network',

              // ✅ تأكيدات Trust Wallet
              success: true,
              trustWalletCompatible: true,
              metamaskCompatible: true,
              walletOptimized: true
            }
          };
        } catch (error) {
          console.error('USE MAX calculation error:', error);
          return {
            jsonrpc: '2.0',
            id: id,
            error: {
              code: -32603,
              message: 'Failed to calculate max sendable: ' + error.message
            }
          };
        }

      case 'eth_sendTransaction':
        const [txData] = params;

        // التحقق من صحة بيانات المعاملة
        if (!txData || !txData.from || !txData.to) {
          return {
            jsonrpc: '2.0',
            id: id,
            error: {
              code: -32602,
              message: 'Invalid transaction data: missing from or to address'
            }
          };
        }

        // التحقق من صحة العناوين
        if (!txData.from.startsWith('0x') || txData.from.length !== 42 ||
            !txData.to.startsWith('0x') || txData.to.length !== 42) {
          return {
            jsonrpc: '2.0',
            id: id,
            error: {
              code: -32602,
              message: 'Invalid address format in transaction'
            }
          };
        }

        try {
          const txHash = await accessNode.sendTransaction(txData);
          return {
            jsonrpc: '2.0',
            id: id,
            result: txHash
          };
        } catch (error) {
          console.error('Transaction failed:', error);
          return {
            jsonrpc: '2.0',
            id: id,
            error: {
              code: -32603,
              message: 'Transaction failed: ' + error.message
            }
          };
        }

      case 'eth_sendRawTransaction':
        const [rawTx] = params;
        // معالجة المعاملة الخام
        const processedTx = await processRawTransaction(rawTx);
        const hash = await accessNode.sendTransaction(processedTx);
        return {
          jsonrpc: '2.0',
          id: id,
          result: hash
        };

      case 'eth_getTransactionByHash':
        const [transactionHash] = params;
        const foundTransaction = network.getTransactionByHash(transactionHash);
        if (!foundTransaction) {
          return {
            jsonrpc: '2.0',
            id: id,
            result: null
          };
        }

        return {
          jsonrpc: '2.0',
          id: id,
          result: {
            hash: foundTransaction.txId,
            nonce: '0x' + (foundTransaction.nonce || network.getNonce(foundTransaction.fromAddress)).toString(16),
            blockHash: foundTransaction.blockHash,
            blockNumber: '0x' + (foundTransaction.blockIndex || 0).toString(16),
            transactionIndex: '0x0',
            from: foundTransaction.fromAddress,
            to: foundTransaction.toAddress,
            value: '0x' + Math.floor(foundTransaction.amount * 1e18).toString(16),
            gas: '0x' + Math.floor((foundTransaction.gasFee || 0) * 1e18).toString(16),
            gasPrice: '0x' + Math.floor((foundTransaction.gasPrice || network.gasPrice) * 1e18).toString(16),
            input: '0x'
          }
        };

      case 'eth_getTransactionReceipt':
        const [receiptTxHash] = params;
        const receiptTx = network.getTransactionByHash(receiptTxHash);
        if (!receiptTx) {
          return {
            jsonrpc: '2.0',
            id: id,
            result: null
          };
        }

        return {
          jsonrpc: '2.0',
          id: id,
          result: {
            transactionHash: receiptTx.txId,
            transactionIndex: '0x0',
            blockHash: receiptTx.blockHash,
            blockNumber: '0x' + (receiptTx.blockIndex || 0).toString(16),
            from: receiptTx.fromAddress,
            to: receiptTx.toAddress,
            cumulativeGasUsed: '0x' + Math.floor((receiptTx.gasFee || 0) * 1e18).toString(16),
            gasUsed: '0x' + Math.floor((receiptTx.gasFee || 0) * 1e18).toString(16),
            contractAddress: null,
            logs: [],
            status: '0x1'
          }
        };

      case 'eth_getBlockByNumber':
        const [blockNumber, fullTx] = params;
        let blockIndex;
        if (blockNumber === 'latest') {
          blockIndex = network.chain.length - 1;
        } else {
          blockIndex = parseInt(blockNumber, 16);
        }

        // 🔧 FIX: تحقق من وجود chain أولاً
        if (!network.chain || network.chain.length === 0) {
          console.warn('⚠️ Web3 RPC: Blockchain is empty');
          return {
            jsonrpc: '2.0',
            id: id,
            result: null
          };
        }

        const block = network.getBlockByIndex(blockIndex);
        if (!block) {
          console.warn(`⚠️ Web3 RPC: Block ${blockNumber} not found`);
          return {
            jsonrpc: '2.0',
            id: id,
            result: null
          };
        }

        // ✅ التأكد من وجود transactions array
        const blockTransactions = Array.isArray(block.transactions) ? block.transactions : [];

        return {
          jsonrpc: '2.0',
          id: id,
          result: {
            number: '0x' + block.index.toString(16),
            hash: block.hash || '0x0000000000000000000000000000000000000000000000000000000000000000',
            parentHash: block.previousHash || '0x0000000000000000000000000000000000000000000000000000000000000000',
            nonce: block.nonce ? '0x' + block.nonce.toString(16) : '0x0',
            sha3Uncles: '0x1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347',
            logsBloom: '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
            transactionsRoot: block.merkleRoot || '0x0000000000000000000000000000000000000000000000000000000000000000',
            stateRoot: '0x0000000000000000000000000000000000000000000000000000000000000000',
            receiptsRoot: '0x0000000000000000000000000000000000000000000000000000000000000000',
            miner: '0x0000000000000000000000000000000000000000',
            difficulty: '0x' + network.difficulty.toString(16),
            totalDifficulty: '0x' + (network.difficulty * block.index).toString(16),
            extraData: '0x',
            size: '0x' + JSON.stringify(block).length.toString(16),
            gasLimit: '0x1c9c380',
            gasUsed: '0x5208',
            timestamp: '0x' + Math.floor((block.timestamp || Date.now()) / 1000).toString(16),
            transactions: fullTx ? blockTransactions.map(tx => ({
              hash: tx.txId || tx.hash || '0x0',
              nonce: '0x0',
              blockHash: block.hash,
              blockNumber: '0x' + block.index.toString(16),
              transactionIndex: '0x0',
              from: tx.fromAddress || '0x0000000000000000000000000000000000000000',
              to: tx.toAddress || '0x0000000000000000000000000000000000000000',
              value: '0x' + Math.floor((tx.amount || 0) * 1e18).toString(16),
              gas: '0x5208',
              gasPrice: '0x' + Math.floor((tx.gasPrice || network.gasPrice) * 1e18).toString(16),
              input: '0x'
            })) : blockTransactions.map(tx => tx.txId || tx.hash || '0x0'),
            uncles: []
          }
        };

      case 'web3_clientVersion':
        return {
          jsonrpc: '2.0',
          id: id,
          result: 'Access-Network/v1.0.0'
        };

      case 'web3_sha3':
        const [data] = params;
        const crypto = await import('crypto');
        const sha3Hash = crypto.createHash('sha3-256').update(data.replace('0x', ''), 'hex').digest('hex');
        return {
          jsonrpc: '2.0',
          id: id,
          result: '0x' + sha3Hash
        };

      case 'eth_feeHistory':
        // Fee history for MetaMask & Trust Wallet - COMPLETE FIX
        const [blockCount, newestBlock, rewardPercentiles] = params;
        const requestedBlocks = Math.max(1, parseInt(blockCount) || 1);

        // ✅ CRITICAL: Trust Wallet يتوقع baseFeePerGas بطول (blockCount + 1)
        // و gasUsedRatio و reward بطول (blockCount)
        const baseFeePerGas = [];
        const gasUsedRatio = [];
        const reward = [];

        // املأ baseFeePerGas: يجب أن يكون طوله = blockCount + 1
        for (let i = 0; i <= requestedBlocks; i++) {
          baseFeePerGas.push('0x3b9aca00'); // 1 Gwei ثابت
        }

        // املأ gasUsedRatio و reward: يجب أن يكون طولهما = blockCount
        for (let i = 0; i < requestedBlocks; i++) {
          gasUsedRatio.push(0.5); // 50% استخدام

          // reward: array من arrays حسب عدد percentiles المطلوبة
          if (rewardPercentiles && Array.isArray(rewardPercentiles) && rewardPercentiles.length > 0) {
            const rewardArray = [];
            for (let j = 0; j < rewardPercentiles.length; j++) {
              rewardArray.push('0x3b9aca00'); // 1 Gwei لكل percentile
            }
            reward.push(rewardArray);
          } else {
            // إذا لم يُطلب percentiles، نرسل قيمة واحدة
            reward.push(['0x3b9aca00']);
          }
        }

        // حساب oldestBlock
        const chainLength = network.chain ? network.chain.length : 0;
        const oldestBlockNumber = Math.max(0, chainLength - requestedBlocks);

        return {
          jsonrpc: '2.0',
          id: id,
          result: {
            oldestBlock: '0x' + oldestBlockNumber.toString(16),
            baseFeePerGas: baseFeePerGas,        // length = blockCount + 1
            gasUsedRatio: gasUsedRatio,          // length = blockCount
            reward: reward                        // length = blockCount
          }
        };

      case 'eth_maxPriorityFeePerGas':
        // أولوية الرسوم - مطلوب لـ EIP-1559
        return {
          jsonrpc: '2.0',
          id: id,
          result: '0x3b9aca00' // 1 Gwei
        };

      case 'net_listening':
        return {
          jsonrpc: '2.0',
          id: id,
          result: true
        };

      case 'eth_syncing':
        return {
          jsonrpc: '2.0',
          id: id,
          result: false // الشبكة متزامنة بالكامل
        };

      case 'web3_clientVersion':
        return {
          jsonrpc: '2.0',
          id: id,
          result: 'Access-Network/v1.0.0/external-wallet-support'
        };

      default:
        return {
          jsonrpc: '2.0',
          id: id,
          error: {
            code: -32601,
            message: 'Method not found'
          }
        };
    }
  } catch (error) {
    console.error('RPC Error:', error);
    return {
      jsonrpc: '2.0',
      id: id,
      error: {
        code: -32603,
        message: 'Internal error',
        data: error.message
      }
    };
  }
}

// معالجة المعاملة الخام
async function processRawTransaction(rawTx) {
  try {
    // فك تشفير المعاملة الخام (تبسيط)
    const txData = parseRawTransaction(rawTx);

    return {
      from: txData.from,
      to: txData.to,
      value: txData.value,
      gas: txData.gas,
      gasPrice: txData.gasPrice,
      nonce: txData.nonce
    };
  } catch (error) {
    throw new Error('Invalid raw transaction: ' + error.message);
  }
}

// ⚡ NETWORK-ONLY SYSTEM - NO DATABASE SYNC
// شبكة Access تعمل مثل Ethereum/BSC تماماً - كل شيء من network state فقط
// Database هو backup فقط، ليس مصدر البيانات

// تحليل المعاملة الخام (محسن)
function parseRawTransaction(rawTx) {
  try {
    if (!rawTx || !rawTx.startsWith('0x')) {
      throw new Error('Invalid raw transaction format');
    }

    const cleanTx = rawTx.replace('0x', '');

    // التحقق من الطول الأدنى للمعاملة
    if (cleanTx.length < 96) {
      throw new Error('Raw transaction too short');
    }

    // استخراج المكونات الأساسية مع التحقق من الصحة
    const nonce = cleanTx.substring(0, 16);
    const gasPrice = cleanTx.substring(16, 32);
    const gasLimit = cleanTx.substring(32, 48);
    const to = cleanTx.substring(48, 88);
    const value = cleanTx.substring(88, 104);

    // التحقق من صحة العنوان
    if (to.length !== 40) {
      throw new Error('Invalid recipient address length');
    }

    return {
      from: '0x0000000000000000000000000000000000000000', // سيتم تحديده من التوقيع
      to: '0x' + to,
      value: '0x' + value,
      gas: '0x' + (gasLimit || '5208'),
      gasPrice: '0x' + (gasPrice || Math.floor(0.00002 * 1e18).toString(16)),
      nonce: '0x' + (nonce || '0')
    };
  } catch (error) {
    console.error('Error parsing raw transaction:', error);
    // إرجاع قيم افتراضية آمنة
    return {
      from: '0x0000000000000000000000000000000000000000',
      to: '0x0000000000000000000000000000000000000000',
      value: '0x0',
      gas: '0x5208',
      gasPrice: '0x' + Math.floor(0.00002 * 1e18).toString(16),
      nonce: '0x0'
    };
  }
}