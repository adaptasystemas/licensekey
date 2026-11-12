-- ============================================================================================
-- SERVIDOR DE LICENÇAS (projeto Supabase CENTRAL, do fornecedor do sistema — NÃO é o banco de uma loja)
-- Rode UMA vez no SQL Editor do projeto central. Pode rodar de novo sem estragar nada.
-- Todas as tabelas ficam com segurança ligada e SEM política: só a função "licenca" (chave de serviço) lê e grava.
-- ============================================================================================

create extension if not exists pgcrypto;

-- Planos (mensalidade). Valores em centavos.
create table if not exists lic_plans(
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  preco_centavos int not null check (preco_centavos >= 0),
  dias_teste int not null default 14 check (dias_teste between 0 and 90),
  dias_carencia int not null default 5 check (dias_carencia between 0 and 30),
  off_dias int not null default 10 check (off_dias between 1 and 60),   -- quantos dias o app aceita ficar sem conferir a licença (sem internet)
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

-- Lojas clientes
create table if not exists lic_clientes(
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  cnpj text,
  contato text,
  fone text,
  email text,
  chave text not null unique,                     -- a chave de licença que a loja digita no Sistema
  plan_id uuid references lic_plans(id) on delete set null,
  situacao text not null default 'auto' check (situacao in ('auto','bloqueada','isenta')),
  inicio date not null default current_date,
  teste_ate date,                                 -- fim do período de teste
  vence_em date,                                  -- pago até (inclusive)
  obs text,
  ultimo_check timestamptz,
  ultimo_app text,
  ultima_versao text,
  created_at timestamptz not null default now()
);

-- Cobranças mensais
create table if not exists lic_faturas(
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references lic_clientes(id) on delete cascade,
  ref text not null,                              -- mês que a cobrança passa a cobrir (AAAA-MM)
  valor_centavos int not null check (valor_centavos > 0),
  status text not null default 'pendente' check (status in ('pendente','paga','cancelada')),
  venc date not null,
  mp_payment_id text,
  qr_code text,
  qr_base64 text,
  expira_em timestamptz,
  paga_em timestamptz,
  forma text,
  created_at timestamptz not null default now()
);
create unique index if not exists lic_faturas_unica on lic_faturas(cliente_id, ref) where status <> 'cancelada';
create index if not exists lic_faturas_cli on lic_faturas(cliente_id, created_at desc);
create index if not exists lic_faturas_mp on lic_faturas(mp_payment_id);

-- Histórico
create table if not exists lic_eventos(
  id bigserial primary key,
  cliente_id uuid references lic_clientes(id) on delete cascade,
  tipo text not null,
  detalhe jsonb,
  em timestamptz not null default now()
);
create index if not exists lic_eventos_cli on lic_eventos(cliente_id, em desc);

-- Chave de assinatura (a função cria sozinha na primeira vez; a parte privada NUNCA sai daqui)
create table if not exists lic_segredos(
  chave text primary key,
  valor text not null
);

alter table lic_plans enable row level security;
alter table lic_clientes enable row level security;
alter table lic_faturas enable row level security;
alter table lic_eventos enable row level security;
alter table lic_segredos enable row level security;

-- Plano inicial (você muda o preço no painel)
insert into lic_plans(nome, preco_centavos, dias_teste, dias_carencia, off_dias)
select 'Completo', 9900, 14, 5, 10
where not exists (select 1 from lic_plans);
