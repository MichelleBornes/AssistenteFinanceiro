-- Contas fixas recorrentes e vínculo dos pagamentos com as transações.
alter table public.transactions
  add column if not exists fixed_expense_id text;

create table if not exists public.fixed_expenses (
  id text not null,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  description text not null,
  amount numeric(12,2) not null check (amount > 0),
  category text not null default 'Contas',
  bank text not null,
  method text not null default 'debit' check (method in ('credit','debit')),
  due_day smallint not null default 1 check (due_day between 1 and 31),
  start_month text not null check (start_month ~ '^[0-9]{4}-[0-9]{2}$'),
  end_month text check (end_month is null or end_month ~ '^[0-9]{4}-[0-9]{2}$'),
  created_at timestamptz not null default now(),
  primary key (user_id,id),
  check (end_month is null or end_month >= start_month)
);

alter table public.fixed_expenses enable row level security;
grant select,insert,update,delete on public.fixed_expenses to authenticated;
drop policy if exists "Owners manage fixed expenses" on public.fixed_expenses;
create policy "Owners manage fixed expenses" on public.fixed_expenses for all to authenticated
  using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);

create index if not exists fixed_expenses_user_month_idx
  on public.fixed_expenses (user_id,start_month,end_month);

drop trigger if exists finance_changes on public.fixed_expenses;
create trigger finance_changes after insert or update or delete on public.fixed_expenses
  for each row execute function public.broadcast_finance_change();

notify pgrst,'reload schema';
