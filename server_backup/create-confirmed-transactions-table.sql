
-- جدول المعاملات المؤكدة في البلوك تشين
CREATE TABLE IF NOT EXISTS blockchain_transactions (
  id SERIAL PRIMARY KEY,
  tx_hash VARCHAR(66) UNIQUE NOT NULL,
  from_address VARCHAR(42) NOT NULL,
  to_address VARCHAR(42) NOT NULL,
  amount DECIMAL(20,8) NOT NULL,
  timestamp BIGINT NOT NULL,
  block_hash VARCHAR(66),
  block_index INTEGER,
  nonce INTEGER DEFAULT 0,
  gas_used BIGINT DEFAULT 21000,
  gas_price DECIMAL(20,8) DEFAULT 0.00002,
  chain_id VARCHAR(10) DEFAULT '0x5968',
  network_id VARCHAR(10) DEFAULT '22888',
  is_confirmed BOOLEAN DEFAULT false,
  confirmations INTEGER DEFAULT 0,
  is_external BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- إضافة فهارس لتحسين الأداء
CREATE INDEX IF NOT EXISTS idx_blockchain_tx_hash ON blockchain_transactions(tx_hash);
CREATE INDEX IF NOT EXISTS idx_blockchain_from_address ON blockchain_transactions(from_address);
CREATE INDEX IF NOT EXISTS idx_blockchain_to_address ON blockchain_transactions(to_address);
CREATE INDEX IF NOT EXISTS idx_blockchain_confirmed ON blockchain_transactions(is_confirmed);
CREATE INDEX IF NOT EXISTS idx_blockchain_timestamp ON blockchain_transactions(timestamp);
