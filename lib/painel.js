// Painel de pedidos da Mandrágora · /painel
// Protegido pela senha cadastrada no Cloudflare como PAINEL_SENHA.
import { lerPedido, salvarPedido, consultarOrder, statusDe, metodoDe } from './pedidos.js';

const enc = new TextEncoder();
const COOKIE = 'mdg_painel';

async function tokenDe(senha) {
  const chave = await crypto.subtle.importKey('raw', enc.encode(senha), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', chave, enc.encode('painel-mandragora-v1'));
  return [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, '0')).join('');
}
const iguais = (a, b) => {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
};
const cookieDe = (request, nome) =>
  (request.headers.get('cookie') || '').split(';').map(c => c.trim().split('=')).find(([k]) => k === nome)?.[1] || '';

async function logado(request, env) {
  if (!env.PAINEL_SENHA) return false;
  return iguais(cookieDe(request, COOKIE), await tokenDe(env.PAINEL_SENHA));
}

const html = (corpo, status = 200, extra = {}) =>
  new Response(corpo, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex', ...extra } });
const json = (d, status = 200) =>
  new Response(JSON.stringify(d), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export async function rotaPainel(request, env) {
  const url = new URL(request.url);
  const caminho = url.pathname.replace(/\/$/, '');

  if (caminho === '/painel/entrar' && request.method === 'POST') {
    const form = await request.formData().catch(() => null);
    const senha = String(form?.get('senha') || '');
    if (env.PAINEL_SENHA && iguais(senha, env.PAINEL_SENHA)) {
      return new Response(null, { status: 303, headers: {
        location: '/painel',
        'set-cookie': `${COOKIE}=${await tokenDe(env.PAINEL_SENHA)}; Path=/painel; HttpOnly; Secure; SameSite=Strict; Max-Age=${60 * 60 * 24 * 60}`,
      } });
    }
    await new Promise(r => setTimeout(r, 900)); // atrasa tentativas de adivinhar a senha
    return html(paginaLogin('Senha incorreta.'), 401);
  }
  if (caminho === '/painel/sair') {
    return new Response(null, { status: 303, headers: { location: '/painel', 'set-cookie': `${COOKIE}=; Path=/painel; HttpOnly; Secure; SameSite=Strict; Max-Age=0` } });
  }

  if (!env.PAINEL_SENHA) return html(paginaLogin('O painel ainda não tem senha. Cadastre a variável PAINEL_SENHA no Cloudflare.'), 503);
  if (!(await logado(request, env))) {
    return caminho.startsWith('/painel/api/') ? json({ error: 'sessão expirada' }, 401) : html(paginaLogin());
  }

  // ---------- API do painel ----------
  if (caminho === '/painel/api/pedidos' && request.method === 'GET') {
    const chaves = [];
    let cursor;
    do {
      const r = await env.PEDIDOS.list({ prefix: 'pedido:', cursor, limit: 1000 });
      chaves.push(...r.keys.map(k => k.name));
      cursor = r.list_complete ? null : r.cursor;
    } while (cursor && chaves.length < 3000);
    // os mais recentes primeiro (o código do pedido cresce com o tempo)
    chaves.sort().reverse();
    const pedidos = (await Promise.all(chaves.slice(0, 300).map(k => env.PEDIDOS.get(k)))).filter(Boolean).map(v => JSON.parse(v));

    // Confirma no Mercado Pago os pedidos recentes que ainda não aparecem como pagos
    const limite = Date.now() - 3 * 864e5;
    const conferir = pedidos.filter(p => p.status !== 'pago' && p.status !== 'cancelado' && p.mpOrderId && Date.parse(p.criado) > limite).slice(0, 25);
    await Promise.all(conferir.map(async p => {
      try {
        const order = await consultarOrder(env, p.mpOrderId);
        const st = statusDe(order);
        if (st !== p.status) {
          p.status = st;
          if (st === 'pago') { p.pagoEm = new Date().toISOString(); p.metodo = metodoDe(order); p.valorPago = Number(order.total_paid_amount || order.total_amount || p.total); }
          await salvarPedido(env, p);
        }
      } catch (e) { console.log('Painel: não consegui conferir', p.pedido, String(e)); }
    }));
    return json({ pedidos, agora: new Date().toISOString() });
  }

  if (caminho === '/painel/api/entregue' && request.method === 'POST') {
    const b = await request.json().catch(() => ({}));
    const p = await lerPedido(env, String(b.pedido || ''));
    if (!p) return json({ error: 'pedido não encontrado' }, 404);
    p.entregue = Boolean(b.entregue);
    p.entregueEm = p.entregue ? new Date().toISOString() : null;
    await salvarPedido(env, p);
    return json({ ok: true, pedido: p });
  }

  if (caminho === '/painel') return html(PAGINA);
  return json({ error: 'não encontrado' }, 404);
}

// ---------- páginas ----------
const ESTILO = `
:root{--pink:#FF4F91;--pinkd:#E93D7E;--cream:#FFE5AF;--choc:#54251F;--bg:#FFFCF7;--card:#fff;--line:#F2E6D8;--soft:#8C665B;--tp:#FFE6EE;--ok:#1F8A4C;--okbg:#E3F5EA;--warn:#A86400;--warnbg:#FFF2D8}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--choc);font:15px/1.5 Nunito,system-ui,sans-serif}
h1,h2,h3{font-family:Fredoka,Nunito,sans-serif;margin:0;line-height:1.1}
button,.btn{font:800 14px Nunito,sans-serif;border:0;border-radius:999px;min-height:40px;padding:0 16px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px;text-decoration:none}
input{font:16px Nunito,sans-serif;padding:12px 14px;border-radius:14px;border:1.5px solid var(--line);width:100%;color:var(--choc);background:#fff}
:focus-visible{outline:3px solid var(--pink);outline-offset:2px}`;

const FONTES = '<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Fredoka:wght@600;700&family=Nunito:wght@400;600;700;800&display=swap" rel="stylesheet">';

function paginaLogin(erro = '') {
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Painel · Mandrágora</title>${FONTES}
<style>${ESTILO}body{min-height:100vh;display:grid;place-items:center;padding:20px}.box{background:#fff;border:1px solid var(--line);border-radius:24px;padding:28px;width:min(380px,100%);box-shadow:0 20px 50px #54251F14}
h1{font-size:28px;margin-bottom:4px}p{color:var(--soft);margin:0 0 18px}.err{color:#C0244F;font-weight:800;margin:10px 0 0}form{display:grid;gap:12px}button{background:var(--pink);color:#fff;min-height:48px}</style></head>
<body><div class="box"><h1>Painel de pedidos</h1><p>Mandrágora Doces</p>
<form method="post" action="/painel/entrar"><input type="password" name="senha" placeholder="Senha" autocomplete="current-password" required autofocus><button>Entrar</button></form>
${erro ? `<p class="err">${erro}</p>` : ''}</div></body></html>`;
}

const PAGINA = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Pedidos · Mandrágora</title>${FONTES}
<style>${ESTILO}
header{position:sticky;top:0;z-index:5;background:#FFFCF7ee;backdrop-filter:blur(8px);border-bottom:1px solid var(--line)}
.top{max-width:980px;margin:0 auto;padding:12px 16px;display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.top h1{font-size:22px;margin-right:auto}.top small{display:block;font:700 12px Nunito,sans-serif;color:var(--soft)}
.ghost{background:var(--tp);color:var(--pink)}.out{background:transparent;color:var(--soft);padding:0 8px}
.tabs{max-width:980px;margin:0 auto;padding:0 16px 12px;display:flex;gap:8px;overflow-x:auto}
.tab{background:#F5E8E1;color:var(--choc);white-space:nowrap}.tab[aria-pressed=true]{background:var(--choc);color:#fff}.tab b{font-size:12px;opacity:.75}
main{max-width:980px;margin:0 auto;padding:16px;display:grid;gap:14px}
.day{font:700 13px Nunito,sans-serif;color:var(--soft);margin:8px 2px 0;text-transform:capitalize}
.ped{background:#fff;border:1px solid var(--line);border-radius:20px;padding:16px 18px;display:grid;gap:10px}
.ped.done{opacity:.6}
.l1{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.l1 h3{font-size:20px;margin-right:auto}
.chip{font:800 12px Nunito,sans-serif;padding:4px 10px;border-radius:999px;white-space:nowrap}
.pago{background:var(--okbg);color:var(--ok)}.aguardando{background:var(--warnbg);color:var(--warn)}.cancelado{background:#F3E9E6;color:var(--soft)}.ent{background:var(--tp);color:var(--pink)}
.meta{display:flex;gap:6px 16px;flex-wrap:wrap;font-size:14px;color:var(--soft)}.meta b{color:var(--choc)}
.itens{white-space:pre-line;background:#FFFAF3;border-radius:14px;padding:10px 12px;font-size:14px;line-height:1.6}
.addr{font-size:14px}.obs{font-size:14px;background:var(--warnbg);border-radius:12px;padding:8px 12px}
.act{display:flex;gap:8px;flex-wrap:wrap}.wa{background:#1F8A4C;color:#fff}.done-btn{background:var(--tp);color:var(--pink)}.undo{background:#F5E8E1;color:var(--choc)}
.empty{text-align:center;color:var(--soft);padding:40px 10px}
.erro{background:#FDE3EA;color:#C0244F;border-radius:14px;padding:12px 14px;font-weight:700}
.total{font:700 18px Fredoka,sans-serif;white-space:nowrap}
</style></head><body>
<header><div class="top"><div><h1>Pedidos</h1><small id="upd">carregando…</small></div>
<button class="ghost" id="reload" type="button">Atualizar</button><a class="btn out" href="/painel/sair">Sair</a></div>
<div class="tabs" id="tabs"></div></header>
<main id="lista"><p class="empty">Carregando pedidos…</p></main>
<script>
{
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const brl = n => Number(n||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const dia = d => d ? new Date(d+'T12:00:00').toLocaleDateString('pt-BR',{weekday:'long',day:'2-digit',month:'2-digit'}) : 'sem data';
const hora = iso => iso ? new Date(iso).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}) : '';
const ABAS = [
 ['preparar','A preparar', p => p.status==='pago' && !p.entregue],
 ['aguardando','Aguardando pagamento', p => p.status==='aguardando'],
 ['entregues','Entregues', p => p.status==='pago' && p.entregue],
 ['todos','Todos', () => true],
];
let aba = 'preparar', pedidos = [];
const wa = n => { const d = String(n||'').replace(/\\D/g,''); return d ? 'https://wa.me/' + (d.length<=11 ? '55' : '') + d : ''; };
function desenhar(){
 $('tabs').innerHTML = ABAS.map(([id,nome,f]) => '<button class="btn tab" data-aba="'+id+'" aria-pressed="'+(id===aba)+'">'+nome+' <b>'+pedidos.filter(f).length+'</b></button>').join('');
 const f = ABAS.find(a => a[0]===aba)[2];
 let lista = pedidos.filter(f);
 if (aba==='preparar') lista.sort((a,b) => (a.data||'').localeCompare(b.data||'') || (a.criado||'').localeCompare(b.criado||''));
 if (!lista.length) { $('lista').innerHTML = '<p class="empty">Nenhum pedido aqui por enquanto.</p>'; return; }
 let ultimoDia = '';
 $('lista').innerHTML = lista.map(p => {
  let cab = '';
  if (aba==='preparar' && p.data !== ultimoDia) { ultimoDia = p.data; cab = '<p class="day">Para '+esc(dia(p.data))+'</p>'; }
  const st = p.status==='pago' ? '<span class="chip pago">Pago'+(p.metodo?' · '+esc(p.metodo):'')+'</span>' : p.status==='cancelado' ? '<span class="chip cancelado">Não pago</span>' : '<span class="chip aguardando">Aguardando pagamento</span>';
  const ent = p.entregue ? '<span class="chip ent">Entregue</span>' : '';
  const link = wa(p.whatsapp);
  return cab + '<article class="ped'+(p.entregue?' done':'')+'">'
   + '<div class="l1"><h3>'+esc(p.nome)+'</h3>'+st+ent+'<span class="total">'+brl(p.valorPago||p.total)+'</span></div>'
   + '<div class="meta"><span>Para <b>'+esc(dia(p.data))+'</b></span><span><b>'+(p.recebimento==='retirada'?'Retirada':'Entrega')+'</b>'+(p.frete?' · frete '+esc(p.frete):'')+'</span><span>Pedido '+esc(p.pedido)+'</span><span>Feito em '+esc(hora(p.criado))+'</span></div>'
   + '<div class="itens">'+esc(p.resumo)+'</div>'
   + (p.endereco ? '<div class="addr"><b>Endereço:</b> '+esc(p.endereco)+'</div>' : '')
   + (p.obs ? '<div class="obs"><b>Obs.:</b> '+esc(p.obs)+'</div>' : '')
   + '<div class="act">'
   + (link ? '<a class="btn wa" href="'+link+'" target="_blank" rel="noopener">WhatsApp · '+esc(p.whatsapp)+'</a>' : '')
   + (p.status==='pago' ? (p.entregue ? '<button class="btn undo" data-ent="'+esc(p.pedido)+'" data-v="0">Desfazer entregue</button>' : '<button class="btn done-btn" data-ent="'+esc(p.pedido)+'" data-v="1">Marcar como entregue</button>') : '')
   + '</div></article>';
 }).join('');
}
async function carregar(){
 $('reload').disabled = true; $('upd').textContent = 'atualizando…';
 try {
  const r = await fetch('/painel/api/pedidos', {cache:'no-store'});
  if (r.status === 401) { location.reload(); return; }
  const j = await r.json(); pedidos = j.pedidos || [];
  $('upd').textContent = 'atualizado às ' + new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
  desenhar();
 } catch(e) {
  $('lista').innerHTML = '<p class="erro">Não consegui carregar os pedidos. Confira a internet e toque em Atualizar.</p>';
  $('upd').textContent = 'erro ao atualizar';
 }
 $('reload').disabled = false;
}
document.addEventListener('click', async e => {
 const t = e.target.closest('[data-aba]'); if (t) { aba = t.dataset.aba; desenhar(); return; }
 const b = e.target.closest('[data-ent]'); if (!b) return;
 b.disabled = true;
 const r = await fetch('/painel/api/entregue', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({pedido:b.dataset.ent, entregue:b.dataset.v==='1'})});
 if (r.ok) { const j = await r.json(); pedidos = pedidos.map(p => p.pedido===j.pedido.pedido ? j.pedido : p); desenhar(); } else b.disabled = false;
});
$('reload').onclick = carregar;
carregar();
setInterval(() => { if (!document.hidden) carregar(); }, 60000);
}
</script></body></html>`;
