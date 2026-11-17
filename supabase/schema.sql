-- Execute no SQL Editor do projeto Supabase.
create table if not exists public.transactions (
  id text not null,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date date not null,
  description text not null,
  amount numeric(12,2) not null check (amount >= 0),
  category text not null default 'Outros',
  bank text not null,
  method text not null check (method in ('credit', 'debit')),
  installment_group_id text,
  installment_number smallint,
  installment_count smallint,
  installment_total numeric(12,2),
  created_at timestamptz not null default now(),
  primary key (user_id, id),
  check (installment_number is null or installment_number between 1 and 24),
  check (installment_count is null or installment_count between 1 and 24)
);

create table if not exists public.budgets (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  month text not null check (month ~ '^[0-9]{4}-[0-9]{2}$'),
  monthly_budget numeric(12,2) not null default 3200 check (monthly_budget >= 0),
  closing_day smallint not null default 1 check (closing_day between 1 and 31),
  daily_safety_threshold numeric(12,2) not null default 40 check (daily_safety_threshold >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, month)
);

create table if not exists public.accounts (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id text not null,
  name text not null,
  account_label text not null default 'Conta/Pix',
  account_balance numeric(12,2) not null default 0,
  credit_limit numeric(12,2) not null default 0,
  color text not null default '#9CA3AF',
  secondary_color text not null default '#9CA3AF',
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

alter table public.transactions enable row level security;
alter table public.budgets enable row level security;
alter table public.accounts enable row level security;

grant select, insert, update, delete on public.transactions, public.budgets, public.accounts to authenticated;

drop policy if exists "Owners manage transactions" on public.transactions;
create policy "Owners manage transactions" on public.transactions for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "Owners manage budgets" on public.budgets;
create policy "Owners manage budgets" on public.budgets for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "Owners manage accounts" on public.accounts;
create policy "Owners manage accounts" on public.accounts for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create index if not exists transactions_user_date_idx on public.transactions (user_id, date desc);
create index if not exists transactions_installment_group_idx on public.transactions (user_id, installment_group_id);

-- Canal privado por usuário. Ele envia apenas um evento de invalidação; o cliente
-- relê os dados pelas consultas protegidas pelas políticas RLS acima.
drop policy if exists "Users receive their finance broadcasts" on realtime.messages;
create policy "Users receive their finance broadcasts" on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and (select realtime.topic()) = ('user:' || (select auth.uid())::text || ':finance')
  );

create or replace function public.broadcast_finance_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.broadcast_changes(
    'user:' || coalesce(NEW.user_id, OLD.user_id)::text || ':finance',
    TG_OP,
    TG_OP,
    TG_TABLE_NAME,
    TG_TABLE_SCHEMA,
    NEW,
    OLD
  );
  return null;
end;
$$;

drop trigger if exists finance_changes on public.transactions;
create trigger finance_changes after insert or update or delete on public.transactions
  for each row execute function public.broadcast_finance_change();
drop trigger if exists finance_changes on public.budgets;
create trigger finance_changes after insert or update or delete on public.budgets
  for each row execute function public.broadcast_finance_change();
drop trigger if exists finance_changes on public.accounts;
create trigger finance_changes after insert or update or delete on public.accounts
  for each row execute function public.broadcast_finance_change();
