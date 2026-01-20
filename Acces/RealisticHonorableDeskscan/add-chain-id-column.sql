
-- إضافة عمود chain_id إلى جدول transactions
DO $$
BEGIN
  -- إضافة عمود chain_id إذا لم يكن موجود
  IF NOT EXISTS (
    SELECT FROM information_schema.columns 
    WHERE table_name = 'transactions' AND column_name = 'chain_id'
  ) THEN
    ALTER TABLE transactions ADD COLUMN chain_id VARCHAR(10) DEFAULT '0x5968';
    RAISE NOTICE 'نجح: تم إضافة عمود chain_id إلى جدول transactions';
  ELSE
    RAISE NOTICE 'معلومة: عمود chain_id موجود مسبقاً';
  END IF;

  -- إضافة عمود network_id إذا لم يكن موجود
  IF NOT EXISTS (
    SELECT FROM information_schema.columns 
    WHERE table_name = 'transactions' AND column_name = 'network_id'
  ) THEN
    ALTER TABLE transactions ADD COLUMN network_id VARCHAR(10) DEFAULT '22888';
    RAISE NOTICE 'نجح: تم إضافة عمود network_id إلى جدول transactions';
  ELSE
    RAISE NOTICE 'معلومة: عمود network_id موجود مسبقاً';
  END IF;

  -- إضافة فهرس للأداء
  CREATE INDEX IF NOT EXISTS idx_transactions_chain_id 
  ON transactions(chain_id);

  CREATE INDEX IF NOT EXISTS idx_transactions_network_id 
  ON transactions(network_id);
END
$$;
