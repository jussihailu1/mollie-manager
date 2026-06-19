CREATE TYPE customer_note_source AS ENUM (
  'operator',
  'legacy_customer_notes'
);

CREATE TABLE customer_notes (
  id text PRIMARY KEY,
  mode mollie_mode NOT NULL,
  customer_id text NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  body text NOT NULL,
  source customer_note_source NOT NULL DEFAULT 'operator',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT customer_notes_body_not_blank_check
    CHECK (length(btrim(body)) > 0)
);

CREATE INDEX customer_notes_customer_created_idx
  ON customer_notes (customer_id, created_at DESC);

INSERT INTO customer_notes (
  id,
  mode,
  customer_id,
  body,
  source,
  created_at,
  updated_at
)
SELECT
  concat('legacy-customer-note:', c.id),
  c.mode,
  c.id,
  btrim(c.notes),
  'legacy_customer_notes',
  coalesce(c.created_at, now()),
  now()
FROM customers c
WHERE nullif(btrim(c.notes), '') IS NOT NULL
ON CONFLICT (id) DO NOTHING;
