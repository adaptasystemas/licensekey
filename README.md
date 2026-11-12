# Módulo de licenciamento mensal

Controla a licença mensal de lojas que usam o sistema: chave por loja, período de teste, carência, modo "somente consulta" e cobrança por Pix (Mercado Pago) com renovação automática.

## Pastas
- `servidor/` — vai no projeto Supabase **central do fornecedor**: `supabase-licencas.sql` (tabelas) e a função `licenca` (Verify JWT desligado).
- `painel/` — página do fornecedor: lojas, vencimentos, cobrança, bloqueio, cortesia, planos.
- `cliente/lic-client.js` — bloco que fica dentro de cada app (Sistema, PDV, Catálogo), entre `/*LIC-BEGIN` e `/*LIC-END*/`. Ligue definindo `LIC_URL` (e `LIC_PUB`); `LIC_OBRIG=true` na versão vendida.
- `loja/supabase-v51.sql` — roda no banco de **cada loja** (guarda chave e resposta assinada).

## Instalação
1. Projeto Supabase novo (central) > SQL Editor > rodar `servidor/supabase-licencas.sql`.
2. Criar a Edge Function `licenca` com `servidor/supabase/functions/licenca/index.ts`, **Verify JWT desligado**.
3. Segredos da função: `LIC_ADMIN_EMAILS` (e-mails dos administradores), `MP_ACCESS_TOKEN` (Mercado Pago) e, opcional, `MP_PAYER_EMAIL`. Nunca versionar segredos.
4. No Mercado Pago, webhook: `https://SEU-PROJETO.supabase.co/functions/v1/licenca?hook=1`.
5. Authentication: criar o usuário administrador (mesmo e-mail do passo 3).
6. Publicar `painel/` (GitHub Pages ou outro), informar URL do projeto e chave **anon**; "Servidor" mostra a chave pública e a URL da função.
7. Nos apps: preencher `LIC_URL` e `LIC_PUB`; rodar `loja/supabase-v51.sql` no banco da loja.
8. No painel, criar a loja e colar a chave em Empresa > Licença do Sistema.

## Regras padrão (editáveis em Planos)
Teste 14 dias, carência 5 dias, depois somente consulta (não registra venda nem emite nota; recebimento de parcelas continua). Funciona até 10 dias sem internet. Fatura Pix gerada 7 dias antes do vencimento.

## Segurança
A resposta do servidor é assinada (ECDSA P-256); a chave privada fica só no servidor. Token de outra loja ou alterado é rejeitado.

## Aviso
Testado apenas de forma simulada; faça um pagamento real de teste antes de vender. Contrato de licença e nota fiscal da mensalidade exigem advogado e contador.
