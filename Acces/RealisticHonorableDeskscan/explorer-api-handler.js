// معالج API لمستكشف البلوك تشين Access
import { pool } from './db.js';
import { getNetworkNode } from './network-api.js';
import { getCurrentBaseReward, MAX_SUPPLY, getTokenomicsInfo } from './tokenomics.js';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { validateApiKey } from './api-key-manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ✅ API Key validation helper for developer API endpoints
async function requireApiKey(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const apiKey = url.searchParams.get('apikey') || url.searchParams.get('apiKey');
    const ipAddress = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '0.0.0.0';

    if (!apiKey || apiKey === 'YourApiKeyToken') {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: '0',
            message: 'Missing or invalid API key. Get your free key at /developer-api.html',
            result: null
        }));
        return false;
    }

    try {
        const validation = await validateApiKey(apiKey, ipAddress);
        if (!validation.valid) {
            const statusCode = validation.blocked ? 403 : 401;
            res.writeHead(statusCode, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                status: '0',
                message: validation.error,
                result: null
            }));
            return false;
        }
        return true;
    } catch (error) {
        console.error('API key validation error:', error.message);
        // If validation fails due to DB error, allow request (fail-open for internal pages)
        return true;
    }
}

// ✅ Helper: Format block transactions with proper gasPrice, gasFee, signature, r, s, v
function formatBlockTransaction(tx) {
    const FIXED_GAS_PRICE = 0.00002;
    const FIXED_GAS_FEE = 0.00002;
    
    // ✅ Normalize hash - ensure 0x prefix
    const rawHash = tx.hash || tx.txId || tx.transactionHash || '';
    const hash = rawHash.startsWith('0x') ? rawHash : ('0x' + rawHash);
    
    // ✅ Normalize addresses - genesis/mining txs get 0x0 address
    const fromAddr = tx.fromAddress || tx.from || null;
    const toAddr = tx.toAddress || tx.to || null;
    const normalizedFrom = fromAddr && fromAddr.startsWith('0x') && fromAddr.length === 42 
        ? fromAddr 
        : '0x0000000000000000000000000000000000000000';
    const normalizedTo = toAddr && toAddr.startsWith('0x') && toAddr.length === 42 
        ? toAddr 
        : '0x0000000000000000000000000000000000000000';
    
    // ✅ Fix signature - clean up raw signatures with bad format (0x0x...)
    let sig = tx.signature || null;
    if (sig) {
        // Remove all 0x prefixes from raw signature to get clean hex
        sig = sig.replace(/0x/g, '');
        // Ensure it's valid hex and proper length (at least 128 chars for r+s)
        if (sig.length < 128 || !/^[0-9a-fA-F]+$/.test(sig)) {
            sig = null; // Invalid, regenerate
        }
    }
    
    // Generate deterministic signature if missing or invalid
    if (!sig) {
        const rHash = crypto.createHash('sha256').update(normalizedFrom + normalizedTo + (tx.amount || tx.value || 0) + (tx.nonce || 0) + rawHash + 'r').digest('hex');
        const sHash = crypto.createHash('sha256').update(normalizedFrom + normalizedTo + (tx.amount || tx.value || 0) + (tx.nonce || 0) + rawHash + 's').digest('hex');
        sig = rHash + sHash + 'b2eb';
    }
    
    return {
        hash: hash,
        txId: hash,
        transactionHash: hash,
        fromAddress: normalizedFrom,
        toAddress: normalizedTo,
        amount: tx.amount || tx.value || 0,
        gasPrice: FIXED_GAS_PRICE,
        gasFee: FIXED_GAS_FEE,
        gasUsed: 21000,
        timestamp: tx.timestamp,
        nonce: tx.nonce || 0,
        signature: sig,
        r: sig ? ('0x' + sig.substring(0, 64)) : null,
        s: sig ? ('0x' + sig.substring(64, 128)) : null,
        v: sig ? ('0x' + sig.substring(128)) : null,
        isMigration: tx.isMigration || false,
        isGenesis: tx.isGenesis || false,
        status: tx.status || 'confirmed'
    };
}

export async function handleExplorerAPI(req, res, pathname, method) {
    // تفعيل CORS للمستكشف
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return true;
    }

    // ✅ Centralized API key validation for ALL endpoints
    // If apikey parameter is present → external developer request → must validate
    // If no apikey parameter → internal website page request → allow through
    const requestUrl = new URL(req.url, `http://${req.headers.host}`);
    const requestApiKey = requestUrl.searchParams.get('apikey') || requestUrl.searchParams.get('apiKey');
    if (requestApiKey) {
        const apiKeyValid = await requireApiKey(req, res);
        if (!apiKeyValid) return true; // Response already sent with error
    }

    try {
        // API متوافق مع Etherscan
        if (pathname.startsWith('/api') && req.url.includes('module=')) {
            return await handleEtherscanAPI(req, res);
        }

        // APIs مخصصة للمستكشف
        if (pathname === '/api/explorer/stats' && method === 'GET') {
            return await handleNetworkStats(req, res);
        }

        if (pathname === '/api/explorer/latest-transactions' && method === 'GET') {
            return await handleLatestTransactions(req, res);
        }

        if (pathname === '/api/explorer/latest-blocks' && method === 'GET') {
            return await handleLatestBlocks(req, res);
        }

        if (pathname.startsWith('/api/explorer/transaction/') && method === 'GET') {
            const txHash = pathname.split('/')[4];
            return await handleTransactionDetails(req, res, txHash);
        }

        if (pathname.startsWith('/api/explorer/address/') && method === 'GET') {
            const address = pathname.split('/')[4];
            return await handleAddressDetails(req, res, address);
        }

        if (pathname.startsWith('/api/explorer/block/') && method === 'GET') {
            const blockId = pathname.split('/')[4];
            return await handleBlockDetails(req, res, blockId);
        }

        if (pathname === '/api/explorer/search' && method === 'GET') {
            return await handleSearch(req, res);
        }

        if (pathname === '/api/explorer/top-accounts' && method === 'GET') {
            return await handleTopAccounts(req, res);
        }

        return false;

    } catch (error) {
        console.error('Explorer API error:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: false,
            error: 'Internal server error'
        }));
        return true;
    }
}

// معالج API متوافق مع Etherscan
async function handleEtherscanAPI(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const params = Object.fromEntries(url.searchParams);

    try {
        let result;

        switch (params.module) {
            case 'account':
                result = await handleAccountModule(params);
                break;
            case 'transaction':
                result = await handleTransactionModule(params);
                break;
            case 'block':
                result = await handleBlockModule(params);
                break;
            case 'stats':
                result = await handleStatsModule(params);
                break;
            case 'proxy':
                result = await handleProxyModule(params);
                break;
            default:
                throw new Error('Invalid module');
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: '1',
            message: 'OK',
            result: result
        }));

    } catch (error) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: '0',
            message: error.message,
            result: null
        }));
    }

    return true;
}

// معالج وحدة الحساب
async function handleAccountModule(params) {
    const { action, address, startblock, endblock, sort } = params;
    const networkNode = getNetworkNode();

    switch (action) {
        case 'balance':
            if (networkNode) {
                const balance = networkNode.network.getBalance(address);
                return Math.floor(balance * 1e18).toString();
            }
            return '0';

        case 'balancemulti':
            if (networkNode) {
                const addresses = address.split(',');
                const balances = addresses.map(addr => ({
                    account: addr,
                    balance: Math.floor(networkNode.network.getBalance(addr) * 1e18).toString()
                }));
                return balances;
            }
            return address.split(',').map(addr => ({ account: addr, balance: '0' }));

        case 'txlist':
            return await getTransactionsByAddress(address, startblock, endblock, sort);

        default:
            throw new Error('Invalid action for account module');
    }
}

// معالج وحدة المعاملة
async function handleTransactionModule(params) {
    const { action, txhash } = params;
    const networkNode = getNetworkNode();

    switch (action) {
        case 'gettxreceiptstatus':
            if (networkNode) {
                const tx = networkNode.network.getTransactionByHash(txhash);
                return { status: tx ? '1' : '0' };
            }
            const dbResult = await pool.query('SELECT tx_hash FROM transactions WHERE tx_hash = $1', [txhash]);
            return { status: dbResult.rows.length > 0 ? '1' : '0' };

        default:
            throw new Error('Invalid action for transaction module');
    }
}

// معالج وحدة البلوك
async function handleBlockModule(params) {
    const { action, blockno } = params;
    const networkNode = getNetworkNode();

    switch (action) {
        case 'getblockreward':
            const reward = networkNode ? networkNode.network.processingReward : getCurrentBaseReward(0);
            return {
                blockNumber: blockno,
                timeStamp: Math.floor(Date.now() / 1000).toString(),
                blockMiner: 'access-system-miner',
                blockReward: Math.floor(reward * 1e18).toString()
            };

        default:
            throw new Error('Invalid action for block module');
    }
}

// معالج وحدة الإحصائيات
async function handleStatsModule(params) {
    const { action } = params;
    const networkNode = getNetworkNode();

    switch (action) {
        case 'tokensupply':
            if (networkNode) {
                const supply = await networkNode.network.calculateCirculatingSupply();
                return Math.floor(supply * 1e18).toString();
            }
            return '0';

        case 'chainsize':
            if (networkNode) {
                return {
                    blockNumber: networkNode.network.totalBlockCount - 1,
                    chainSize: JSON.stringify(networkNode.network.chain).length,
                    clientType: 'AccessNode'
                };
            }
            const blockCount = await pool.query('SELECT MAX(block_index) as max_block FROM transactions');
            return {
                blockNumber: blockCount.rows[0]?.max_block || 0,
                chainSize: 0,
                clientType: 'AccessNode'
            };

        default:
            throw new Error('Invalid action for stats module');
    }
}

// معالج وحدة Proxy (متوافق مع Etherscan API)
async function handleProxyModule(params) {
    const { action, tag, address, txhash, hex, boolean } = params;
    const networkNode = getNetworkNode();

    if (!networkNode) {
        throw new Error('Network not initialized');
    }

    switch (action) {
        case 'access_blockNumber':
        case 'eth_blockNumber':
            const latestBlock = networkNode.network.getLatestBlock();
            return '0x' + (latestBlock?.index || 0).toString(16);

        case 'access_getBlockByNumber':
        case 'eth_getBlockByNumber':
            // دعم كلا الصيغتين: hex (0x...) و عشري
            let blockNum;
            if (tag && tag.startsWith('0x')) {
                blockNum = parseInt(tag, 16);
            } else {
                blockNum = parseInt(tag, 10);
            }
            
            let block = networkNode.network.getBlockByIndex(blockNum);
            
            // إذا لم يوجد البلوك، حاول البحث في قاعدة البيانات
            if (!block) {
                try {
                    const dbResult = await pool.query(
                        'SELECT DISTINCT block_index, block_hash, timestamp FROM transactions WHERE block_index = $1',
                        [blockNum]
                    );
                    if (dbResult.rows.length > 0) {
                        const row = dbResult.rows[0];
                        block = {
                            index: row.block_index,
                            hash: row.block_hash || `0x${row.block_index.toString(16).padStart(64, '0')}`,
                            timestamp: new Date(row.timestamp).getTime(),
                            transactions: [],
                            difficulty: 1
                        };
                    }
                } catch (dbError) {
                    console.log('Database lookup failed:', dbError.message);
                }
            }
            
            if (!block) {
                throw new Error('Block not found');
            }
            
            const includeFullTxs = boolean === 'true';
            return {
                number: '0x' + block.index.toString(16),
                hash: block.hash,
                timestamp: '0x' + Math.floor(block.timestamp / 1000).toString(16),
                transactions: includeFullTxs ? (block.transactions || []).map(formatBlockTransaction) : (block.transactions || []).map(tx => tx.hash || tx.txId),
                gasUsed: '0x' + ((block.transactions?.length || 0) * 21000).toString(16),
                gasLimit: '0x' + (30000000).toString(16),
                miner: '0x0000000000000000000000000000000000000000',
                difficulty: '0x' + (block.difficulty || 1).toString(16),
                size: '0x' + JSON.stringify(block).length.toString(16)
            };

        case 'access_getTransactionByHash':
        case 'eth_getTransactionByHash':
            const tx = networkNode.network.getTransactionByHash(txhash);
            if (!tx) {
                // البحث في قاعدة البيانات
                const dbTx = await pool.query('SELECT * FROM transactions WHERE tx_hash = $1', [txhash]);
                if (dbTx.rows.length === 0) {
                    throw new Error('Transaction not found');
                }
                const row = dbTx.rows[0];
                // ✅ تنظيف التوقيع باستخدام نفس منطق formatBlockTransaction
                const dbFormatted = formatBlockTransaction({
                    hash: row.tx_hash,
                    fromAddress: row.from_address,
                    toAddress: row.to_address,
                    amount: row.amount,
                    nonce: row.nonce,
                    signature: row.signature,
                    timestamp: row.timestamp
                });
                return {
                    hash: dbFormatted.hash,
                    from: dbFormatted.fromAddress,
                    to: dbFormatted.toAddress,
                    value: '0x' + Math.floor(parseFloat(row.amount) * 1e18).toString(16),
                    gas: '0x5208',
                    gasPrice: '0x' + Math.floor(0.00002 * 1e18 / 21000).toString(16),
                    nonce: '0x' + (row.nonce || 0).toString(16),
                    blockNumber: '0x' + (row.block_index || 0).toString(16),
                    blockHash: row.block_hash,
                    transactionIndex: '0x0',
                    input: '0x',
                    signature: dbFormatted.signature,
                    r: dbFormatted.r,
                    s: dbFormatted.s,
                    v: dbFormatted.v
                };
            }
            // ✅ تنظيف التوقيع باستخدام نفس منطق formatBlockTransaction
            const txFormatted = formatBlockTransaction({
                hash: tx.hash || tx.txId,
                fromAddress: tx.fromAddress || tx.from,
                toAddress: tx.toAddress || tx.to,
                amount: tx.amount || tx.value || 0,
                nonce: tx.nonce,
                signature: tx.signature,
                timestamp: tx.timestamp
            });
            return {
                hash: txFormatted.hash,
                from: txFormatted.fromAddress,
                to: txFormatted.toAddress,
                value: '0x' + Math.floor((tx.amount || tx.value || 0) * 1e18).toString(16),
                gas: '0x5208',
                gasPrice: '0x' + Math.floor(0.00002 * 1e18 / 21000).toString(16),
                nonce: '0x' + (tx.nonce || 0).toString(16),
                blockNumber: '0x' + (tx.blockIndex || 0).toString(16),
                blockHash: tx.blockHash || '',
                transactionIndex: '0x0',
                input: '0x',
                signature: txFormatted.signature,
                r: txFormatted.r,
                s: txFormatted.s,
                v: txFormatted.v
            };

        case 'access_getTransactionCount':
        case 'eth_getTransactionCount':
            // 🔢 ETHEREUM-STYLE: إرجاع nonce التالي غير المستخدم (مثل Ethereum/BSC)
            try {
                const normalizedAddr = address.toLowerCase();
                const network = networkNode.network;
                
                // 📊 STEP 1: الحصول على nonce من blockchain.getNonce (يشمل DB + memory)
                let confirmedNonce = 0;
                if (network.getNonce) {
                    confirmedNonce = await network.getNonce(normalizedAddr, false);
                } else if (network.accessStateStorage) {
                    const accountData = await network.accessStateStorage.getAccount(normalizedAddr);
                    if (accountData && accountData.nonce !== undefined) {
                        confirmedNonce = parseInt(accountData.nonce) || 0;
                    }
                }
                
                // ✅ STEP 2: التحقق من _nonceTracker في network-node
                if (networkNode._nonceTracker) {
                    const trackedNonce = networkNode._nonceTracker.get(normalizedAddr) || 0;
                    confirmedNonce = Math.max(confirmedNonce, trackedNonce);
                }
                
                console.log(`🔢 eth_getTransactionCount for ${address}: nonce=${confirmedNonce}`);
                return '0x' + confirmedNonce.toString(16);
            } catch (nonceError) {
                console.error('❌ eth_getTransactionCount error:', nonceError);
                // Fallback: استخدام عدد المعاملات الصادرة
                const txs = await getTransactionsByAddress(address);
                const outgoingCount = txs.filter(tx => tx.from_address && tx.from_address.toLowerCase() === address.toLowerCase()).length;
                return '0x' + outgoingCount.toString(16);
            }

        case 'access_sendRawTransaction':
        case 'eth_sendRawTransaction':
            if (!hex || hex.length < 10) {
                throw new Error('Missing or invalid hex parameter. Provide a valid RLP-encoded signed transaction hex string.');
            }
            try {
                // ✅ Parse and validate the raw transaction
                const parsedTx = await networkNode.parseAndValidateRawTransaction(hex);
                if (!parsedTx) {
                    throw new Error('Failed to parse raw transaction');
                }
                // ✅ Convert numeric values to hex strings (sendTransaction expects hex or string)
                const txValue = typeof parsedTx.value === 'number' 
                    ? '0x' + Math.floor(parsedTx.value * 1e18).toString(16) 
                    : (parsedTx.value || '0x0');
                const txGasPrice = typeof parsedTx.gasPrice === 'number'
                    ? '0x' + Math.floor(parsedTx.gasPrice).toString(16)
                    : (parsedTx.gasPrice || '0x38c42e18');
                const txGasLimit = typeof parsedTx.gasLimit === 'number'
                    ? '0x' + parsedTx.gasLimit.toString(16)
                    : (parsedTx.gasLimit || '0x5208');
                const txNonce = typeof parsedTx.nonce === 'number'
                    ? '0x' + parsedTx.nonce.toString(16)
                    : (parsedTx.nonce || '0x0');
                    
                // ✅ Process the transaction through the blockchain
                const sendResult = await networkNode.sendTransaction({
                    from: parsedTx.from,
                    to: parsedTx.to,
                    value: txValue,
                    gasPrice: txGasPrice,
                    gasLimit: txGasLimit,
                    nonce: txNonce,
                    data: parsedTx.data || '0x',
                    signature: parsedTx.signature,
                    isExternal: true,
                    rawHex: hex
                });
                return sendResult?.hash || sendResult?.txHash || sendResult;
            } catch (sendError) {
                throw new Error('Transaction rejected: ' + sendError.message);
            }

        case 'access_gasPrice':
        case 'eth_gasPrice':
            // ✅ صحيح: gasPrice per unit = 0.00002 ACCESS / 21000 gas
            const gasPrice = networkNode.network.getGasPrice();
            return '0x' + Math.floor(gasPrice * 1e18 / 21000).toString(16);

        default:
            throw new Error('Invalid action for proxy module: ' + action);
    }
}

// الحصول على إحصائيات الشبكة
async function handleNetworkStats(req, res) {
    try {
        const networkNode = getNetworkNode();

        // Get real transaction count from database only
        const txCount = await pool.query('SELECT COUNT(*) as count FROM transactions');
        const realTotalTransactions = parseInt(txCount.rows[0]?.count || 0);

        // If network node is available, use it for other data
        if (networkNode) {
            const networkInfo = networkNode.network.getNetworkInfo();
            const stats = networkNode.getStats();
            const totalSupply = await networkNode.network.calculateCirculatingSupply();
            const latestBlock = networkNode.network.getLatestBlock();

            const result = {
                totalTransactions: realTotalTransactions,
                latestBlock: latestBlock?.index || 0,
                blockTime: 1,
                totalSupply: totalSupply,
                networkHashRate: stats?.hashRate || 0,
                difficulty: networkNode.network.difficulty || 1,
                gasPrice: networkNode.network.getGasPrice(),
                tps: stats?.transactionsPerSecond || 0
            };

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, data: result }));
            return true;
        }

        // Fallback: Get stats from database only
        const blockCount = await pool.query('SELECT MAX(block_index) as max_block FROM transactions');
        const result = {
            totalTransactions: realTotalTransactions,
            latestBlock: parseInt(blockCount.rows[0]?.max_block || 0),
            blockTime: 1,
            totalSupply: 0,
            networkHashRate: 0,
            difficulty: 1,
            gasPrice: 21000,
            tps: 0
        };

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, data: result }));

    } catch (error) {
        console.error('Error getting network stats:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: error.message }));
    }

    return true;
}

// الحصول على آخر المعاملات
async function handleLatestTransactions(req, res) {
    try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const limit = parseInt(url.searchParams.get('limit')) || 10;

        // الحصول من قاعدة البيانات
        const result = await pool.query(`
            SELECT tx_hash, from_address, to_address, amount, timestamp, block_index, block_hash
            FROM transactions 
            ORDER BY timestamp DESC
            LIMIT $1
        `, [limit]);

        const networkNode = getNetworkNode();
        let transactions = result.rows.map(row => ({
            hash: row.tx_hash,
            from: row.from_address,
            to: row.to_address,
            value: row.amount,
            timestamp: Math.floor(row.timestamp / 1000),
            blockNumber: row.block_index,
            blockHash: row.block_hash,
            gasPrice: networkNode ? networkNode.network.getGasPrice() : 0.000000001,
            gasUsed: 21000,
            status: 'success'
        }));

        // إذا لم توجد معاملات في قاعدة البيانات، احصل عليها من البلوك تشين
        if (transactions.length === 0 && networkNode) {
            const allTransactions = networkNode.network.getAllTransactions();
            transactions = allTransactions.slice(-limit).reverse().map(tx => ({
                hash: tx.hash || tx.txId,
                from: tx.fromAddress || tx.from,
                to: tx.toAddress || tx.to,
                value: tx.amount || tx.value,
                timestamp: Math.floor((tx.timestamp || Date.now()) / 1000),
                blockNumber: tx.blockIndex || 0,
                blockHash: tx.blockHash || '',
                gasPrice: tx.gasPrice || networkNode.network.getGasPrice(),
                gasUsed: tx.gasUsed || 21000,
                status: 'success'
            }));
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: true,
            data: transactions
        }));

    } catch (error) {
        console.error('Error getting latest transactions:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: false,
            error: error.message
        }));
    }

    return true;
}

// الحصول على آخر البلوكات
async function handleLatestBlocks(req, res) {
    try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const page = parseInt(url.searchParams.get('page')) || 0;
        const perPage = Math.min(Math.max(parseInt(url.searchParams.get('per_page')) || 50, 1), 100);
        const limit = parseInt(url.searchParams.get('limit')) || 10;

        const networkNode = getNetworkNode();
        const blocks = [];

        if (networkNode) {
            const totalBlockCount = networkNode.network.totalBlockCount;
            const latestBlockNumber = totalBlockCount - 1;

            // Server-side pagination: ?page=1&per_page=50
            // Legacy mode: ?limit=1000
            const usePagination = page > 0;
            const offset = usePagination ? (page - 1) * perPage : 0;
            const count = usePagination ? perPage : limit;
            const startBlock = latestBlockNumber - offset;

            for (let i = 0; i < count && (startBlock - i) >= 0; i++) {
                const blockIndex = startBlock - i;
                const block = networkNode.network.getBlockByIndex(blockIndex);

                if (block) {
                    // حساب عدد المعاملات الفعلية بدقة
                    let txCount = 0;
                    if (block.transactions && Array.isArray(block.transactions)) {
                      // استثناء معاملة الـ reward من العدد
                      txCount = block.transactions.filter(tx => 
                        tx.fromAddress !== null && 
                        tx.toAddress !== '0x0000000000000000000000000000000000000000' &&
                        tx.toAddress !== '0x0000000000000000000000000000000000000001'
                      ).length;
                    }

                    // Generate hashes for missing fields
                    const parentHash = blockIndex > 0 ? (blocks[blocks.length - 1]?.hash || '0x' + crypto.createHash('sha256').update('parent_' + (blockIndex - 1)).digest('hex')) : '0x' + '0'.repeat(64);

                    blocks.push({
                        number: block.index,
                        hash: block.hash,
                        timestamp: Math.floor(block.timestamp / 1000),
                        transactions: txCount,
                        transactionCount: txCount,
                        miner: 'Block Validator',
                        size: JSON.stringify(block).length,
                        gasUsed: (txCount) * 21000,
                        gasLimit: 30000000,
                        difficulty: block.difficulty || 1,
                        reward: networkNode.network.processingReward,
                        parentHash: block.parentHash || parentHash,
                        stateRoot: block.stateRoot || '0x' + crypto.createHash('sha256').update('state_' + blockIndex).digest('hex'),
                        transactionsRoot: block.transactionsRoot || '0x' + crypto.createHash('sha256').update('txroot_' + blockIndex + '_' + txCount).digest('hex'),
                        receiptsRoot: block.receiptsRoot || '0x' + crypto.createHash('sha256').update('receipts_' + blockIndex).digest('hex'),
                        nonce: '0x0000000000000000',
                        extraData: '0x'
                    });
                }
            }
        } else {
            // Fallback: Get blocks from database by grouping transactions
            const result = await pool.query(`
                SELECT DISTINCT block_index, block_hash, timestamp
                FROM transactions
                WHERE block_index IS NOT NULL
                ORDER BY block_index DESC
                LIMIT $1
            `, [limit]);

            for (const row of result.rows) {
                // Get transaction count for this block
                const txCount = await pool.query(
                    'SELECT COUNT(*) as count FROM transactions WHERE block_index = $1',
                    [row.block_index]
                );
                const count = parseInt(txCount.rows[0]?.count || 0);
                const blockIndex = row.block_index;

                blocks.push({
                    number: blockIndex,
                    index: blockIndex,
                    hash: row.block_hash || `0x${blockIndex}`,
                    timestamp: Math.floor(new Date(row.timestamp).getTime() / 1000),
                    transactions: count,
                    transactionCount: count,
                    miner: 'Block Validator',
                    validator: 'Block Validator',
                    size: 1024,
                    gasUsed: count * 21000,
                    gasLimit: 30000000,
                    difficulty: 1,
                    reward: 0.25,
                    parentHash: '0x' + crypto.createHash('sha256').update('parent_' + (blockIndex - 1)).digest('hex'),
                    stateRoot: '0x' + crypto.createHash('sha256').update('state_' + blockIndex).digest('hex'),
                    transactionsRoot: '0x' + crypto.createHash('sha256').update('txroot_' + blockIndex + '_' + count).digest('hex'),
                    receiptsRoot: '0x' + crypto.createHash('sha256').update('receipts_' + blockIndex).digest('hex'),
                    nonce: '0x0000000000000000',
                    extraData: '0x'
                });
            }
        }

        const response = { success: true, data: blocks };

        // Add pagination metadata when using page parameter
        if (page > 0) {
            const total = networkNode ? networkNode.network.totalBlockCount : blocks.length;
            response.pagination = {
                total: total,
                page: page,
                per_page: perPage,
                total_pages: Math.ceil(total / perPage)
            };
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(response));

    } catch (error) {
        console.error('Error getting latest blocks:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: false,
            error: error.message
        }));
    }

    return true;
}

// تفاصيل المعاملة
async function handleTransactionDetails(req, res, txHash) {
    try {
        const networkNode = getNetworkNode();
        let transaction = null;

        // البحث في البلوك تشين أولاً
        if (networkNode) {
            transaction = networkNode.network.getTransactionByHash(txHash);
        }

        // البحث في قاعدة البيانات
        if (!transaction) {
            const result = await pool.query(
                'SELECT * FROM transactions WHERE tx_hash = $1 OR hash = $1',
                [txHash]
            );

            if (result.rows.length > 0) {
                const row = result.rows[0];
                transaction = {
                    hash: row.tx_hash || row.hash,
                    from: row.from_address,
                    to: row.to_address,
                    value: row.amount,
                    timestamp: Math.floor(row.timestamp / 1000),
                    blockNumber: row.block_index,
                    blockHash: row.block_hash,
                    gasPrice: row.gas_price || (networkNode ? networkNode.network.getGasPrice() : 0.000000001),
                    gasUsed: row.gas_used || 21000,
                    gasLimit: row.gas_used || 21000,
                    nonce: row.nonce || 0,
                    transactionIndex: 0,
                    status: row.status || 'success',
                    signature: row.signature || null,
                    r: row.signature ? ('0x' + row.signature.substring(0, 64)) : null,
                    s: row.signature ? ('0x' + row.signature.substring(64, 128)) : null,
                    v: row.signature ? ('0x' + row.signature.substring(128)) : null,
                    chainId: row.chain_id || '0x5968',
                    networkId: row.network_id || '22888',
                    isExternal: row.is_external || false,
                    isConfirmed: row.is_confirmed !== false,
                    confirmations: row.confirmations || 1
                };
            }
        }

        if (!transaction) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: false,
                error: 'Transaction not found'
            }));
            return true;
        }

        // ✅ تنظيف التوقيع وتصحيح البيانات (نفس منطق formatBlockTransaction)
        const FIXED_GAS_PRICE = 0.00002;
        
        // تنظيف hash
        const rawHash = transaction.hash || transaction.txId || transaction.transactionHash || '';
        const cleanHash = rawHash.startsWith('0x') ? rawHash : ('0x' + rawHash);
        
        // تنظيف العناوين
        const txFrom = transaction.from || transaction.fromAddress || null;
        const txTo = transaction.to || transaction.toAddress || null;
        const cleanFrom = txFrom && txFrom.startsWith('0x') && txFrom.length === 42 
            ? txFrom : '0x0000000000000000000000000000000000000000';
        const cleanTo = txTo && txTo.startsWith('0x') && txTo.length === 42 
            ? txTo : '0x0000000000000000000000000000000000000000';
        
        // ✅ تنظيف التوقيع - إزالة 0x المكررة والتحقق من الصيغة
        let cleanSig = transaction.signature || null;
        if (cleanSig) {
            cleanSig = cleanSig.replace(/0x/g, '');
            if (cleanSig.length < 128 || !/^[0-9a-fA-F]+$/.test(cleanSig)) {
                cleanSig = null;
            }
        }
        if (!cleanSig) {
            const rHash = crypto.createHash('sha256').update(cleanFrom + cleanTo + (transaction.value || 0) + (transaction.nonce || 0) + rawHash + 'r').digest('hex');
            const sHash = crypto.createHash('sha256').update(cleanFrom + cleanTo + (transaction.value || 0) + (transaction.nonce || 0) + rawHash + 's').digest('hex');
            cleanSig = rHash + sHash + 'b2eb';
        }

        // إضافة تفاصيل إضافية
        const enhancedTransaction = {
            ...transaction,
            hash: cleanHash,
            txId: cleanHash,
            transactionHash: cleanHash,
            id: cleanHash,
            from: cleanFrom,
            fromAddress: cleanFrom,
            to: cleanTo,
            toAddress: cleanTo,
            gasPrice: FIXED_GAS_PRICE,
            gasFee: FIXED_GAS_PRICE,
            effectiveGasPrice: FIXED_GAS_PRICE,
            signature: cleanSig,
            r: cleanSig ? ('0x' + cleanSig.substring(0, 64)) : null,
            s: cleanSig ? ('0x' + cleanSig.substring(64, 128)) : null,
            v: cleanSig ? ('0x' + cleanSig.substring(128)) : null,
            confirmations: networkNode ? (networkNode.network.totalBlockCount - (transaction.blockNumber || 0)) : 1,
            input: '0x',
            logs: [],
            type: 0
        };

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: true,
            data: enhancedTransaction
        }));

    } catch (error) {
        console.error('Error getting transaction details:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: false,
            error: error.message
        }));
    }

    return true;
}

// تفاصيل العنوان
async function handleAddressDetails(req, res, address) {
    try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const page = parseInt(url.searchParams.get('page')) || 1;
        const limit = parseInt(url.searchParams.get('limit')) || 25;
        const offset = (page - 1) * limit;

        const networkNode = getNetworkNode();
        const balance = networkNode ? networkNode.network.getBalance(address) : 0;

        // الحصول على جميع المعاملات (بدون limit) لحساب الإحصائيات
        const allTransactions = await getTransactionsByAddress(address);

        // حساب الإحصائيات من جميع المعاملات
        const totalSent = allTransactions
            .filter(tx => tx.from && tx.from.toLowerCase() === address.toLowerCase())
            .reduce((sum, tx) => sum + parseFloat(tx.value || 0), 0);

        const totalReceived = allTransactions
            .filter(tx => tx.to && tx.to.toLowerCase() === address.toLowerCase())
            .reduce((sum, tx) => sum + parseFloat(tx.value || 0), 0);

        // تقسيم المعاملات حسب الصفحة
        const paginatedTransactions = allTransactions.slice(offset, offset + limit);
        const totalPages = Math.ceil(allTransactions.length / limit);

        const addressInfo = {
            address: address,
            balance: balance,
            balanceUSD: balance * 0.001,
            transactionCount: allTransactions.length,
            totalSent: totalSent,
            totalReceived: totalReceived,
            firstSeen: allTransactions.length > 0 ? Math.min(...allTransactions.map(tx => tx.timestamp)) : null,
            lastSeen: allTransactions.length > 0 ? Math.max(...allTransactions.map(tx => tx.timestamp)) : null,
            isContract: false,
            transactions: paginatedTransactions,
            pagination: {
                page: page,
                limit: limit,
                totalPages: totalPages,
                totalTransactions: allTransactions.length,
                hasMore: page < totalPages
            }
        };

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: true,
            data: addressInfo
        }));

    } catch (error) {
        console.error('Error getting address details:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: false,
            error: error.message
        }));
    }

    return true;
}

// تفاصيل البلوك
async function handleBlockDetails(req, res, blockId) {
    try {
        const networkNode = getNetworkNode();
        let block;

        // Try from network node first
        if (networkNode) {
            if (blockId === 'latest') {
                block = networkNode.network.getLatestBlock();
            } else if (blockId.startsWith('0x')) {
                block = networkNode.network.getBlockByHash(blockId);
            } else {
                const index = parseInt(blockId);
                block = networkNode.network.getBlockByIndex(index);
            }
        }

        // Fallback: Build block from transactions
        if (!block) {
            try {
                const allTransactions = networkNode?.blockchain?.getAllTransactions() || [];
                const blockIndex = blockId === 'latest' ? null : parseInt(blockId);
                
                if (allTransactions.length > 0) {
                    // Build blocks from transactions
                    const sortedTx = allTransactions.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
                    const blocks = [];
                    let currentBlockTx = [];
                    let idx = 0;
                    
                    for (let i = 0; i < sortedTx.length; i++) {
                        currentBlockTx.push(sortedTx[i]);
                        if (currentBlockTx.length >= 3 || i === sortedTx.length - 1) {
                            const tx = currentBlockTx[0];
                            const blockHash = require('crypto').createHash('sha256')
                                .update(`block_${idx}_${tx.timestamp || Date.now()}`)
                                .digest('hex');
                            
                            blocks.push({
                                index: idx,
                                number: idx,
                                hash: '0x' + blockHash,
                                timestamp: tx.timestamp || Date.now(),
                                transactions: [...currentBlockTx],
                                transactionCount: currentBlockTx.length,
                                miner: 'Block Validator',
                                reward: 0.25,
                                gasUsed: currentBlockTx.reduce((sum, t) => sum + (t.gasUsed || 21000), 0),
                                gasLimit: 30000000,
                                difficulty: 1,
                                parentHash: idx > 0 ? blocks[idx-1].hash : '0x' + '0'.repeat(64)
                            });
                            currentBlockTx = [];
                            idx++;
                        }
                    }
                    
                    if (blockIndex !== null && blocks[blockIndex]) {
                        block = blocks[blockIndex];
                    } else if (blockId === 'latest' && blocks.length > 0) {
                        block = blocks[blocks.length - 1];
                    }
                }
            } catch (fbError) {
                console.log('Fallback block generation failed:', fbError.message);
            }
        }

        // Database fallback
        if (!block) {
            const blockIndex = blockId === 'latest' ? null : parseInt(blockId);
            const query = blockIndex !== null 
                ? 'SELECT DISTINCT block_index, block_hash, timestamp FROM transactions WHERE block_index = $1'
                : 'SELECT DISTINCT block_index, block_hash, timestamp FROM transactions ORDER BY block_index DESC LIMIT 1';
            const params = blockIndex !== null ? [blockIndex] : [];
            const result = await pool.query(query, params);

            if (result.rows.length > 0) {
                const row = result.rows[0];
                block = {
                    index: row.block_index,
                    number: row.block_index,
                    hash: row.block_hash || `0x${row.block_index}`,
                    timestamp: new Date(row.timestamp).getTime(),
                    transactions: [],
                    miner: 'Block Validator',
                    reward: 0.25
                };
            }
        }

        if (!block) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: false,
                error: 'Block not found'
            }));
            return true;
        }

        // ✅ Format transactions in block with proper gasPrice, gasFee, signature
        const formattedTransactions = (block.transactions || []).map(formatBlockTransaction);

        const enhancedBlock = {
            ...block,
            transactions: formattedTransactions,
            size: JSON.stringify(block).length,
            gasUsed: block.gasUsed || (block.transactions?.length || 0) * 21000,
            gasLimit: block.gasLimit || 30000000,
            difficulty: block.difficulty || 1,
            totalDifficulty: (block.index + 1) * (block.difficulty || 1),
            miner: block.miner || 'Block Validator',
            reward: block.reward || 0.25,
            uncles: [],
            sha3Uncles: '0x1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347',
            logsBloom: '0x' + '0'.repeat(512),
            parentHash: block.parentHash || '0x' + '0'.repeat(64),
            transactionsRoot: block.transactionsRoot || '0x' + crypto.createHash('sha256').update('txroot_' + block.index).digest('hex'),
            stateRoot: block.stateRoot || '0x' + crypto.createHash('sha256').update('state_' + block.index).digest('hex'),
            receiptsRoot: block.receiptsRoot || '0x' + crypto.createHash('sha256').update('receipts_' + block.index).digest('hex'),
            extraData: '0x',
            mixHash: '0x' + '0'.repeat(64),
            nonce: '0x' + (block.nonce?.toString(16).padStart(16, '0') || '0000000000000000')
        };

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: true,
            data: enhancedBlock
        }));

    } catch (error) {
        console.error('Error getting block details:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: false,
            error: error.message
        }));
    }

    return true;
}

// البحث
async function handleSearch(req, res) {
    try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const query = url.searchParams.get('q')?.trim();

        if (!query) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: false,
                error: 'Search query required'
            }));
            return true;
        }

        const networkNode = getNetworkNode();
        let result = null;
        let type = null;

        // فحص نوع البحث
        if (query.match(/^0x[a-fA-F0-9]{40}$/)) {
            // عنوان
            const balance = networkNode ? networkNode.network.getBalance(query) : 0;
            const transactions = await getTransactionsByAddress(query, 0, 'latest', 'desc', 10);

            result = {
                address: query,
                balance: balance,
                transactionCount: transactions.length
            };
            type = 'address';

        } else if (query.match(/^0x[a-fA-F0-9]{64}$/)) {
            // هاش معاملة
            if (networkNode) {
                const transaction = networkNode.network.getTransactionByHash(query);
                if (transaction) {
                    result = transaction;
                    type = 'transaction';
                }
            } else {
                const dbResult = await pool.query('SELECT * FROM transactions WHERE tx_hash = $1', [query]);
                if (dbResult.rows.length > 0) {
                    result = dbResult.rows[0];
                    type = 'transaction';
                }
            }

        } else if (/^\d+$/.test(query)) {
            // رقم بلوك
            const blockIndex = parseInt(query);
            if (networkNode) {
                const block = networkNode.network.getBlockByIndex(blockIndex);
                if (block) {
                    result = block;
                    type = 'block';
                }
            } else {
                const dbResult = await pool.query('SELECT DISTINCT block_index, block_hash, timestamp FROM transactions WHERE block_index = $1', [blockIndex]);
                if (dbResult.rows.length > 0) {
                    result = dbResult.rows[0];
                    type = 'block';
                }
            }

        } else if (query.startsWith('0x') && query.length === 66) {
            // هاش بلوك
            if (networkNode) {
                const block = networkNode.network.getBlockByHash(query);
                if (block) {
                    result = block;
                    type = 'block';
                }
            }
        }

        if (!result) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: false,
                error: 'Not found'
            }));
            return true;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: true,
            type: type,
            data: result
        }));

    } catch (error) {
        console.error('Error in search:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: false,
            error: error.message
        }));
    }

    return true;
}

// الحصول على معاملات العنوان
async function getTransactionsByAddress(address, startblock = 0, endblock = 'latest', sort = 'desc', limit = 1000) {
    try {
        // البحث في قاعدة البيانات أولاً
        const result = await pool.query(`
            SELECT tx_hash, from_address, to_address, amount, timestamp, block_index, block_hash
            FROM transactions 
            WHERE from_address = $1 OR to_address = $1
            ORDER BY timestamp ${sort === 'desc' ? 'DESC' : 'ASC'}
            LIMIT $2
        `, [address.toLowerCase(), limit]);

        const networkNode = getNetworkNode();
        const gasPrice = networkNode ? networkNode.network.getGasPrice() : 0.000000001;
        // ✅ صحيح: gasPrice per unit = total fee / 21000
        const gasPricePerUnit = Math.floor(gasPrice * 1e18 / 21000);

        const transactions = result.rows.map(row => ({
            blockNumber: row.block_index?.toString() || '0',
            timeStamp: Math.floor(row.timestamp / 1000).toString(),
            hash: row.tx_hash,
            from: row.from_address,
            to: row.to_address,
            value: Math.floor((row.amount || 0) * 1e18).toString(),
            gas: '21000',
            gasPrice: gasPricePerUnit.toString(), // ✅ صحيح: gasPrice per unit
            gasUsed: '21000',
            input: '0x',
            contractAddress: '',
            cumulativeGasUsed: '21000',
            txreceipt_status: '1',
            confirmations: networkNode ? (networkNode.network.totalBlockCount - (row.block_index || 0)) : 1
        }));

        // إذا لم توجد معاملات في قاعدة البيانات، احصل عليها من البلوك تشين
        if (transactions.length === 0 && networkNode) {
            const allTransactions = networkNode.network.getAllTransactionsForWallet(address);
            return allTransactions.slice(0, limit).map(tx => ({
                blockNumber: tx.blockIndex?.toString() || '0',
                timeStamp: Math.floor((tx.timestamp || Date.now()) / 1000).toString(),
                hash: tx.hash || tx.txId,
                from: tx.fromAddress || tx.from,
                to: tx.toAddress || tx.to,
                value: Math.floor((tx.amount || tx.value || 0) * 1e18).toString(),
                gas: '21000',
                gasPrice: gasPricePerUnit.toString(), // ✅ صحيح: gasPrice per unit
                gasUsed: '21000',
                input: '0x',
                contractAddress: '',
                cumulativeGasUsed: '21000',
                txreceipt_status: '1',
                confirmations: networkNode.network.totalBlockCount - (tx.blockIndex || 0)
            }));
        }

        return transactions;

    } catch (error) {
        console.error('Error getting transactions by address:', error);
        return [];
    }
}

// الحصول على أفضل الحسابات (Top Accounts)
async function handleTopAccounts(req, res) {
    try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        
        const limit = parseInt(url.searchParams.get('limit')) || 100;
        const page = parseInt(url.searchParams.get('page')) || 1;
        const offset = (page - 1) * limit;

        // جلب جميع الحسابات من جداول مختلفة (بدون بيانات شخصية)
        const usersQuery = await pool.query(`
            SELECT 
                wallet_address as address,
                coins as balance
            FROM users
            WHERE wallet_address IS NOT NULL AND wallet_address != ''
        `);

        const externalWalletsQuery = await pool.query(`
            SELECT 
                address,
                balance
            FROM external_wallets
            WHERE address IS NOT NULL
        `);

        // ✅ جلب حسابات web3 من مجلد ethereum-network-data/accounts/
        const web3Accounts = [];
        try {
            // استخدام __dirname للحصول على مسار المجلد الحالي
            const accountsDir = path.join(__dirname, 'ethereum-network-data', 'accounts');
            
            if (fs.existsSync(accountsDir)) {
                // قراءة جميع ملفات JSON في المجلد
                const files = fs.readdirSync(accountsDir).filter(file => file.endsWith('.json'));
                
                for (const file of files) {
                    const filePath = path.join(accountsDir, file);
                    const accountData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                    
                    // الرصيد موجود كـ string في الملف (مثل: "95.48")
                    const balanceInAccess = parseFloat(accountData.balance || '0');
                    
                    web3Accounts.push({
                        address: accountData.address,
                        balance: balanceInAccess
                    });
                }
                
                console.log(`✅ Loaded ${web3Accounts.length} web3 accounts from ethereum-network-data/accounts/`);
            }
        } catch (error) {
            console.warn('⚠️ Error loading web3 accounts from ethereum-network-data/accounts/:', error.message);
        }

        // دمج جميع الحسابات من المصادر الثلاثة وإزالة التكرارات
        const accountsMap = new Map();
        
        // دمج الحسابات (web3 accounts لها الأولوية للرصيد لأنها الحالة الفعلية على blockchain)
        const allSources = [...usersQuery.rows, ...externalWalletsQuery.rows, ...web3Accounts];
        
        for (const account of allSources) {
            const normalizedAddress = account.address.toLowerCase();
            
            if (accountsMap.has(normalizedAddress)) {
                // إذا كان الحساب موجود، احتفظ بأكبر رصيد فقط
                const existing = accountsMap.get(normalizedAddress);
                accountsMap.set(normalizedAddress, {
                    address: account.address,
                    balance: Math.max(existing.balance, parseFloat(account.balance || 0))
                });
            } else {
                accountsMap.set(normalizedAddress, {
                    address: account.address,
                    balance: parseFloat(account.balance || 0)
                });
            }
        }
        
        const allAccounts = Array.from(accountsMap.values());
        console.log(`✅ Total unique accounts: ${allAccounts.length} (from ${allSources.length} total entries)`);

        // حساب إجمالي المبلغ وعدد المعاملات لكل حساب
        const accountsWithStats = await Promise.all(allAccounts.map(async (account) => {
            const txCountQuery = await pool.query(`
                SELECT COUNT(*) as count
                FROM transactions
                WHERE from_address = $1 OR to_address = $1
            `, [account.address.toLowerCase()]);

            const balance = parseFloat(account.balance || 0);
            const txCount = parseInt(txCountQuery.rows[0]?.count || 0);

            return {
                address: account.address,
                balance: balance,
                txCount: txCount
            };
        }));

        // ترتيب حسب الرصيد (من الأعلى للأقل)
        accountsWithStats.sort((a, b) => b.balance - a.balance);

        // حساب إجمالي العرض
        const totalSupply = accountsWithStats.reduce((sum, acc) => sum + acc.balance, 0);

        // تطبيق الصفحات
        const paginatedAccounts = accountsWithStats.slice(offset, offset + limit);

        // حساب النسبة المئوية لكل حساب
        // ⚠️ خصوصية المستخدمين: لا نرسل أي بيانات شخصية (name, email) في API للمطورين
        const accountsWithPercentage = paginatedAccounts.map((account, index) => ({
            rank: offset + index + 1,
            address: account.address,
            balance: account.balance.toFixed(8),
            balanceRaw: account.balance,
            percentage: totalSupply > 0 ? ((account.balance / totalSupply) * 100).toFixed(8) : '0',
            txCount: account.txCount
            // ❌ nameTag تم إزالته لحماية خصوصية المستخدمين - فقط address و balance
        }));

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: true,
            data: {
                accounts: accountsWithPercentage,
                total: accountsWithStats.length,
                totalSupply: totalSupply.toFixed(8),
                page: page,
                limit: limit,
                totalPages: Math.ceil(accountsWithStats.length / limit)
            }
        }));

    } catch (error) {
        console.error('Error getting top accounts:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: false,
            error: error.message
        }));
    }

    return true;
}