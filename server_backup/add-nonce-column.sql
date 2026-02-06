-- إضافة عمود nonce إلى جدول المعاملات
DO $$
BEGIN
  -- إضافة عمود nonce إذا لم يكن موجود
  IF NOT EXISTS (
    SELECT FROM information_schema.columns 
    WHERE table_name = 'blockchain_transactions' AND column_name = 'nonce'
  ) THEN
    ALTER TABLE blockchain_transactions ADD COLUMN nonce BIGINT DEFAULT 0;

    -- إضافة فهرس للأداء
    CREATE INDEX IF NOT EXISTS idx_blockchain_transactions_nonce 
    ON blockchain_transactions(nonce);

    RAISE NOTICE 'نجح: تم إضافة عمود nonce إلى جدول blockchain_transactions';
  ELSE
    RAISE NOTICE 'معلومة: عمود nonce موجود مسبقاً';
  END IF;
END
$$;
-- Add nonce column to blockchain_transactions table
DO $$
BEGIN
  -- Add nonce column if it doesn't exist
  IF NOT EXISTS (
    SELECT FROM information_schema.columns 
    WHERE table_name = 'blockchain_transactions' AND column_name = 'nonce'
  ) THEN
    ALTER TABLE blockchain_transactions ADD COLUMN nonce BIGINT DEFAULT 0;
    RAISE NOTICE 'Added nonce column to blockchain_transactions table';
  END IF;

  -- Add confirmations column if it doesn't exist
  IF NOT EXISTS (
    SELECT FROM information_schema.columns 
    WHERE table_name = 'blockchain_transactions' AND column_name = 'confirmations'
  ) THEN
    ALTER TABLE blockchain_transactions ADD COLUMN confirmations INTEGER DEFAULT 1;
    RAISE NOTICE 'Added confirmations column to blockchain_transactions table';
  END IF;

  -- Add is_confirmed column if it doesn't exist
  IF NOT EXISTS (
    SELECT FROM information_schema.columns 
    WHERE table_name = 'blockchain_transactions' AND column_name = 'is_confirmed'
  ) THEN
    ALTER TABLE blockchain_transactions ADD COLUMN is_confirmed BOOLEAN DEFAULT true;
    RAISE NOTICE 'Added is_confirmed column to blockchain_transactions table';
  END IF;

  -- Add indexes for better performance
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE tablename = 'blockchain_transactions' AND indexname = 'idx_blockchain_transactions_nonce'
  ) THEN
    CREATE INDEX idx_blockchain_transactions_nonce ON blockchain_transactions(nonce);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE tablename = 'blockchain_transactions' AND indexname = 'idx_blockchain_transactions_confirmed'
  ) THEN
    CREATE INDEX idx_blockchain_transactions_confirmed ON blockchain_transactions(is_confirmed);
  END IF;
END
$$;