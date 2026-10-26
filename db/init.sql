create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  amount_cents integer not null check (amount_cents > 0),
  status text not null default 'pending' check (status in ('pending','paid','failed')),
  payment_ref text,
  created_at timestamptz not null default now()
);

create index if not exists orders_created_at_idx on orders (created_at desc);
create index if not exists orders_status_idx on orders (status);