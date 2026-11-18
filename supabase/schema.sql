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
  payer_id uuid references auth.users(id) on delete cascade,
  shared_with_user_id uuid references auth.users(id) on delete set null,
  payer_share numeric(12,2),
  shared_share numeric(12,2) not null default 0 check (shared_share >= 0),
  settled_at timestamptz,
  settled_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (user_id, id),
  check (installment_number is null or installment_number between 1 and 24),
  check (installment_count is null or installment_count between 1 and 24)
);

alter table public.transactions add column if not exists payer_id uuid references auth.users(id) on delete cascade;
alter table public.transactions add column if not exists shared_with_user_id uuid references auth.users(id) on delete set null;
alter table public.transactions add column if not exists payer_share numeric(12,2);
alter table public.transactions add column if not exists shared_share numeric(12,2) not null default 0;
alter table public.transactions add column if not exists settled_at timestamptz;
alter table public.transactions add column if not exists settled_by uuid references auth.users(id) on delete set null;
update public.transactions set payer_id = user_id where payer_id is null;
update public.transactions set payer_share = amount where payer_share is null;
alter table public.transactions alter column payer_id set default auth.uid();
alter table public.transactions alter column payer_id set not null;
alter table public.transactions alter column payer_share set not null;
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid='public.transactions'::regclass and conname='transactions_split_total_check') then
    alter table public.transactions add constraint transactions_split_total_check
      check (payer_share >= 0 and shared_share >= 0 and payer_share + shared_share = amount);
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.transactions'::regclass and conname='transactions_shared_share_requires_partner_check') then
    alter table public.transactions add constraint transactions_shared_share_requires_partner_check
      check (shared_with_user_id is not null or shared_share = 0);
  end if;
end $$;

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
drop policy if exists "Participants read transactions" on public.transactions;
drop policy if exists "Payers create transactions" on public.transactions;
drop policy if exists "Payers update transactions" on public.transactions;
drop policy if exists "Payers delete transactions" on public.transactions;
create policy "Participants read transactions" on public.transactions for select to authenticated
  using ((select auth.uid()) = user_id or (select auth.uid()) = shared_with_user_id);
create policy "Payers create transactions" on public.transactions for insert to authenticated
  with check ((select auth.uid()) = user_id and (select auth.uid()) = payer_id);
create policy "Payers update transactions" on public.transactions for update to authenticated
  using ((select auth.uid()) = user_id and (select auth.uid()) = payer_id)
  with check ((select auth.uid()) = user_id and (select auth.uid()) = payer_id);
create policy "Payers delete transactions" on public.transactions for delete to authenticated
  using ((select auth.uid()) = user_id and (select auth.uid()) = payer_id);
drop policy if exists "Owners manage budgets" on public.budgets;
create policy "Owners manage budgets" on public.budgets for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "Owners manage accounts" on public.accounts;
create policy "Owners manage accounts" on public.accounts for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create index if not exists transactions_user_date_idx on public.transactions (user_id, date desc);
create index if not exists transactions_installment_group_idx on public.transactions (user_id, installment_group_id);
create index if not exists transactions_shared_user_date_idx on public.transactions (shared_with_user_id, date desc);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  display_name text not null default '',
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
grant select on public.profiles to authenticated;
drop policy if exists "Users read own profile" on public.profiles;
create policy "Users read own profile" on public.profiles for select to authenticated
  using ((select auth.uid()) = id);

create or replace function public.sync_auth_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id,email,display_name)
  values (new.id,lower(new.email),coalesce(new.raw_user_meta_data->>'full_name',''))
  on conflict (id) do update set email=excluded.email,
    display_name=coalesce(nullif(excluded.display_name,''),public.profiles.display_name);
  return new;
end;
$$;
drop trigger if exists sync_auth_profile on auth.users;
create trigger sync_auth_profile after insert or update of email,raw_user_meta_data on auth.users
  for each row execute function public.sync_auth_profile();
insert into public.profiles (id,email,display_name)
  select id,lower(email),coalesce(raw_user_meta_data->>'full_name','') from auth.users
  where email is not null
  on conflict (id) do update set email=excluded.email,
    display_name=coalesce(nullif(excluded.display_name,''),public.profiles.display_name);

create table if not exists public.user_links (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references auth.users(id) on delete cascade,
  user_b uuid not null references auth.users(id) on delete cascade,
  inviter_id uuid not null references auth.users(id) on delete cascade,
  invitee_id uuid not null references auth.users(id) on delete cascade,
  invite_code text not null unique,
  status text not null default 'pending' check (status in ('pending','accepted')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  check (user_a < user_b),
  check (inviter_id <> invitee_id),
  unique (user_a,user_b)
);
alter table public.user_links enable row level security;
grant select on public.user_links to authenticated;
drop policy if exists "Users view their links" on public.user_links;
create policy "Users view their links" on public.user_links for select to authenticated
  using ((select auth.uid()) = inviter_id or (select auth.uid()) = invitee_id);

create or replace function public.request_user_link(target_email text)
returns table(link_id uuid, invite_code text, partner_id uuid, partner_email text, link_status text)
language plpgsql security definer set search_path = '' as $$
declare
  current_id uuid := auth.uid();
  target_id uuid;
  new_code text;
  pair_a uuid;
  pair_b uuid;
  existing public.user_links%rowtype;
begin
  if current_id is null then raise exception 'Authentication required'; end if;
  select p.id into target_id from public.profiles p where p.email=lower(trim(target_email));
  if target_id is null then raise exception 'Não encontramos uma conta com esse e-mail.'; end if;
  if target_id=current_id then raise exception 'Você não pode vincular sua própria conta.'; end if;
  pair_a:=least(current_id,target_id); pair_b:=greatest(current_id,target_id);
  select * into existing from public.user_links l where l.user_a=pair_a and l.user_b=pair_b;
  if found then
    if existing.status='pending' and existing.inviter_id<>current_id then
      return query select existing.id,existing.invite_code,target_id,(select p.email from public.profiles p where p.id=target_id),existing.status;
      return;
    end if;
    if existing.status='pending' and existing.inviter_id=current_id then
      return query select existing.id,existing.invite_code,target_id,(select p.email from public.profiles p where p.id=target_id),existing.status;
      return;
    end if;
    if existing.status='accepted' then
      return query select existing.id,existing.invite_code,target_id,(select p.email from public.profiles p where p.id=target_id),existing.status;
      return;
    end if;
  end if;
  new_code:=upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
  insert into public.user_links(user_a,user_b,inviter_id,invitee_id,invite_code)
    values(pair_a,pair_b,current_id,target_id,new_code)
    returning * into existing;
  return query select existing.id,existing.invite_code,target_id,(select p.email from public.profiles p where p.id=target_id),existing.status;
end;
$$;
revoke all on function public.request_user_link(text) from public;
grant execute on function public.request_user_link(text) to authenticated;

create or replace function public.accept_user_link(code text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare link_id uuid;
begin
  update public.user_links l set status='accepted',accepted_at=now()
  where upper(l.invite_code)=upper(trim(code)) and l.invitee_id=auth.uid() and l.status='pending'
  returning l.id into link_id;
  if link_id is null then raise exception 'Código inválido ou convite não pertence a esta conta.'; end if;
  return link_id;
end;
$$;
revoke all on function public.accept_user_link(text) from public;
grant execute on function public.accept_user_link(text) to authenticated;

create or replace function public.list_user_links()
returns table(id uuid, partner_id uuid, partner_email text, partner_name text, status text, invited_by uuid, invite_code text)
language sql stable security definer set search_path = '' as $$
  select l.id,other.id,other.email,other.display_name,l.status,l.inviter_id,l.invite_code
  from public.user_links l
  join public.profiles other on other.id=case when l.inviter_id=auth.uid() then l.invitee_id else l.inviter_id end
  where l.inviter_id=auth.uid() or l.invitee_id=auth.uid()
  order by l.created_at desc
$$;
revoke all on function public.list_user_links() from public;
grant execute on function public.list_user_links() to authenticated;

create or replace function public.validate_transaction_split_link()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.shared_with_user_id is not null and not exists (
    select 1 from public.user_links l
    where l.status='accepted'
      and l.user_a=least(new.payer_id,new.shared_with_user_id)
      and l.user_b=greatest(new.payer_id,new.shared_with_user_id)
  ) then
    raise exception 'A divisão exige um vínculo aceito entre os usuários.';
  end if;
  return new;
end;
$$;
drop trigger if exists validate_transaction_split_link on public.transactions;
create trigger validate_transaction_split_link before insert or update of payer_id,shared_with_user_id,payer_share,shared_share,amount
  on public.transactions for each row execute function public.validate_transaction_split_link();

create or replace function public.settle_shared_transaction(p_transaction_id text)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare settled_time timestamptz;
begin
  update public.transactions t set settled_at=now(),settled_by=auth.uid()
  where t.id=p_transaction_id and t.shared_with_user_id is not null
    and auth.uid() in (t.payer_id,t.shared_with_user_id)
  returning t.settled_at into settled_time;
  if settled_time is null then raise exception 'Transação compartilhada não encontrada para esta conta.'; end if;
  return settled_time;
end;
$$;
revoke all on function public.settle_shared_transaction(text) from public;
grant execute on function public.settle_shared_transaction(text) to authenticated;

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
declare owner_user uuid; partner_user uuid; previous_partner uuid;
begin
  if TG_OP='DELETE' then
    owner_user:=OLD.user_id;
    if TG_TABLE_NAME='transactions' then partner_user:=OLD.shared_with_user_id; end if;
  else
    owner_user:=NEW.user_id;
    if TG_TABLE_NAME='transactions' then partner_user:=NEW.shared_with_user_id; end if;
    if TG_OP='UPDATE' and TG_TABLE_NAME='transactions' then previous_partner:=OLD.shared_with_user_id; end if;
  end if;
  perform realtime.broadcast_changes(
    'user:' || owner_user::text || ':finance',
    TG_OP,
    TG_OP,
    TG_TABLE_NAME,
    TG_TABLE_SCHEMA,
    NEW,
    OLD
  );
  if partner_user is not null and partner_user<>owner_user then
    perform realtime.broadcast_changes(
      'user:' || partner_user::text || ':finance',TG_OP,TG_OP,TG_TABLE_NAME,TG_TABLE_SCHEMA,NEW,OLD
    );
  end if;
  if previous_partner is not null and previous_partner<>owner_user and previous_partner is distinct from partner_user then
    perform realtime.broadcast_changes(
      'user:' || previous_partner::text || ':finance',TG_OP,TG_OP,TG_TABLE_NAME,TG_TABLE_SCHEMA,NEW,OLD
    );
  end if;
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

create or replace function public.broadcast_user_link_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare first_user uuid; second_user uuid;
begin
  if TG_OP='DELETE' then first_user:=OLD.inviter_id; second_user:=OLD.invitee_id;
  else first_user:=NEW.inviter_id; second_user:=NEW.invitee_id; end if;
  perform realtime.broadcast_changes('user:'||first_user::text||':finance',TG_OP,TG_OP,TG_TABLE_NAME,TG_TABLE_SCHEMA,NEW,OLD);
  if second_user<>first_user then
    perform realtime.broadcast_changes('user:'||second_user::text||':finance',TG_OP,TG_OP,TG_TABLE_NAME,TG_TABLE_SCHEMA,NEW,OLD);
  end if;
  return null;
end;
$$;
drop trigger if exists user_link_changes on public.user_links;
create trigger user_link_changes after insert or update or delete on public.user_links
  for each row execute function public.broadcast_user_link_change();

-- Contas fixas recorrentes e pagamentos registrados no histórico.
alter table public.transactions add column if not exists fixed_expense_id text;
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
create index if not exists fixed_expenses_user_month_idx on public.fixed_expenses (user_id,start_month,end_month);
drop trigger if exists finance_changes on public.fixed_expenses;
create trigger finance_changes after insert or update or delete on public.fixed_expenses
  for each row execute function public.broadcast_finance_change();

notify pgrst, 'reload schema';
