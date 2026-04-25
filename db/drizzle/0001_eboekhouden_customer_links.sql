DO $$ BEGIN
  CREATE TYPE eboekhouden_link_status AS ENUM (
    'linked',
    'unlinked',
    'needs_review',
    'sync_error'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS eboekhouden_relation_id integer,
  ADD COLUMN IF NOT EXISTS eboekhouden_relation_code text,
  ADD COLUMN IF NOT EXISTS eboekhouden_link_status eboekhouden_link_status NOT NULL DEFAULT 'unlinked',
  ADD COLUMN IF NOT EXISTS eboekhouden_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS eboekhouden_relation_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS customers_mode_eboekhouden_relation_id_key
  ON customers (mode, eboekhouden_relation_id);

CREATE INDEX IF NOT EXISTS customers_mode_eboekhouden_link_status_idx
  ON customers (mode, eboekhouden_link_status);
