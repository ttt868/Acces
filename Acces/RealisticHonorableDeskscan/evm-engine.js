/**
 * ACCESS Network EVM Engine
 * Real Solidity smart contract execution using @ethereumjs/evm v10
 * Supports ERC-20 tokens, ERC-721 NFTs, and arbitrary Solidity contracts
 * 
 * Gas fees: flat 0.00002 ACCESS (same as native transfers)
 * Contract storage: Persisted to evm-state.json (code + storage slots)
 */

import { createEVM } from '@ethereumjs/evm';
import { SimpleStateManager } from '@ethereumjs/statemanager';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Import v10-compatible util from EVM's bundled packages
const evmUtilPath = pathToFileURL(
  path.join(__dirname, 'node_modules', '@ethereumjs', 'evm', 'node_modules', '@ethereumjs', 'util', 'dist', 'esm', 'index.js')
).href;
const evmUtil = await import(evmUtilPath);
const { Address, hexToBytes, bytesToHex, createAddressFromString } = evmUtil;

const STATE_FILE = path.join(__dirname, 'evm-state.json');
const MAX_GAS = BigInt(30_000_000);
const ZERO_ADDR = '0x' + '0'.repeat(40);

export class EVMEngine {
  constructor(blockchain) {
    this.blockchain = blockchain;
    this.sm = null;
    this.evm = null;
    this.ready = false;

    // Tracked state (intercepted from StateManager writes)
    this.contractCodes = new Map();     // address → hex code
    this.contractStorage = new Map();   // address → Map(slotHex → valueHex)
    this.deployedContracts = new Set(); // all contract addresses
    this.contractAccounts = new Map();  // address → {nonce}

    // Transaction logs cache
    this.txLogs = new Map();          // txHash → [log]

    // Save debounce
    this._saveTimer = null;
  }

  // ═══════════════════════════════════════════════════════════
  //  INITIALIZATION
  // ═══════════════════════════════════════════════════════════

  async init() {
    if (this.ready) return;

    this.sm = new SimpleStateManager();

    // 1) Load persisted state into SM (before interceptors → no redundant tracking)
    await this._loadState();

    // 2) Install interceptors for future writes
    this._installInterceptors();

    // 3) Create EVM instance
    this.evm = await createEVM({ stateManager: this.sm });

    this.ready = true;
    console.log(`✅ EVM Engine initialized (${this.deployedContracts.size} contracts loaded)`);
  }

  _installInterceptors() {
    // Track putCode
    const origPutCode = this.sm.putCode.bind(this.sm);
    this.sm.putCode = async (addr, code) => {
      const a = addr.toString().toLowerCase();
      this.contractCodes.set(a, bytesToHex(code));
      this.deployedContracts.add(a);
      return origPutCode(addr, code);
    };

    // Track putStorage
    const origPutStorage = this.sm.putStorage.bind(this.sm);
    this.sm.putStorage = async (addr, key, val) => {
      const a = addr.toString().toLowerCase();
      const k = Buffer.from(key).toString('hex');
      const v = Buffer.from(val).toString('hex');
      if (!this.contractStorage.has(a)) this.contractStorage.set(a, new Map());
      this.contractStorage.get(a).set(k, v);
      return origPutStorage(addr, key, val);
    };

    // Track putAccount (for nonces)
    const origPutAccount = this.sm.putAccount.bind(this.sm);
    this.sm.putAccount = async (addr, acct) => {
      const a = addr.toString().toLowerCase();
      if (this.deployedContracts.has(a)) {
        this.contractAccounts.set(a, { nonce: Number(acct.nonce || 0) });
      }
      return origPutAccount(addr, acct);
    };
  }

  // ═══════════════════════════════════════════════════════════
  //  HELPERS
  // ═══════════════════════════════════════════════════════════

  _addr(hex) {
    return createAddressFromString((hex || ZERO_ADDR).toLowerCase());
  }

  _hex(data) {
    if (!data || data === '0x' || data.length < 3) return new Uint8Array(0);
    const h = data.startsWith('0x') ? data : '0x' + data;
    try {
      return hexToBytes(h);
    } catch {
      return new Uint8Array(0);
    }
  }

  _padSlot(raw) {
    const padded = new Uint8Array(32);
    if (raw.length <= 32) {
      padded.set(raw, 32 - raw.length);
    } else {
      padded.set(raw.slice(raw.length - 32));
    }
    return padded;
  }

  /** Sync a blockchain account's native balance into EVM state */
  async _syncAccount(address) {
    const a = (address || '').toLowerCase();
    if (!a || a === ZERO_ADDR) return;

    const addr = this._addr(a);
    const balance = this.blockchain.getBalance(a);
    let nonce = 0;
    try {
      nonce = typeof this.blockchain.getNonce === 'function'
        ? await this.blockchain.getNonce(a) : 0;
    } catch { /* ignore */ }

    // Get existing account to preserve codeHash
    let existing = {};
    try { existing = await this.sm.getAccount(addr); } catch { /* new account */ }

    await this.sm.putAccount(addr, {
      ...existing,
      balance: BigInt(Math.round(Math.max(0, balance) * 1e18)),
      nonce: BigInt(Math.max(0, nonce)),
    });
  }

  /** Extract event logs from EVM result */
  _extractLogs(result, txHash, blockNumber) {
    const raw = result.execResult?.logs || [];
    return raw.map((log, i) => ({
      address: '0x' + Buffer.from(log[0]).toString('hex'),
      topics: log[1].map(t => '0x' + Buffer.from(t).toString('hex').padStart(64, '0')),
      data: '0x' + (Buffer.from(log[2]).toString('hex') || ''),
      logIndex: '0x' + i.toString(16),
      transactionHash: txHash || null,
      blockNumber: blockNumber ? '0x' + blockNumber.toString(16) : '0x1',
      blockHash: txHash || '0x' + '0'.repeat(64),
      transactionIndex: '0x0',
      removed: false,
    }));
  }

  /** Debounced save */
  _deferSave() {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this._saveState(), 2000);
  }

  // ═══════════════════════════════════════════════════════════
  //  PUBLIC API
  // ═══════════════════════════════════════════════════════════

  /**
   * Deploy a contract (eth_sendRawTransaction with empty 'to')
   * @returns {{ contractAddress, gasUsed, logs, success, error }}
   */
  async deploy(from, initCodeHex, value = 0, txHash = null, blockNumber = 0) {
    await this.init();
    await this._syncAccount(from);

    const result = await this.evm.runCall({
      caller: this._addr(from),
      data: this._hex(initCodeHex),
      gasLimit: MAX_GAS,
      value: BigInt(Math.round((value || 0) * 1e18)),
    });

    const contractAddress = result.createdAddress?.toString()?.toLowerCase() || null;
    const err = result.execResult.exceptionError;
    const logs = this._extractLogs(result, txHash, blockNumber);

    if (txHash) this.txLogs.set(txHash.toLowerCase(), logs);

    if (contractAddress && !err) {
      this.deployedContracts.add(contractAddress);
      console.log(`✅ EVM Contract deployed: ${contractAddress} (gas: ${result.execResult.executionGasUsed})`);
      this._deferSave();
    } else if (err) {
      console.error(`❌ EVM deploy failed: ${err.error || err}`);
    }

    return {
      contractAddress,
      gasUsed: Number(result.execResult.executionGasUsed),
      logs,
      success: !err,
      error: err ? String(err.error || err) : null,
    };
  }

  /**
   * Execute state-changing contract call (eth_sendRawTransaction to contract)
   * @returns {{ gasUsed, logs, returnValue, success, error }}
   */
  async execute(from, to, dataHex, value = 0, txHash = null, blockNumber = 0) {
    await this.init();
    await this._syncAccount(from);

    const result = await this.evm.runCall({
      caller: this._addr(from),
      to: this._addr(to),
      data: this._hex(dataHex),
      gasLimit: MAX_GAS,
      value: BigInt(Math.round((value || 0) * 1e18)),
    });

    const err = result.execResult.exceptionError;
    const logs = this._extractLogs(result, txHash, blockNumber);

    if (txHash) this.txLogs.set(txHash.toLowerCase(), logs);

    if (!err) {
      this._deferSave();
    }

    return {
      gasUsed: Number(result.execResult.executionGasUsed),
      logs,
      returnValue: bytesToHex(result.execResult.returnValue),
      success: !err,
      error: err ? String(err.error || err) : null,
    };
  }

  /**
   * Read-only call (eth_call) — state reverted after execution
   * @returns {{ returnValue, gasUsed, success, error, logs }}
   */
  async staticCall(from, to, dataHex, value = 0) {
    await this.init();
    if (from) await this._syncAccount(from);

    const hasCheckpoint = typeof this.sm.checkpoint === 'function';
    if (hasCheckpoint) await this.sm.checkpoint();

    try {
      const result = await this.evm.runCall({
        caller: this._addr(from || ZERO_ADDR),
        to: this._addr(to),
        data: this._hex(dataHex),
        gasLimit: MAX_GAS,
        value: BigInt(Math.round((value || 0) * 1e18)),
      });

      const err = result.execResult.exceptionError;
      return {
        returnValue: bytesToHex(result.execResult.returnValue),
        gasUsed: Number(result.execResult.executionGasUsed),
        success: !err,
        error: err ? String(err.error || err) : null,
        logs: this._extractLogs(result, null, 0),
      };
    } finally {
      if (hasCheckpoint) {
        try { await this.sm.revert(); } catch { /* ignore */ }
      }
    }
  }

  /**
   * Get contract bytecode at address
   * @returns {string} hex code or '0x'
   */
  async getCode(address) {
    await this.init();
    try {
      const code = await this.sm.getCode(this._addr(address));
      return (code && code.length > 0) ? bytesToHex(code) : '0x';
    } catch {
      return '0x';
    }
  }

  /**
   * Check if address is a contract
   */
  async isContract(address) {
    if (!address) return false;
    const code = await this.getCode(address);
    return code !== '0x' && code.length > 2;
  }

  /**
   * Get storage value at slot
   */
  async getStorageAt(address, slotHex) {
    await this.init();
    const zero64 = '0x' + '0'.repeat(64);
    try {
      const slot = this._padSlot(this._hex(slotHex));
      const val = await this.sm.getStorage(this._addr(address), slot);
      if (val && val.length > 0) {
        const hex = Buffer.from(val).toString('hex');
        return hex.length > 0 ? '0x' + hex.padStart(64, '0') : zero64;
      }
    } catch { /* not found */ }
    return zero64;
  }

  /**
   * Estimate gas for a transaction
   */
  async estimateGas(from, to, dataHex, value = 0) {
    await this.init();

    // Simple transfer — no data
    if (!dataHex || dataHex === '0x' || dataHex.length <= 2) return 21000;

    // Not a contract target — basic transfer + calldata cost
    if (to && !(await this.isContract(to))) {
      const dataBytes = Math.ceil((dataHex.length - 2) / 2);
      return 21000 + dataBytes * 16;
    }

    // Run simulation
    const hasCheckpoint = typeof this.sm.checkpoint === 'function';
    if (hasCheckpoint) await this.sm.checkpoint();

    try {
      if (from) await this._syncAccount(from);

      const opts = {
        caller: this._addr(from || ZERO_ADDR),
        data: this._hex(dataHex),
        gasLimit: MAX_GAS,
        value: BigInt(Math.round((value || 0) * 1e18)),
      };
      if (to) opts.to = this._addr(to);

      const result = await this.evm.runCall(opts);
      const err = result.execResult.exceptionError;
      const used = Number(result.execResult.executionGasUsed);

      // If execution failed or consumed all gas → return sensible default
      if (err || used >= Number(MAX_GAS) - 21000) {
        return to ? 200000 : 3000000; // call vs deploy
      }

      // 30% safety margin + base cost
      return Math.max(21000, Math.ceil(used * 1.3) + 21000);
    } catch {
      return to ? 200000 : 3000000; // fallback
    } finally {
      if (hasCheckpoint) {
        try { await this.sm.revert(); } catch { /* ignore */ }
      }
    }
  }

  /**
   * Get event logs for a specific transaction
   */
  getLogs(txHash) {
    return this.txLogs.get(txHash?.toLowerCase()) || [];
  }

  /**
   * Filter logs by criteria (eth_getLogs)
   */
  filterLogs({ address, topics } = {}) {
    const results = [];
    for (const [, logs] of this.txLogs) {
      for (const log of logs) {
        // Filter by address
        if (address) {
          const addrs = Array.isArray(address) ? address : [address];
          if (!addrs.some(a => a.toLowerCase() === log.address.toLowerCase())) continue;
        }
        // Filter by topics
        if (topics && topics.length > 0) {
          let match = true;
          for (let i = 0; i < topics.length; i++) {
            if (!topics[i]) continue; // null = any
            const target = Array.isArray(topics[i]) ? topics[i] : [topics[i]];
            if (!target.some(t => log.topics[i] === t)) { match = false; break; }
          }
          if (!match) continue;
        }
        results.push(log);
      }
    }
    return results;
  }

  // ═══════════════════════════════════════════════════════════
  //  PERSISTENCE
  // ═══════════════════════════════════════════════════════════

  _saveState() {
    try {
      const state = {
        version: 1,
        savedAt: Date.now(),
        contracts: [...this.deployedContracts],
        codes: Object.fromEntries(this.contractCodes),
        storage: {},
        accounts: {},
      };

      for (const [addr, slots] of this.contractStorage) {
        state.storage[addr] = Object.fromEntries(slots);
      }

      for (const [addr, acct] of this.contractAccounts) {
        state.accounts[addr] = acct;
      }

      fs.writeFileSync(STATE_FILE, JSON.stringify(state));
      console.log(`💾 EVM state saved (${this.deployedContracts.size} contracts)`);
    } catch (e) {
      console.warn('⚠️ EVM state save failed:', e.message);
    }
  }

  async _loadState() {
    try {
      if (!fs.existsSync(STATE_FILE)) return;

      const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));

      // Restore contract list
      for (const addr of (state.contracts || [])) {
        this.deployedContracts.add(addr);
      }

      // Restore codes
      for (const [addr, codeHex] of Object.entries(state.codes || {})) {
        if (!codeHex || codeHex === '0x') continue;
        this.contractCodes.set(addr, codeHex);

        const address = this._addr(addr);
        // Create account first (nonce >= 1 marks it as a contract in EIP)
        const nonce = state.accounts?.[addr]?.nonce || 1;
        await this.sm.putAccount(address, { nonce: BigInt(nonce), balance: BigInt(0) });
        await this.sm.putCode(address, this._hex(codeHex));
      }

      // Restore storage slots
      for (const [addr, slots] of Object.entries(state.storage || {})) {
        if (!this.contractStorage.has(addr)) this.contractStorage.set(addr, new Map());
        const address = this._addr(addr);

        for (const [slotHex, valueHex] of Object.entries(slots)) {
          this.contractStorage.get(addr).set(slotHex, valueHex);

          const key = this._padSlot(Buffer.from(slotHex, 'hex'));
          const val = Buffer.from(valueHex, 'hex');
          await this.sm.putStorage(address, key, val);
        }
      }

      console.log(`📦 EVM state loaded: ${this.deployedContracts.size} contracts`);
    } catch (e) {
      console.warn('⚠️ EVM state load failed:', e.message);
    }
  }
}
