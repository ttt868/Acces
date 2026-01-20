
-- Add server-time-only columns to users table
DO $$
BEGIN
  -- Add mining_start_time_seconds column (UNIX timestamp in seconds)
  IF NOT EXISTS (
    SELECT FROM information_schema.columns 
    WHERE table_name = 'users' AND column_name = 'mining_start_time_seconds'
  ) THEN
    ALTER TABLE users ADD COLUMN mining_start_time_seconds BIGINT;
  END IF;

  -- Copy existing data for migration (if needed)
  UPDATE users 
  SET mining_start_time_seconds = FLOOR(mining_start_time / 1000)
  WHERE mining_start_time IS NOT NULL 
    AND mining_start_time > 0 
    AND (mining_start_time_seconds IS NULL OR mining_start_time_seconds = 0);

  -- Add index for better performance
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE tablename = 'users' AND indexname = 'idx_users_mining_start_time_seconds'
  ) THEN
    CREATE INDEX idx_users_mining_start_time_seconds ON users(mining_start_time_seconds);
  END IF;
END
$$;
