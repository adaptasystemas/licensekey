/*LIC-BEGIN v1 — verificação da licença mensal (igual no Sistema, no PDV e no Catálogo; edite aqui e copie para os três)*/
const LIC_URL='';      /* endereço da função de licenças, ex.: https://SEU-PROJETO-CENTRAL.supabase.co/functions/v1/licenca — vazio = licenciamento desligado */
const LIC_PUB='';      /* chave pública do servidor (JSON). Vazia = aprende da função na primeira conexão */
const LIC_OBRIG=false; /* true na versão vendida: sem chave válida = somente consulta */
const LIC=(()=>{
  const KC='lic_key',KT='lic_tok',KP='lic_pub',KM='lic_maxt',KF='lic_first',KI='lic_meta',enc=new TextEncoder();
  const g=k=>{try{return localStorage.getItem(k)}catch(e){return null}},s=(k,v)=>{try{localStorage.setItem(k,v)}catch(e){}};
  const b64d=t=>Uint8Array.from(atob(t.replace(/-/g,'+').replace(/_/g,'/')+'==='.slice((t.length+3)%4)),c=>c.charCodeAt(0));
  const ymd=ms=>new Date(ms-3*36e5).toISOString().slice(0,10);
  const dd=(a,b)=>Math.round((Date.parse(a+'T12:00:00Z')-Date.parse(b+'T12:00:00Z'))/864e5);
  const br=d=>d?d.split('-').reverse().join('/'):'';
  const norm=k=>String(k||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
  const esc=t=>String(t==null?'':t).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const reais=c=>(c/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  let NOTA='',H={sb:null,app:'app',ver:'',admin:()=>false,onChange:null},S={st:'off'},chave='',tok=null,META={},timer=null,poll=null,busy=null;
  try{META=JSON.parse(g(KI)||'{}')}catch(e){}
  async function kid(k){const h=await crypto.subtle.digest('SHA-256',enc.encode(norm(k)));return Array.from(new Uint8Array(h)).map(x=>x.toString(16).padStart(2,'0')).join('').slice(0,16)}
  async function post(b,ms){
    const c=new AbortController(),t=setTimeout(()=>c.abort(),ms||12000);
    try{const r=await fetch(LIC_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b),signal:c.signal});let j={};try{j=await r.json()}catch(e){}j.__st=r.status;return j}
    finally{clearTimeout(t)}
  }
  async function pubKey(){
    let j=null;if(LIC_PUB){try{j=JSON.parse(LIC_PUB)}catch(e){}}
    if(!j){try{j=JSON.parse(g(KP)||'null')}catch(e){}}
    if(!j){const r=await post({action:'pub'});if(r.ok&&r.pub){j=r.pub;s(KP,JSON.stringify(j))}}
    return j?await crypto.subtle.importKey('jwk',j,{name:'ECDSA',namedCurve:'P-256'},false,['verify']):null;
  }
  async function verify(t,k){ /* devolve os dados do token se a assinatura confere e é desta loja; senão null */
    try{
      if(!t||!k)return null;const[p1,sg]=String(t).split('.');if(!p1||!sg)return null;
      const key=await pubKey();if(!key)return null;
      if(!await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},key,b64d(sg),enc.encode(p1)))return null;
      const p=JSON.parse(new TextDecoder().decode(b64d(p1)));
      return p&&p.kid===await kid(k)?p:null;
    }catch(e){return null}
  }
  function now(p){ /* o relógio do computador nunca volta atrás do que já foi visto nem da hora do servidor */
    let n=Date.now();const m=+g(KM)||0;if(m>n)n=m;if(p&&p.iat*1000>n)n=p.iat*1000;if(n>m)s(KM,String(n));return n;
  }
  function calc(p,hasKey){
    if(!LIC_URL)return{st:'off'};
    if(!hasKey)return{st:'sem_chave'};
    if(!p){
      const f=+g(KF)||0;if(!f)s(KF,String(Date.now()));
      return(f&&Date.now()-f>3*864e5)?{st:'consulta',msg:'Não foi possível conferir a licença há mais de 3 dias. Conecte à internet.',stale:true}:{st:'sem_verif'};
    }
    const n=now(p),h=ymd(n),o={loja:p.loja,ate:p.ate,car:p.car,dias:dd(p.ate,h),iat:p.iat};
    if(p.st==='isenta')return{...o,st:'isenta'};
    if(p.st==='bloqueada')return{...o,st:'bloqueada'};
    if(n-p.iat*1000>(p.off||10)*864e5)return{...o,st:'consulta',stale:true,msg:'A licença não é conferida há mais de '+(p.off||10)+' dias. Conecte à internet.'};
    if(h<=p.ate)return{...o,st:o.dias<=5?'aviso':(p.st==='teste'?'teste':'ok')};
    if(h<=p.car)return{...o,st:'carencia'};
    return{...o,st:'consulta'};
  }
  function msg(){
    const x=S;
    if(x.st==='aviso')return{k:'warn',t:x.dias<=0?'Sua licença vence hoje.':'Sua licença vence em '+x.dias+' dia'+(x.dias>1?'s':'')+' ('+br(x.ate)+').',pay:1};
    if(x.st==='carencia')return{k:'bad',t:'Licença vencida em '+br(x.ate)+'. Pague até '+br(x.car)+' para continuar vendendo normalmente.',pay:1};
    if(x.st==='consulta')return{k:'bad',t:x.msg||'Licença vencida. O sistema está em modo somente consulta (não registra venda nem emite nota) até pagar a mensalidade.',pay:!x.stale};
    if(x.st==='bloqueada')return{k:'bad',t:'Licença bloqueada. Fale com o suporte.',pay:0};
    if(x.st==='sem_verif')return{k:'warn',t:'Não foi possível conferir a licença agora. Conecte à internet.',pay:0};
    if(x.st==='sem_chave'&&LIC_OBRIG)return{k:'bad',t:'Informe a chave de licença para usar o sistema.',pay:0};
    if(x.st==='chave_invalida')return{k:LIC_OBRIG?'bad':'warn',t:'A chave de licença não foi reconhecida. Confira com o suporte.',pay:0};
    return null;
  }
  const pode=()=>!(S.st==='consulta'||S.st==='bloqueada'||((S.st==='sem_chave'||S.st==='chave_invalida')&&LIC_OBRIG));
  function emit(){bar();try{H.onChange&&H.onChange(S,pode())}catch(e){}}
  async function load(){ /* chave e resposta guardadas */
    let c=null;try{const r=await H.sb.rpc('lic_get');if(!r.error)c=r.data||{}}catch(e){}
    if(c){if(c.chave)s(KC,c.chave);else try{localStorage.removeItem(KC)}catch(e){}}else c={chave:g(KC)||''};
    chave=c.chave||'';const a=g(KT),b=c.token;let best=null,bp=null;
    for(const t of[a,b]){const p=await verify(t,chave);if(p&&(!bp||p.iat>bp.iat)){best=t;bp=p}}
    tok=best;return bp;
  }
  async function check(){
    const r=await post({action:'check',chave,app:H.app,ver:H.ver});
    if(r.ok&&r.token){
      const p=await verify(r.token,chave);
      if(p){tok=r.token;s(KT,tok);s(KI,JSON.stringify(META={loja:r.loja,plano:r.plano,preco:r.preco_centavos,fatura:r.fatura}));try{await H.sb.rpc('lic_put_token',{p:tok})}catch(e){}return 1}
    }
    if(r.__st===404)return -1;
    return 0;
  }
  async function refresh(force){
    if(busy)return busy;
    return busy=(async()=>{
      try{
        if(!LIC_URL||!H.sb){S={st:'off'};emit();return S}
        let p=await load();
        if(!chave){S=calc(null,false);emit();return S}
        if(force||!p||Date.now()-p.iat*1000>6*36e5){
          let r=0;try{r=await check()}catch(e){r=0}
          if(r===-1){S={st:'chave_invalida'};emit();return S}
          if(r===1)p=await verify(tok,chave);
        }
        S=calc(p,true);emit();return S;
      }finally{busy=null}
    })();
  }
  /* ---------- aviso e janela (independentes do visual de cada app) ---------- */
  function css(){
    if(document.getElementById('lic-css'))return;
    const st=document.createElement('style');st.id='lic-css';
    st.textContent='#licbar{position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:9000;max-width:min(94vw,760px);display:flex;gap:10px;align-items:center;padding:10px 14px;border-radius:12px;font:600 14px/1.35 system-ui,Segoe UI,Arial,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.28);border:1px solid rgba(0,0,0,.15)}'+
    '#licbar.warn{background:#fff4d6;color:#5c3d00}#licbar.bad{background:#fde7e7;color:#7a1410}#licbar button{flex:none;border:0;border-radius:9px;padding:8px 12px;font:700 13px system-ui,Segoe UI,Arial;cursor:pointer;background:#123a6b;color:#fff}'+
    '#licov{position:fixed;inset:0;z-index:9500;background:rgba(10,15,30,.55);display:flex;align-items:center;justify-content:center;padding:14px}'+
    '#licbox{background:var(--card,#fff);color:var(--ink,#101828);border:1px solid var(--line,#d0d5dd);border-radius:16px;width:min(94vw,460px);max-height:92vh;overflow:auto;padding:18px;font:15px/1.45 system-ui,Segoe UI,Arial,sans-serif}'+
    '#licbox h2{margin:0 0 4px;font-size:19px}#licbox .m{color:var(--mut,#667085);font-size:13px}#licbox .r{display:flex;justify-content:space-between;gap:10px;padding:7px 0;border-bottom:1px solid var(--line,#d0d5dd)}'+
    '#licbox input{width:100%;box-sizing:border-box;padding:10px;border:1px solid var(--line,#d0d5dd);border-radius:10px;font:15px system-ui;background:transparent;color:inherit;margin:6px 0}'+
    '#licbox .b{border:0;border-radius:10px;padding:10px 14px;font:700 14px system-ui;cursor:pointer;background:#123a6b;color:#fff;margin:6px 6px 0 0}#licbox .b.g{background:transparent;color:inherit;border:1px solid var(--line,#d0d5dd)}'+
    '#licbox .tg{display:inline-block;padding:2px 9px;border-radius:99px;font-size:12px;font-weight:700}#licbox img{width:200px;height:200px;image-rendering:pixelated;background:#fff;border-radius:8px;display:block;margin:8px auto}';
    document.head.appendChild(st);
  }
  function bar(){
    if(typeof document==='undefined'||!document.body)return;
    css();let b=document.getElementById('licbar');const m=msg();
    if(!m){if(b)b.remove();return}
    if(!b){b=document.createElement('div');b.id='licbar';b.setAttribute('role','status');document.body.appendChild(b)}
    b.className=m.k;b.innerHTML='<span>'+esc(m.t)+'</span><button type="button">'+(m.pay?'Ver / pagar':'Detalhes')+'</button>';
    b.querySelector('button').onclick=()=>open();
  }
  const NOME={off:'Desligada',ok:'Ativa',teste:'Período de teste',aviso:'Ativa (vence em breve)',carencia:'Vencida (em carência)',consulta:'Vencida (somente consulta)',bloqueada:'Bloqueada',isenta:'Isenta',sem_chave:'Sem chave',sem_verif:'Sem conferência',chave_invalida:'Chave não reconhecida'};
  const COR={ok:'#d1fadf;color:#05603a',teste:'#d1e9ff;color:#175cd3',aviso:'#fef0c7;color:#93370d',carencia:'#fee4e2;color:#b42318',consulta:'#fee4e2;color:#b42318',bloqueada:'#fee4e2;color:#b42318',isenta:'#d1fadf;color:#05603a'};
  function close(){const o=document.getElementById('licov');if(o)o.remove();if(poll){clearInterval(poll);poll=null}}
  function open(nota){
    if(!LIC_URL)return;NOTA=nota||'';close();css();
    const o=document.createElement('div');o.id='licov';o.onclick=e=>{if(e.target===o)close()};
    o.innerHTML='<div id="licbox" role="dialog" aria-modal="true" aria-label="Licença"></div>';document.body.appendChild(o);view();
  }
  function view(msgOk){
    const bx=document.getElementById('licbox');if(!bx)return;
    const x=S,m=msg(),adm=!!H.admin(),pagar=!!(META.preco>0)&&x.st!=='isenta'&&x.st!=='bloqueada'&&x.st!=='sem_chave'&&x.st!=='chave_invalida';
    bx.innerHTML='<h2>Licença</h2><div class="m">'+esc(META.loja||'')+(META.plano?' · plano '+esc(META.plano):'')+'</div>'+
    (NOTA?'<p style="background:#fff4d6;color:#5c3d00;padding:10px;border-radius:10px;font-weight:700">'+esc(NOTA)+'</p>':'')+(msgOk?'<p style="background:#d1fadf;color:#05603a;padding:10px;border-radius:10px;font-weight:700">'+esc(msgOk)+'</p>':'')+
    '<div style="margin:10px 0"><span class="tg" style="background:'+(COR[x.st]||'#eaecf0;color:#344054')+'">'+esc(NOME[x.st]||x.st)+'</span></div>'+
    (x.ate?'<div class="r"><span>Válida até</span><b>'+br(x.ate)+'</b></div>':'')+
    (x.car&&x.st!=='isenta'?'<div class="r"><span>Carência até</span><b>'+br(x.car)+'</b></div>':'')+
    (META.preco>0&&x.st!=='isenta'?'<div class="r"><span>Mensalidade</span><b>'+reais(META.preco)+'</b></div>':'')+
    (x.iat?'<div class="r"><span>Última conferência</span><b>'+new Date(x.iat*1000).toLocaleString('pt-BR')+'</b></div>':'')+
    (m?'<p style="margin:10px 0 0">'+esc(m.t)+'</p>':'')+
    '<div id="licpix"></div>'+
    (adm?'<label style="display:block;margin-top:12px;font-weight:700;font-size:13px">Chave de licença</label><input id="lic_k" placeholder="XXXXX-XXXXX-XXXXX-XXXXX" autocomplete="off" value="'+esc(chave)+'"><button class="b g" type="button" id="lic_sv">Salvar chave</button>':'')+
    '<div style="margin-top:8px">'+(pagar?'<button class="b" type="button" id="lic_pg">Pagar mensalidade (Pix)</button>':'')+'<button class="b g" type="button" id="lic_vf">Verificar agora</button><button class="b g" type="button" id="lic_x">Fechar</button></div>'+
    '<p class="m" id="lic_e" role="alert" style="color:#b42318"></p>';
    const $=i=>bx.querySelector('#'+i),err=t=>{const e=$('lic_e');if(e)e.textContent=t||''};
    $('lic_x').onclick=close;
    $('lic_vf').onclick=async()=>{err('');$('lic_vf').textContent='Verificando…';await refresh(true);view(S.st==='sem_verif'?'':'')};
    if($('lic_sv'))$('lic_sv').onclick=async()=>{
      err('');const v=$('lic_k').value.trim();
      try{const{error}=await H.sb.rpc('lic_set_chave',{p:v});if(error)throw error}catch(e){return err('Não foi possível salvar a chave: '+(e.message||e))}
      tok=null;try{localStorage.removeItem(KT);localStorage.removeItem(KF)}catch(e){}
      await refresh(true);view(chave?'Chave salva.':'')
    };
    if($('lic_pg'))$('lic_pg').onclick=async()=>{
      err('');$('lic_pg').disabled=true;$('lic_pg').textContent='Gerando…';
      let r;try{r=await post({action:'fatura',chave},20000)}catch(e){r={ok:false,erro:'Sem conexão com o servidor de licenças.'}}
      if(!r.ok){$('lic_pg').disabled=false;$('lic_pg').textContent='Pagar mensalidade (Pix)';return err(r.erro||'Não foi possível gerar o Pix.')}
      const f=r.fatura;$('lic_pg').remove();
      $('licpix').innerHTML='<div style="text-align:center;margin-top:10px"><b>'+reais(f.valor_centavos)+'</b><div class="m">Pague pelo app do seu banco. A licença renova sozinha.</div>'+
        (f.qr_base64?'<img alt="QR Code Pix" src="data:image/png;base64,'+esc(f.qr_base64)+'">':'')+
        '<input readonly id="lic_cc" value="'+esc(f.qr_code)+'"><button class="b" type="button" id="lic_cp">Copiar código Pix</button><div class="m" id="lic_ps">Aguardando o pagamento…</div></div>';
      $('lic_cp').onclick=async()=>{try{await navigator.clipboard.writeText(f.qr_code)}catch(e){$('lic_cc').select();document.execCommand('copy')}$('lic_cp').textContent='Copiado ✓'};
      if(poll)clearInterval(poll);
      let n=0;poll=setInterval(async()=>{
        n++;if(n>180||!document.getElementById('licov')){clearInterval(poll);poll=null;return}
        try{const q=await post({action:'fatura_status',chave,id:f.id},10000);
          if(q.ok&&q.status==='paga'){clearInterval(poll);poll=null;if(q.token&&await verify(q.token,chave)){tok=q.token;s(KT,tok);try{await H.sb.rpc('lic_put_token',{p:tok})}catch(e){}}
            await refresh(true);view('Pagamento confirmado! Licença renovada até '+br(S.ate)+'.')}}catch(e){}
      },4000);
    };
  }
  function init(o){
    H={...H,...o};if(!LIC_URL||!H.sb)return;
    refresh(false);
    if(!timer){timer=setInterval(()=>refresh(false),30*60*1000);
      window.addEventListener('online',()=>refresh(false));
      document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh(false)})}
  }
  return{init,refresh,open,close,pode,state:()=>S,msg,
    guard(op){if(pode())return true;open('Modo somente consulta: '+(op||'esta ação')+' volta a funcionar quando a licença estiver em dia.');return false},
    _t:{calc,verify,ymd,dd,setKey:k=>{chave=k},setTok:t=>{tok=t}}};
})();
/*LIC-END*/
