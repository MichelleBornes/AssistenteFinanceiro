-- Marca compras parceladas no cartão do titular ou no cartão de outra pessoa.
alter table public.transactions
  add column if not exists card_owner text not null default 'mine';

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.transactions'::regclass
      and conname='transactions_card_owner_check'
  ) then
    alter table public.transactions
      add constraint transactions_card_owner_check
      check (card_owner in ('mine','other'));
  end if;
end $$;

notify pgrst,'reload schema';
