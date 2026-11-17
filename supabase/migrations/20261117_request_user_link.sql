-- Restore/refresh the invite RPC without touching existing finance records.
-- Run this in the Supabase SQL Editor when request_user_link is missing from
-- the PostgREST schema cache.
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
    return query select existing.id,existing.invite_code,target_id,
      (select p.email from public.profiles p where p.id=target_id),existing.status;
    return;
  end if;
  new_code:=upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
  insert into public.user_links(user_a,user_b,inviter_id,invitee_id,invite_code)
    values(pair_a,pair_b,current_id,target_id,new_code)
    returning * into existing;
  return query select existing.id,existing.invite_code,target_id,
    (select p.email from public.profiles p where p.id=target_id),existing.status;
end;
$$;

revoke all on function public.request_user_link(text) from public;
grant execute on function public.request_user_link(text) to authenticated;
notify pgrst, 'reload schema';
