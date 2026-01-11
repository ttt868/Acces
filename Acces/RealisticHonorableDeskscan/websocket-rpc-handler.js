// WebSocket RPC Handler - دعم كامل لـ eth_subscribe مثل Ethereum و BSC
import { EventEmitter } from 'events';
import { getNetworkNode } from './network-api.js';

class WebSocketRPCHandler extends EventEmitter {
  constructor() {
    super();
    this.clients = new Map();
    this.subscriptions = new Map();
    this.subscriptionCounter = 0;
    
    // ✅ TRUST WALLET FIX: Start heartbeat to prevent socket timeout
    this.startHeartbeat();
  }
  
  // ✅ TRUST WALLET FIX: Heartbeat system to keep WebSocket connections alive
  startHeartbeat() {
    // Send ping every 25 seconds to prevent "socket time has expired"
    setInterval(() => {
      this.clients.forEach((client, clientId) => {
        if (client.ws.readyState === 1) { // WebSocket.OPEN
          try {
            client.ws.ping();
            client.lastPing = Date.now();
          } catch (e) {
            // Ignore ping errors
          }
        }
      });
    }, 25000);
  }

  handleNewClient(ws, clientId) {
    
    this.clients.set(clientId, {
      ws: ws,
      subscriptions: new Set(),
      address: null,
      connectedAt: Date.now(),
      lastPing: Date.now()
    });
    
    // ✅ TRUST WALLET FIX: Handle pong responses
    ws.on('pong', () => {
      const client = this.clients.get(clientId);
      if (client) {
        client.lastPong = Date.now();
      }
    });

    ws.on('message', async (message) => {
      await this.handleMessage(clientId, message);
    });

    ws.on('close', () => {
      this.handleClientDisconnect(clientId);
    });

    ws.on('error', (error) => {
      console.error(`WebSocket error for client ${clientId}:`, error.message);
    });
  }

  async handleMessage(clientId, message) {
    try {
      const request = JSON.parse(message.toString());
      const client = this.clients.get(clientId);
      
      if (!client) {
        console.warn(`Client ${clientId} not found`);
        return;
      }

      const response = await this.processRPCRequest(request, clientId);
      
      if (response) {
        client.ws.send(JSON.stringify(response));
      }
    } catch (error) {
      console.error('Error handling WebSocket message:', error);
      const errorResponse = {
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32700,
          message: 'Parse error'
        }
      };
      
      const client = this.clients.get(clientId);
      if (client && client.ws.readyState === 1) {
        client.ws.send(JSON.stringify(errorResponse));
      }
    }
  }

  async processRPCRequest(request, clientId) {
    const { method, params, id } = request;
    const client = this.clients.get(clientId);

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

      switch (method) {
        case 'eth_subscribe':
          return await this.handleSubscribe(params, id, clientId);

        case 'eth_unsubscribe':
          return await this.handleUnsubscribe(params, id, clientId);

        case 'eth_getBalance':
          const [address] = params;
          client.address = address;
          const balance = accessNode.network.getBalance(address);
          // 🔧 FIX: تقريب لـ 8 أرقام لتجنب 0.225336999999999904
          const roundedBal = Math.round(Math.max(0, balance) * 1e8) / 1e8;
          const balanceWei = Math.floor(roundedBal * 1e18);
          
          return {
            jsonrpc: '2.0',
            id: id,
            result: '0x' + balanceWei.toString(16)
          };

        case 'eth_blockNumber':
          const latestBlock = accessNode.network.getLatestBlock();
          return {
            jsonrpc: '2.0',
            id: id,
            result: '0x' + latestBlock.index.toString(16)
          };

        case 'eth_chainId':
          return {
            jsonrpc: '2.0',
            id: id,
            result: accessNode.network.hexChainId
          };

        case 'net_version':
          return {
            jsonrpc: '2.0',
            id: id,
            result: accessNode.network.networkId.toString()
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
      console.error('Error processing RPC request:', error);
      return {
        jsonrpc: '2.0',
        id: id,
        error: {
          code: -32603,
          message: 'Internal error: ' + error.message
        }
      };
    }
  }

  async handleSubscribe(params, requestId, clientId) {
    const [subscriptionType, subscriptionParams] = params;
    const client = this.clients.get(clientId);

    if (!client) {
      return {
        jsonrpc: '2.0',
        id: requestId,
        error: {
          code: -32603,
          message: 'Client not found'
        }
      };
    }

    const subscriptionId = '0x' + (++this.subscriptionCounter).toString(16);

    const subscription = {
      id: subscriptionId,
      type: subscriptionType,
      params: subscriptionParams,
      clientId: clientId,
      createdAt: Date.now()
    };

    this.subscriptions.set(subscriptionId, subscription);
    client.subscriptions.add(subscriptionId);

    return {
      jsonrpc: '2.0',
      id: requestId,
      result: subscriptionId
    };
  }

  async handleUnsubscribe(params, requestId, clientId) {
    const [subscriptionId] = params;
    const subscription = this.subscriptions.get(subscriptionId);

    if (!subscription || subscription.clientId !== clientId) {
      return {
        jsonrpc: '2.0',
        id: requestId,
        result: false
      };
    }

    const client = this.clients.get(clientId);
    if (client) {
      client.subscriptions.delete(subscriptionId);
    }

    this.subscriptions.delete(subscriptionId);

    return {
      jsonrpc: '2.0',
      id: requestId,
      result: true
    };
  }

  broadcastNewPendingTransaction(transaction) {
    const txHash = transaction.hash || transaction.txId;

    this.subscriptions.forEach((subscription, subId) => {
      if (subscription.type === 'newPendingTransactions') {
        const client = this.clients.get(subscription.clientId);
        
        if (client && client.ws.readyState === 1) {
          const notification = {
            jsonrpc: '2.0',
            method: 'eth_subscription',
            params: {
              subscription: subId,
              result: txHash
            }
          };

          client.ws.send(JSON.stringify(notification));
        }
      }
    });
  }

  broadcastNewBlock(block) {
    // console.log(`📢 Broadcasting new block ${block.index} to WebSocket subscribers`);

    this.subscriptions.forEach((subscription, subId) => {
      if (subscription.type === 'newHeads') {
        const client = this.clients.get(subscription.clientId);
        
        if (client && client.ws.readyState === 1) {
          const blockHeader = {
            number: '0x' + block.index.toString(16),
            hash: block.hash,
            parentHash: block.previousHash,
            timestamp: '0x' + Math.floor((block.timestamp || Date.now()) / 1000).toString(16),
            miner: '0x0000000000000000000000000000000000000000',
            gasLimit: '0x1c9c380',
            gasUsed: '0x5208',
            transactionsRoot: block.merkleRoot
          };

          const notification = {
            jsonrpc: '2.0',
            method: 'eth_subscription',
            params: {
              subscription: subId,
              result: blockHeader
            }
          };

          client.ws.send(JSON.stringify(notification));
        }
      } else if (subscription.type === 'logs') {
        const client = this.clients.get(subscription.clientId);
        
        if (client && client.ws.readyState === 1) {
          const logs = this.extractLogsFromBlock(block, subscription.params);
          
          if (logs.length > 0) {
            logs.forEach(log => {
              const notification = {
                jsonrpc: '2.0',
                method: 'eth_subscription',
                params: {
                  subscription: subId,
                  result: log
                }
              };
              
              client.ws.send(JSON.stringify(notification));
            });
          }
        }
      }
    });

    // ✅ FORCE REFRESH: Notify all connected clients about potential balance changes
    this.notifyBalanceChanges(block);
    
    // ✅ ADDED: Specialized Trust Wallet Refresh for real-time updates
    this.forceTrustWalletSync(block);
  }

  // ✅ New method to force Trust Wallet to refresh UI
  forceTrustWalletSync(block) {
    const affectedAddresses = new Set();
    block.transactions.forEach(tx => {
      if (tx.fromAddress) affectedAddresses.add(tx.fromAddress.toLowerCase());
      if (tx.toAddress) affectedAddresses.add(tx.toAddress.toLowerCase());
    });

    affectedAddresses.forEach(address => {
      this.clients.forEach((client, clientId) => {
        if (client.ws.readyState === 1 && (!client.address || client.address.toLowerCase() === address)) {
          // Send mandatory Ethereum events that trigger UI refresh in Trust Wallet/MetaMask
          const chainIdNotification = {
            jsonrpc: '2.0',
            method: 'metamask_chainChanged', // Triggers internal refresh
            params: { chainId: '0x5968', networkVersion: '22888' }
          };
          const accountsNotification = {
            jsonrpc: '2.0',
            method: 'eth_subscription',
            params: {
              subscription: '0xBalanceRefresh',
              result: { address: address, refresh: true }
            }
          };
          
          try {
            client.ws.send(JSON.stringify(chainIdNotification));
            client.ws.send(JSON.stringify(accountsNotification));
          } catch (e) {}
        }
      });
    });
  }

  extractLogsFromBlock(block, filterParams) {
    const logs = [];
    
    // For Access Network (simple transfers), we generate synthetic logs
    // In a real smart contract platform, these would be actual contract events
    if (!filterParams) filterParams = {};
    
    block.transactions.forEach((tx, txIndex) => {
      // Check if transaction matches filter criteria
      const matchesAddress = !filterParams.address || 
                            (Array.isArray(filterParams.address) ? 
                              filterParams.address.includes(tx.toAddress) : 
                              filterParams.address === tx.toAddress);
      
      if (matchesAddress) {
        // Generate Transfer event log
        const log = {
          address: tx.toAddress,
          topics: [
            // Transfer(address indexed from, address indexed to, uint256 value)
            '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
            '0x' + (tx.fromAddress || '0x0000000000000000000000000000000000000000').slice(2).padStart(64, '0'),
            '0x' + (tx.toAddress || '0x0000000000000000000000000000000000000000').slice(2).padStart(64, '0')
          ],
          data: '0x' + Math.floor(tx.amount * 1e18).toString(16).padStart(64, '0'),
          blockNumber: '0x' + block.index.toString(16),
          transactionHash: tx.hash || tx.txId,
          transactionIndex: '0x' + txIndex.toString(16),
          blockHash: block.hash,
          logIndex: '0x' + txIndex.toString(16),
          removed: false
        };
        
        logs.push(log);
      }
    });
    
    return logs;
  }

  notifyBalanceChanges(block) {
    const affectedAddresses = new Set();

    block.transactions.forEach(tx => {
      if (tx.fromAddress) affectedAddresses.add(tx.fromAddress.toLowerCase());
      if (tx.toAddress) affectedAddresses.add(tx.toAddress.toLowerCase());
    });

    affectedAddresses.forEach(address => {
      this.notifyBalanceChange(address);
    });
  }

  notifyBalanceChange(address) {
    const normalizedAddress = address.toLowerCase();
    
    this.clients.forEach((client, clientId) => {
      if (client.address && client.address.toLowerCase() === normalizedAddress) {
        if (client.ws.readyState === 1) {
          try {
            const accessNode = getNetworkNode();
            if (!accessNode) return;

            const newBalance = accessNode.network.getBalance(address);
            const balanceWei = Math.floor(Math.max(0, newBalance) * 1e18);

            const notification = {
              jsonrpc: '2.0',
              method: 'eth_balanceChanged',
              params: {
                address: address,
                balance: '0x' + balanceWei.toString(16),
                balanceFormatted: newBalance.toFixed(8) + ' ACCESS'
              }
            };

            client.ws.send(JSON.stringify(notification));
          } catch (error) {
            console.error('Error notifying balance change:', error);
          }
        }
      }
    });
  }

  handleClientDisconnect(clientId) {
    const client = this.clients.get(clientId);
    
    if (client) {
      client.subscriptions.forEach(subId => {
        this.subscriptions.delete(subId);
      });

      this.clients.delete(clientId);
    }
  }

  getStats() {
    return {
      connectedClients: this.clients.size,
      activeSubscriptions: this.subscriptions.size,
      subscriptionTypes: Array.from(this.subscriptions.values()).reduce((acc, sub) => {
        acc[sub.type] = (acc[sub.type] || 0) + 1;
        return acc;
      }, {})
    };
  }
}

export default WebSocketRPCHandler;
