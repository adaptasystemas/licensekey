-- v51 — Licença mensal no banco da LOJA (Sistema, PDV e Catálogo).
-- Rode ANTES de publicar o Sistema 1.92.0 / PDV 1.31.0 / Catálogo 1.12.0. Pode rodar de novo sem estragar nada.
-- A chave de licença e a última resposta assinada ficam em app_settings (chave 'licenca'); ninguém sem login lê isso.

alter table company add column if not exists lic_bloq boolean default false;   -- o Sistema marca true quando a loja está em "somente consulta"; o Catálogo usa para pausar pedidos

-- lê chave + última resposta assinada (qualquer usuário logado da loja: o PDV precisa)
create or replace function lic_get() returns jsonb
language sql security definer set search_path = public stable as $$
  select coalesce((select value from app_settings where key = 'licenca'), '{}'::jsonb)
$$;
revoke all on function lic_get() from public;
grant execute on function lic_get() to authenticated;

-- só o administrador troca a chave
create or replace function lic_set_chave(p text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Só o administrador pode trocar a chave de licença.'; end if;
  insert into app_settings(key, value) values ('licenca', jsonb_build_object('chave', coalesce(trim(p), '')))
  on conflict (key) do update set value = jsonb_build_object('chave', coalesce(trim(p), '')) , updated_at = now();
end $$;
revoke all on function lic_set_chave(text) from public;
grant execute on function lic_set_chave(text) to authenticated;

-- guarda a resposta assinada do servidor (o app confere a assinatura; um token falso não vale nada)
create or replace function lic_put_token(p text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Faça login.'; end if;
  insert into app_settings(key, value) values ('licenca', jsonb_build_object('token', p))
  on conflict (key) do update set value = coalesce(app_settings.value, '{}'::jsonb) || jsonb_build_object('token', p), updated_at = now();
end $$;
revoke all on function lic_put_token(text) from public;
grant execute on function lic_put_token(text) to authenticated;

-- marca/desmarca "somente consulta" para o Catálogo (só administrador)
create or replace function lic_flag(p boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then return; end if;
  update company set lic_bloq = coalesce(p, false) where id = 1 and lic_bloq is distinct from coalesce(p, false);
end $$;
revoke all on function lic_flag(boolean) from public;
grant execute on function lic_flag(boolean) to authenticated;
