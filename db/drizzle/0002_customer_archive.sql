alter table customers
  add column if not exists archived_at timestamptz;

create index if not exists customers_mode_archived_at_idx
  on customers (mode, archived_at);
