// Função "licenca": servidor de licenças mensais dos sistemas (roda no projeto Supabase CENTRAL do fornecedor).
// Segredos (supabase secrets set / painel Edge Functions > Secrets):
//   LIC_ADMIN_EMAILS   = e-mail(s) que podem usar o painel do fornecedor, separados por vírgula
//   MP_ACCESS_TOKEN    = Access Token de PRODUÇÃO do Mercado Pago do fornecedor (só para gerar a cobrança Pix da mensalidade)
//   MP_PAYER_EMAIL     = (opcional) e-mail usado quando a loja não tem e-mail cadastrado
// SUPABASE_URL, SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY já existem no Supabase.
// Publique com Verify JWT DESLIGADO (as lojas e o Mercado Pago chamam sem login). As ações do painel conferem o login sozinhas.
// A resposta de "check" vem ASSINADA (ECDSA P-256): o app confere com a chave pública e não aceita resposta forjada.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (d: unknown, status = 200) =>
  new Response(JSON.stringify(d), { status, headers: { ...cors, "Content-Type": "application/json" } });

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const enc = new TextEncoder();
const MP = "https://api.mercadopago.com";

// ---------- utilidades ----------
const b64u = (b: ArrayBuffer | Uint8Array) => {
  const u = b instanceof Uint8Array ? b : new Uint8Array(b);
  let s = ""; for (const x of u) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const b64d = (t: string) => {
  const s = atob(t.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((t.length + 3) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const sha = async (t: string) => hex(await crypto.subtle.digest("SHA-256", enc.encode(t)));
const normChave = (k: unknown) => String(k || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const fmtChave = (k: string) => k.match(/.{1,5}/g)!.join("-");
function novaChave() {
  const al = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sem 0/O/1/I para não confundir na digitação
  const r = crypto.getRandomValues(new Uint8Array(20));
  return fmtChave([...r].map((x) => al[x % al.length]).join(""));
}
const todayBrt = () => new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
const addDays = (ymd: string, n: number) => { const d = new Date(ymd + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const diffDays = (a: string, b: string) => Math.round((new Date(a + "T12:00:00Z").getTime() - new Date(b + "T12:00:00Z").getTime()) / 864e5);
function addMonths(ymd: string, n: number) {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = m - 1 + n, ny = y + Math.floor(t / 12), nm = ((t % 12) + 12) % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${ny}-${String(nm + 1).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}
const maxYmd = (a: string, b: string) => (a > b ? a : b);
function brt(d: Date) {
  const x = new Date(d.getTime() - 3 * 3600 * 1000), p = (n: number, l = 2) => String(n).padStart(l, "0");
  return `${x.getUTCFullYear()}-${p(x.getUTCMonth() + 1)}-${p(x.getUTCDate())}T${p(x.getUTCHours())}:${p(x.getUTCMinutes())}:${p(x.getUTCSeconds())}.000-03:00`;
}
async function ev(cliente_id: string | null, tipo: string, detalhe: unknown = {}) {
  try { await db.from("lic_eventos").insert({ cliente_id, tipo, detalhe }); } catch (_) { /* histórico é só informativo */ }
}

// ---------- assinatura ----------
type KeyPair = { priv: CryptoKey; pubJwk: JsonWebKey };
let kp: KeyPair | null = null;
async function keys(criar = false): Promise<KeyPair | null> {
  if (kp) return kp;
  const { data } = await db.from("lic_segredos").select("chave,valor").in("chave", ["priv_pkcs8", "pub_jwk"]);
  const m: Record<string, string> = {}; for (const r of data || []) m[r.chave] = r.valor;
  if (!m.priv_pkcs8 || !m.pub_jwk) {
    if (!criar) return null;
    const g = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    m.priv_pkcs8 = b64u(await crypto.subtle.exportKey("pkcs8", g.privateKey));
    m.pub_jwk = JSON.stringify(await crypto.subtle.exportKey("jwk", g.publicKey));
    // "ignore duplicates": se duas chamadas correrem juntas, vale a primeira gravada
    await db.from("lic_segredos").upsert([{ chave: "priv_pkcs8", valor: m.priv_pkcs8 }, { chave: "pub_jwk", valor: m.pub_jwk }], { onConflict: "chave", ignoreDuplicates: true });
    const { data: d2 } = await db.from("lic_segredos").select("chave,valor").in("chave", ["priv_pkcs8", "pub_jwk"]);
    for (const r of d2 || []) m[r.chave] = r.valor;
  }
  const priv = await crypto.subtle.importKey("pkcs8", b64d(m.priv_pkcs8), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  kp = { priv, pubJwk: JSON.parse(m.pub_jwk) };
  return kp;
}
async function assinar(payload: Record<string, unknown>) {
  const k = await keys(true);
  const p1 = b64u(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, k!.priv, enc.encode(p1));
  return p1 + "." + b64u(sig);
}

// ---------- estado da licença ----------
type Plano = { id: string; nome: string; preco_centavos: number; dias_teste: number; dias_carencia: number; off_dias: number } | null;
type Cli = Record<string, any>;
function estado(c: Cli, pl: Plano, hoje = todayBrt()) {
  const car = pl?.dias_carencia ?? 5, off = pl?.off_dias ?? 10;
  const ate: string = c.vence_em && c.teste_ate ? maxYmd(c.vence_em, c.teste_ate) : (c.vence_em || c.teste_ate || addDays(c.inicio || hoje, pl?.dias_teste ?? 14));
  const carAte = addDays(ate, car);
  let st: string;
  if (c.situacao === "isenta") st = "isenta";
  else if (c.situacao === "bloqueada") st = "bloqueada";
  else if (hoje <= ate) st = c.vence_em && c.vence_em >= hoje ? "ativa" : "teste";
  else if (hoje <= carAte) st = "carencia";
  else st = "vencida";
  return { st, ate, car: carAte, dias: diffDays(ate, hoje), off };
}
async function planoDe(c: Cli): Promise<Plano> {
  if (!c.plan_id) { const { data } = await db.from("lic_plans").select("*").eq("ativo", true).order("created_at").limit(1); return (data?.[0] as Plano) || null; }
  const { data } = await db.from("lic_plans").select("*").eq("id", c.plan_id).maybeSingle();
  return (data as Plano) || null;
}
async function emitirToken(c: Cli, pl: Plano) {
  const e = estado(c, pl);
  return await assinar({
    v: 1, kid: (await sha(normChave(c.chave))).slice(0, 16), st: e.st, ate: e.ate, car: e.car, off: e.off,
    loja: c.nome, preco: pl?.preco_centavos ?? 0, iat: Math.floor(Date.now() / 1000),
  });
}

// ---------- cobrança mensal (Mercado Pago, Pix) ----------
async function mp(path: string, init: RequestInit = {}) {
  const t = Deno.env.get("MP_ACCESS_TOKEN");
  if (!t) throw new Error("MP_ACCESS_TOKEN não configurado na função.");
  return await fetch(MP + path, {
    ...init, signal: AbortSignal.timeout(25000),
    headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
}
const faturaPub = (f: Cli) => ({
  id: f.id, ref: f.ref, valor_centavos: f.valor_centavos, venc: f.venc, status: f.status,
  qr_code: f.qr_code, qr_base64: f.qr_base64, expira_em: f.expira_em, paga_em: f.paga_em,
});
// Garante UMA cobrança pendente e válida; reaproveita a que já existe.
async function garantirFatura(c: Cli, pl: Plano): Promise<{ ok: true; fatura: Cli } | { ok: false; erro: string }> {
  const preco = pl?.preco_centavos ?? 0;
  if (preco <= 0) return { ok: false, erro: "O plano desta loja não tem valor de mensalidade." };
  const { data: abertas } = await db.from("lic_faturas").select("*").eq("cliente_id", c.id).eq("status", "pendente").order("created_at", { ascending: false });
  const ok = (abertas || []).find((f) => f.qr_code && f.expira_em && new Date(f.expira_em).getTime() > Date.now() + 36 * 3600 * 1000 && f.valor_centavos === preco);
  if (ok) return { ok: true, fatura: ok };
  for (const f of abertas || []) await db.from("lic_faturas").update({ status: "cancelada" }).eq("id", f.id).eq("status", "pendente");
  if (!Deno.env.get("MP_ACCESS_TOKEN")) return { ok: false, erro: "Mercado Pago não configurado no servidor de licenças (falta MP_ACCESS_TOKEN)." };
  const hoje = todayBrt();
  const base = maxYmd(c.vence_em || c.teste_ate || hoje, hoje), novo = addMonths(base, 1), ref = novo.slice(0, 7);
  const id = crypto.randomUUID(), expira = new Date(Date.now() + 7 * 864e5);
  const { error: e1 } = await db.from("lic_faturas").insert({ id, cliente_id: c.id, ref, valor_centavos: preco, status: "pendente", venc: base, expira_em: expira.toISOString() });
  if (e1) return { ok: false, erro: /duplicate|unique/i.test(e1.message) ? `Já existe uma cobrança paga para ${ref}. Use "Dar cortesia" se quiser estender o prazo.` : "Não foi possível criar a cobrança: " + e1.message };
  const email = String(c.email || "").includes("@") ? c.email : (Deno.env.get("MP_PAYER_EMAIL") || "licencas@example.com");
  const body = {
    transaction_amount: Math.round(preco) / 100, description: `Mensalidade ${String(pl?.nome || "")} - ${c.nome}`.slice(0, 80),
    payment_method_id: "pix", payer: { email, first_name: String(c.nome || "Cliente").split(" ")[0].slice(0, 40) },
    date_of_expiration: brt(expira), notification_url: `${Deno.env.get("SUPABASE_URL")}/functions/v1/licenca?hook=1`, external_reference: "lic:" + id,
  };
  let p: any = {}, r: Response;
  try { r = await mp("/v1/payments", { method: "POST", headers: { "X-Idempotency-Key": id }, body: JSON.stringify(body) }); p = await r.json().catch(() => ({})); }
  catch (e) { await db.from("lic_faturas").delete().eq("id", id); return { ok: false, erro: "Mercado Pago não respondeu. Tente de novo." }; }
  const td = p?.point_of_interaction?.transaction_data || {};
  if (!r.ok || !p?.id || !td.qr_code) {
    await db.from("lic_faturas").delete().eq("id", id);
    return { ok: false, erro: "O Mercado Pago recusou: " + (p?.message || p?.cause?.[0]?.description || ("HTTP " + r.status)) };
  }
  const { data: f } = await db.from("lic_faturas").update({ mp_payment_id: String(p.id), qr_code: td.qr_code, qr_base64: td.qr_code_base64 || null }).eq("id", id).select("*").single();
  await ev(c.id, "fatura_criada", { id, ref, valor_centavos: preco });
  return { ok: true, fatura: f };
}
// Marca como paga UMA vez e renova a licença (um mês a partir do fim do período atual ou de hoje, o que for maior)
async function marcarPaga(f: Cli, forma: string, pagaEm?: string) {
  const { data: up } = await db.from("lic_faturas").update({ status: "paga", paga_em: pagaEm || new Date().toISOString(), forma }).eq("id", f.id).eq("status", "pendente").select("*");
  if (!up?.length) return false; // outro aviso já tratou
  const { data: c } = await db.from("lic_clientes").select("*").eq("id", f.cliente_id).single();
  const hoje = todayBrt(), base = maxYmd(c.vence_em || c.teste_ate || hoje, hoje), novo = addMonths(base, 1);
  await db.from("lic_clientes").update({ vence_em: novo }).eq("id", c.id);
  await ev(c.id, "paga", { fatura: f.id, ref: f.ref, forma, vence_em: novo });
  return true;
}
async function syncFatura(f: Cli) {
  if (f.status !== "pendente" || !f.mp_payment_id) return f;
  try {
    const r = await mp("/v1/payments/" + encodeURIComponent(f.mp_payment_id));
    if (!r.ok) return f;
    const p = await r.json();
    if (String(p.external_reference || "") !== "lic:" + f.id) return f;
    if (String(p.status) === "approved" && Math.abs(Number(p.transaction_amount || 0) * 100 - f.valor_centavos) < 1) {
      await marcarPaga(f, "pix mp", p.date_approved || undefined);
    } else if (String(p.status) === "cancelled" || String(p.status) === "rejected") {
      await db.from("lic_faturas").update({ status: "cancelada" }).eq("id", f.id).eq("status", "pendente");
    }
  } catch (_) { /* tenta na próxima */ }
  const { data } = await db.from("lic_faturas").select("*").eq("id", f.id).single();
  return data || f;
}

// ---------- ações públicas (a loja, pela chave) ----------
async function porChave(chave: unknown) {
  const k = normChave(chave);
  if (k.length < 10) return null;
  const { data } = await db.from("lic_clientes").select("*").eq("chave", fmtChave(k)).maybeSingle();
  return (data as Cli) || null;
}
async function acaoCheck(b: Record<string, any>) {
  const c = await porChave(b.chave);
  if (!c) return json({ ok: false, erro: "Chave de licença inválida." }, 404);
  const pl = await planoDe(c);
  const upd: Record<string, unknown> = { ultimo_check: new Date().toISOString() };
  if (b.app) upd.ultimo_app = String(b.app).slice(0, 20);
  if (b.ver) upd.ultima_versao = String(b.ver).slice(0, 20);
  // primeiro contato: o teste começa agora
  if (!c.teste_ate && !c.vence_em) { upd.teste_ate = addDays(todayBrt(), pl?.dias_teste ?? 14); c.teste_ate = upd.teste_ate; }
  await db.from("lic_clientes").update(upd).eq("id", c.id);
  const e = estado(c, pl);
  // a cobrança do mês fica pronta uns 7 dias antes (ou já em atraso), sem a loja precisar pedir
  let fat: Cli | null = null;
  if (c.situacao === "auto" && (pl?.preco_centavos ?? 0) > 0 && e.dias <= 7) {
    try { const g = await garantirFatura(c, pl); if (g.ok) fat = g.fatura; } catch (_) { /* a loja ainda consegue pedir depois */ }
  }
  return json({
    ok: true, token: await emitirToken(c, pl), estado: e, loja: c.nome, plano: pl?.nome || "", preco_centavos: pl?.preco_centavos ?? 0,
    fatura: fat ? { id: fat.id, valor_centavos: fat.valor_centavos, venc: fat.venc } : null,
  });
}
async function acaoFatura(b: Record<string, any>) {
  const c = await porChave(b.chave);
  if (!c) return json({ ok: false, erro: "Chave de licença inválida." }, 404);
  if (c.situacao === "isenta") return json({ ok: false, erro: "Esta loja é isenta de mensalidade." }, 422);
  const pl = await planoDe(c);
  const g = await garantirFatura(c, pl);
  if (!g.ok) return json({ ok: false, erro: g.erro }, 422);
  return json({ ok: true, fatura: faturaPub(g.fatura) });
}
async function acaoFaturaStatus(b: Record<string, any>) {
  const c = await porChave(b.chave);
  if (!c) return json({ ok: false, erro: "Chave de licença inválida." }, 404);
  const { data: f } = await db.from("lic_faturas").select("*").eq("id", String(b.id || "")).eq("cliente_id", c.id).maybeSingle();
  if (!f) return json({ ok: false, erro: "Cobrança não encontrada." }, 404);
  const nf = await syncFatura(f);
  const out: Record<string, unknown> = { ok: true, status: nf.status };
  if (nf.status === "paga") { const { data: c2 } = await db.from("lic_clientes").select("*").eq("id", c.id).single(); out.token = await emitirToken(c2, await planoDe(c2)); }
  return json(out);
}
async function acaoHook(req: Request, url: URL) {
  let id = url.searchParams.get("data.id") || url.searchParams.get("id") || "";
  try { const b = await req.clone().json(); id = String(b?.data?.id || b?.id || id || ""); } catch (_) { /* sem corpo */ }
  if (!id) return json({ ok: true });
  try {
    const r = await mp("/v1/payments/" + encodeURIComponent(id));
    if (r.ok) {
      const p = await r.json(), ref = String(p.external_reference || "");
      if (ref.startsWith("lic:")) {
        const { data: f } = await db.from("lic_faturas").select("*").eq("id", ref.slice(4)).maybeSingle();
        if (f && String(f.mp_payment_id) === String(p.id)) await syncFatura(f);
      }
    }
  } catch (_) { /* o Mercado Pago repete o aviso */ }
  return json({ ok: true });
}

// ---------- ações do painel (só e-mails de LIC_ADMIN_EMAILS) ----------
async function adminEmail(req: Request): Promise<string | null> {
  const t = (req.headers.get("authorization") || "").replace(/^Bearer /i, "");
  if (!t) return null;
  const { data } = await db.auth.getUser(t);
  const em = String(data?.user?.email || "").toLowerCase();
  const ok = (Deno.env.get("LIC_ADMIN_EMAILS") || "").toLowerCase().split(/[,;\s]+/).filter(Boolean);
  return em && ok.includes(em) ? em : null;
}
async function listar() {
  const [{ data: cs }, { data: pls }, { data: fs }] = await Promise.all([
    db.from("lic_clientes").select("*").order("nome"), db.from("lic_plans").select("*").order("created_at"),
    db.from("lic_faturas").select("*").order("created_at", { ascending: false }).limit(500),
  ]);
  const hoje = todayBrt();
  const out = (cs || []).map((c) => {
    const pl = (pls || []).find((p) => p.id === c.plan_id) || (pls || []).find((p) => p.ativo) || null;
    const aberta = (fs || []).find((f) => f.cliente_id === c.id && f.status === "pendente") || null;
    const ultima = (fs || []).find((f) => f.cliente_id === c.id && f.status === "paga") || null;
    return { ...c, estado: estado(c, pl as Plano, hoje), plano: pl?.nome || "", preco_centavos: pl?.preco_centavos ?? 0, fatura_aberta: aberta ? faturaPub(aberta) : null, ultima_paga: ultima ? { ref: ultima.ref, paga_em: ultima.paga_em } : null };
  });
  return { clientes: out, planos: pls || [] };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = new URL(req.url);
  try {
    if (url.searchParams.get("hook") === "1") return await acaoHook(req, url);
    if (req.method !== "POST") return json({ ok: false, erro: "Use POST." }, 405);
    const b = await req.json().catch(() => ({})) as Record<string, any>;
    const a = String(b.action || "");

    // públicas
    if (a === "pub") { const k = await keys(false); return k ? json({ ok: true, pub: k.pubJwk }) : json({ ok: false, erro: "Servidor de licenças ainda sem chave de assinatura." }, 503); }
    if (a === "check") return await acaoCheck(b);
    if (a === "fatura") return await acaoFatura(b);
    if (a === "fatura_status") return await acaoFaturaStatus(b);

    // painel
    const adm = await adminEmail(req);
    if (!adm) return json({ ok: false, erro: Deno.env.get("LIC_ADMIN_EMAILS") ? "Este usuário não é administrador de licenças." : "Defina o segredo LIC_ADMIN_EMAILS na função." }, 403);

    if (a === "admin_init") { const k = await keys(true); return json({ ok: true, pub: k!.pubJwk, mp: !!Deno.env.get("MP_ACCESS_TOKEN"), url: `${Deno.env.get("SUPABASE_URL")}/functions/v1/licenca` }); }
    if (a === "listar") return json({ ok: true, ...(await listar()) });

    if (a === "plano_salvar") {
      const row = { nome: String(b.nome || "").trim().slice(0, 60), preco_centavos: Math.max(0, Math.round(Number(b.preco_centavos) || 0)), dias_teste: Math.min(90, Math.max(0, Math.round(Number(b.dias_teste) || 0))), dias_carencia: Math.min(30, Math.max(0, Math.round(Number(b.dias_carencia) || 0))), off_dias: Math.min(60, Math.max(1, Math.round(Number(b.off_dias) || 10))) };
      if (!row.nome) return json({ ok: false, erro: "Dê um nome ao plano." }, 422);
      const q = b.id ? db.from("lic_plans").update(row).eq("id", b.id) : db.from("lic_plans").insert(row);
      const { error } = await q; return error ? json({ ok: false, erro: error.message }, 422) : json({ ok: true });
    }
    if (a === "cliente_salvar") {
      const row: Record<string, unknown> = {
        nome: String(b.nome || "").trim().slice(0, 120), cnpj: String(b.cnpj || "").replace(/\D/g, "").slice(0, 14) || null,
        contato: String(b.contato || "").trim().slice(0, 80) || null, fone: String(b.fone || "").replace(/\D/g, "").slice(0, 15) || null,
        email: String(b.email || "").trim().slice(0, 120) || null, obs: String(b.obs || "").trim().slice(0, 500) || null, plan_id: b.plan_id || null,
      };
      if (!row.nome) return json({ ok: false, erro: "Informe o nome da loja." }, 422);
      if (b.id) { const { error } = await db.from("lic_clientes").update(row).eq("id", b.id); return error ? json({ ok: false, erro: error.message }, 422) : json({ ok: true }); }
      const pl = row.plan_id ? ((await db.from("lic_plans").select("*").eq("id", row.plan_id).maybeSingle()).data as Plano) : await planoDe({});
      const { data, error } = await db.from("lic_clientes").insert({ ...row, chave: novaChave(), teste_ate: addDays(todayBrt(), pl?.dias_teste ?? 14) }).select("*").single();
      if (error) return json({ ok: false, erro: error.message }, 422);
      await ev(data.id, "criado", { por: adm });
      return json({ ok: true, cliente: data });
    }
    if (a === "cliente_acao") {
      const m: Record<string, string> = { bloquear: "bloqueada", liberar: "auto", isentar: "isenta", normal: "auto" };
      if (!m[String(b.acao)]) return json({ ok: false, erro: "Ação desconhecida." }, 422);
      const { error } = await db.from("lic_clientes").update({ situacao: m[String(b.acao)] }).eq("id", b.id);
      if (error) return json({ ok: false, erro: error.message }, 422);
      await ev(b.id, "situacao_" + b.acao, { por: adm }); return json({ ok: true });
    }
    if (a === "cliente_estender") { // cortesia: soma dias ao fim do período atual
      const dias = Math.round(Number(b.dias) || 0);
      if (dias < 1 || dias > 365) return json({ ok: false, erro: "Informe de 1 a 365 dias." }, 422);
      const { data: c } = await db.from("lic_clientes").select("*").eq("id", b.id).single();
      const hoje = todayBrt(), e = estado(c, await planoDe(c), hoje), novo = addDays(maxYmd(e.ate, hoje), dias);
      const upd = c.vence_em && c.vence_em >= (c.teste_ate || "") ? { vence_em: novo } : { teste_ate: novo };
      await db.from("lic_clientes").update(upd).eq("id", c.id);
      await ev(c.id, "estendido", { dias, por: adm, ...upd }); return json({ ok: true });
    }
    if (a === "chave_nova") {
      const k = novaChave(); const { error } = await db.from("lic_clientes").update({ chave: k }).eq("id", b.id);
      if (error) return json({ ok: false, erro: error.message }, 422);
      await ev(b.id, "chave_nova", { por: adm }); return json({ ok: true, chave: k });
    }
    if (a === "fatura_criar") {
      const { data: c } = await db.from("lic_clientes").select("*").eq("id", b.id).single();
      const g = await garantirFatura(c, await planoDe(c));
      return g.ok ? json({ ok: true, fatura: faturaPub(g.fatura) }) : json({ ok: false, erro: g.erro }, 422);
    }
    if (a === "faturas") {
      const { data } = await db.from("lic_faturas").select("*").eq("cliente_id", b.id).order("created_at", { ascending: false }).limit(24);
      const { data: evs } = await db.from("lic_eventos").select("*").eq("cliente_id", b.id).order("em", { ascending: false }).limit(30);
      return json({ ok: true, faturas: (data || []).map(faturaPub), eventos: evs || [] });
    }
    if (a === "fatura_sync") {
      const { data: f } = await db.from("lic_faturas").select("*").eq("id", b.id).single();
      const nf = await syncFatura(f); return json({ ok: true, status: nf.status });
    }
    if (a === "fatura_baixar") { // recebeu por fora (dinheiro, transferência): renova a licença
      const { data: f } = await db.from("lic_faturas").select("*").eq("id", b.id).single();
      if (!f) return json({ ok: false, erro: "Cobrança não encontrada." }, 404);
      const ok = await marcarPaga(f, "baixa manual por " + adm);
      return json({ ok: true, renovado: ok });
    }
    if (a === "fatura_cancelar") {
      await db.from("lic_faturas").update({ status: "cancelada" }).eq("id", b.id).eq("status", "pendente"); return json({ ok: true });
    }
    if (a === "cliente_excluir") {
      const { error } = await db.from("lic_clientes").delete().eq("id", b.id); return error ? json({ ok: false, erro: error.message }, 422) : json({ ok: true });
    }
    return json({ ok: false, erro: "Ação desconhecida." }, 400);
  } catch (e) {
    return json({ ok: false, erro: "Erro no servidor de licenças: " + String((e as Error)?.message || e).slice(0, 200) }, 500);
  }
});
