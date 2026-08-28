-- Schema cho indexer: chuẩn hoá event on-chain vào Postgres.
-- Mọi bảng đều có chain_id ngay từ đầu để tránh phải migrate đau đớn khi mở rộng multichain (GĐ5).
-- Unique constraint (chain_id, tx_hash, log_index) giúp việc ghi event là idempotent (an toàn khi reprocess).

CREATE TABLE IF NOT EXISTS deposits (
    id BIGSERIAL PRIMARY KEY,
    chain_id INTEGER NOT NULL,
    tx_hash TEXT NOT NULL,
    log_index INTEGER NOT NULL,
    block_number BIGINT NOT NULL,
    block_timestamp TIMESTAMPTZ NOT NULL,
    vault_address TEXT NOT NULL,
    sender_address TEXT NOT NULL,
    owner_address TEXT NOT NULL,
    assets NUMERIC(78, 0) NOT NULL,
    shares NUMERIC(78, 0) NOT NULL,
    confirmed BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT deposits_chain_tx_log_unique UNIQUE (chain_id, tx_hash, log_index)
);

CREATE INDEX IF NOT EXISTS idx_deposits_chain_block ON deposits (chain_id, block_number);
CREATE INDEX IF NOT EXISTS idx_deposits_owner ON deposits (chain_id, owner_address);
CREATE INDEX IF NOT EXISTS idx_deposits_confirmed ON deposits (confirmed);

CREATE TABLE IF NOT EXISTS withdrawals (
    id BIGSERIAL PRIMARY KEY,
    chain_id INTEGER NOT NULL,
    tx_hash TEXT NOT NULL,
    log_index INTEGER NOT NULL,
    block_number BIGINT NOT NULL,
    block_timestamp TIMESTAMPTZ NOT NULL,
    vault_address TEXT NOT NULL,
    sender_address TEXT NOT NULL,
    receiver_address TEXT NOT NULL,
    owner_address TEXT NOT NULL,
    assets NUMERIC(78, 0) NOT NULL,
    shares NUMERIC(78, 0) NOT NULL,
    confirmed BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT withdrawals_chain_tx_log_unique UNIQUE (chain_id, tx_hash, log_index)
);

CREATE INDEX IF NOT EXISTS idx_withdrawals_chain_block ON withdrawals (chain_id, block_number);
CREATE INDEX IF NOT EXISTS idx_withdrawals_owner ON withdrawals (chain_id, owner_address);
CREATE INDEX IF NOT EXISTS idx_withdrawals_confirmed ON withdrawals (confirmed);

-- Gộp các event dạng "trạng thái/quản trị chiến lược" (StrategyManagerSet, StrategyRegistered,
-- ActiveStrategyChanged) vào một bảng chung, phân biệt nhau qua event_name + payload JSONB.
CREATE TABLE IF NOT EXISTS strategy_events (
    id BIGSERIAL PRIMARY KEY,
    chain_id INTEGER NOT NULL,
    tx_hash TEXT NOT NULL,
    log_index INTEGER NOT NULL,
    block_number BIGINT NOT NULL,
    block_timestamp TIMESTAMPTZ NOT NULL,
    contract_address TEXT NOT NULL,
    event_name TEXT NOT NULL,
    payload JSONB NOT NULL,
    confirmed BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT strategy_events_chain_tx_log_unique UNIQUE (chain_id, tx_hash, log_index)
);

CREATE INDEX IF NOT EXISTS idx_strategy_events_chain_block ON strategy_events (chain_id, block_number);
CREATE INDEX IF NOT EXISTS idx_strategy_events_name ON strategy_events (event_name);
CREATE INDEX IF NOT EXISTS idx_strategy_events_confirmed ON strategy_events (confirmed);

-- Theo dõi tiến độ quét block theo từng (chain_id, contract_address) để watcher có thể
-- resume đúng chỗ sau khi restart, tránh bỏ sót hoặc quét trùng.
CREATE TABLE IF NOT EXISTS indexer_cursors (
    chain_id INTEGER NOT NULL,
    contract_address TEXT NOT NULL,
    last_scanned_block BIGINT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (chain_id, contract_address)
);
