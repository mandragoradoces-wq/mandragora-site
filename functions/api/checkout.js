// POST /api/checkout  ·  recebe a sacola, recalcula tudo com os preços oficiais
// e cria o pagamento no Mercado Pago (Checkout Pro via API de Orders). Devolve o link de pagamento.
import { PRODUTOS, CAIXA, REGIOES, LOJA, hoje } from '../../lib/loja.js';

const erro = (msg, status = 400) => Response.json({ error: msg }, { status });
const texto = (v, max) => String(v ?? '').trim().slice(0, max);
const inteiro = (v, min, max) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};

export async function onRequestPost({ request, env }) {
  if (!env.MP_ACCESS_TOKEN || !env.PEDIDOS) return erro('Pagamento online ainda não configurado.', 503);

  let b;
  try { b = await request.json(); } catch { return erro('Pedido inválido.'); }

  // ---------- dados do cliente ----------
  const nome = texto(b.nome, 80);
  const whatsapp = texto(b.whatsapp, 20).replace(/\D/g, '');
  const recebimento = b.recebimento === 'retirada' ? 'retirada' : 'entrega';
  const obs = texto(b.obs, 300);
  if (!nome) return erro('Falta o seu nome.');
  if (whatsapp.length < 10 || whatsapp.length > 13) return erro('Confira o número de WhatsApp.');

  let regiao = null, endereco = '';
  if (recebimento === 'entrega') {
    regiao = REGIOES.find(r => r.id === b.regiao);
    endereco = texto(b.endereco, 200);
    if (!regiao) return erro('Escolha a região de entrega.');
    if (endereco.length < 6) return erro('Falta o endereço de entrega.');
  }

  const data = texto(b.data, 10);
  const hj = hoje();
  const limite = new Date(Date.parse(hj) + LOJA.diasMaxAgendamento * 864e5).toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || data < hj || data > limite) return erro('Escolha uma data válida.');

  // ---------- itens (preços sempre daqui do servidor) ----------
  const items = [];
  const linhas = [];
  for (const it of Array.isArray(b.itens) ? b.itens.slice(0, 30) : []) {
    const p = PRODUTOS[it.id];
    const qtd = inteiro(it.qtd, 1, 50);
    if (!p || !qtd) return erro('Algum item da sacola não existe mais. Atualize a página.');
    items.push({ id: it.id, title: p.nome, quantity: qtd, unit_price: p.preco, currency_id: 'BRL' });
    linhas.push(`${qtd}x ${p.nome}`);
  }
  for (const cx of Array.isArray(b.caixas) ? b.caixas.slice(0, 10) : []) {
    const n = inteiro(cx.n, 1, 99);
    const preco = CAIXA.tamanhos[n];
    const sabores = Array.isArray(cx.sabores) ? cx.sabores : [];
    const qtd = inteiro(cx.qtd ?? 1, 1, 20);
    if (!preco || !qtd || sabores.length !== n || !sabores.every(s => CAIXA.sabores.includes(s)))
      return erro('A Caixa Monstrinha está incompleta. Monte de novo, por favor.');
    const conta = {};
    sabores.forEach(s => (conta[s] = (conta[s] || 0) + 1));
    const desc = Object.entries(conta).map(([s, q]) => `${q} ${PRODUTOS[s].nome}`).join(', ');
    const recado = texto(cx.recado, 80);
    items.push({
      id: `caixa-${n}`, title: `Caixa Monstrinha (${n})`, description: desc.slice(0, 250),
      quantity: qtd, unit_price: preco, currency_id: 'BRL',
    });
    linhas.push(`${qtd}x Caixa Monstrinha (${n}): ${desc}${recado ? ` · recado: "${recado}"` : ''}`);
  }
  if (!items.length) return erro('Sua sacola está vazia.');
  if (regiao) {
    items.push({ id: `entrega-${regiao.id}`, title: `Entrega · ${regiao.nome}`, quantity: 1, unit_price: regiao.taxa, currency_id: 'BRL' });
    linhas.push(`Entrega: ${regiao.nome}`);
  }
  const total = items.reduce((s, i) => s + i.unit_price * i.quantity, 0);

  // ---------- cria o pagamento no Mercado Pago (API de Orders · Checkout Pro) ----------
  const site = (env.SITE_URL || 'https://mandragoradoces.com.br').replace(/\/$/, ''); // onde o cliente volta
  const pedido = 'MDG-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase();
  const valor = n => Number(n).toFixed(2);

  // A API de Orders não guarda dados extras, então o pedido completo fica no KV
  await env.PEDIDOS.put(`pedido:${pedido}`, JSON.stringify({
    pedido, nome, whatsapp, recebimento,
    regiao: regiao ? regiao.nome : '', endereco, data, obs,
    resumo: linhas.join('\n'), total, criado: new Date().toISOString(),
  }), { expirationTtl: 60 * 60 * 24 * 60 });

  const order = {
    type: 'online',
    processing_mode: 'manual',
    total_amount: valor(total),
    external_reference: pedido,
    description: `Pedido ${pedido} · Mandrágora Doces`,
    items: items.map(i => ({
      external_code: i.id, title: i.title.slice(0, 120),
      ...(i.description ? { description: i.description.slice(0, 240) } : {}),
      quantity: i.quantity, unit_price: valor(i.unit_price),
    })),
    config: {
      statement_descriptor: 'MANDRAGORA',
      online: {
        success_url: `${site}/?pedido=pago`,
        pending_url: `${site}/?pedido=pendente`,
        failure_url: `${site}/?pedido=falhou`,
        auto_return: 'approved',
      },
      payment_method: {
        not_allowed_types: ['ticket'], // sem boleto: doce não espera 3 dias
        max_installments: LOJA.parcelasMax,
      },
    },
  };

  let r;
  try {
    r = await fetch('https://api.mercadopago.com/v1/orders', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.MP_ACCESS_TOKEN}`,
        'content-type': 'application/json',
        accept: 'application/json',
        'x-idempotency-key': pedido,
      },
      body: JSON.stringify(order),
    });
  } catch (e) {
    console.log('Mercado Pago fora do ar', String(e));
    return erro('Não conseguimos falar com o Mercado Pago agora. Tente de novo em instantes.', 502);
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.checkout_url) {
    console.log('Erro Mercado Pago', r.status, JSON.stringify(j));
    return erro('Não conseguimos abrir o pagamento agora. Tente de novo em instantes.', 502);
  }
  return Response.json({ url: j.checkout_url, pedido, total });
}
