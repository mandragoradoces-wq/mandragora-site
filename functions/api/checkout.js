// POST /api/checkout  ·  recebe a sacola, recalcula tudo com os preços oficiais
// e cria o pagamento no Mercado Pago (Checkout Pro via API de Orders). Devolve o link de pagamento.
import { PRODUTOS, COMBO, ENTREGA, LOJA, hoje, dataValida, precoCombo, freteDe } from '../../lib/loja.js';

const erro = (msg, status = 400) => Response.json({ error: msg }, { status });
const texto = (v, max) => String(v ?? '').trim().slice(0, max);
const inteiro = (v, min, max) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};
const brl = n => Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export async function onRequestPost({ request, env }) {
  if (!env.MP_ACCESS_TOKEN || !env.PEDIDOS) return erro('Pagamento online ainda não configurado.', 503);

  let b;
  try { b = await request.json(); } catch { return erro('Pedido inválido.'); }

  // ---------- dados do cliente ----------
  const nome = texto(b.nome, 80);
  const whatsapp = texto(b.whatsapp, 20).replace(/\D/g, '');
  const email = texto(b.email, 120).toLowerCase();
  const deviceId = texto(b.deviceId, 120).replace(/[^\w.:-]/g, '');
  const recebimento = b.recebimento === 'retirada' ? 'retirada' : 'entrega';
  const obs = texto(b.obs, 300);
  if (!nome) return erro('Falta o seu nome.');
  if (whatsapp.length < 10 || whatsapp.length > 13) return erro('Confira o número de WhatsApp.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return erro('Confira o seu e-mail.');

  let endereco = '', end = null;
  if (recebimento === 'entrega') {
    const e = b.endereco && typeof b.endereco === 'object' ? b.endereco : {};
    const rua = texto(e.rua, 120), numero = texto(e.numero, 20), bairro = texto(e.bairro, 80);
    end = { rua, numero, bairro };
    const complemento = texto(e.complemento, 80), referencia = texto(e.referencia, 120);
    if (!rua || !numero || !bairro) return erro('Falta completar o endereço de entrega (rua, número e bairro).');
    endereco = `${rua}, ${numero}${complemento ? ` (${complemento})` : ''} · ${bairro} · ${ENTREGA.cidade}/${ENTREGA.uf}` +
      (referencia ? ` · Referência: ${referencia}` : '');
  }

  const data = texto(b.data, 10);
  const hj = hoje();
  const limite = new Date(Date.parse(hj) + LOJA.diasMaxAgendamento * 864e5).toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || data < hj || data > limite) return erro('Escolha uma data válida.');
  if (!dataValida(data)) return erro('Não temos entrega nesse dia ou horário. Escolha outra data.');

  // ---------- itens (preços sempre daqui do servidor) ----------
  const items = [];
  const linhas = [];
  for (const it of Array.isArray(b.itens) ? b.itens.slice(0, 30) : []) {
    const p = PRODUTOS[it.id];
    const qtd = inteiro(it.qtd, 1, 50);
    if (!p || !qtd) return erro('Algum item da sacola não existe mais. Atualize a página.');
    items.push({ id: it.id, title: `${p.nome} · ${p.tipo}`, description: p.tipo, img: p.img, quantity: qtd, unit_price: p.preco });
    linhas.push(`${qtd}x ${p.nome} (${p.tipo})`);
  }
  const combos = Array.isArray(b.combos) ? b.combos : Array.isArray(b.caixas) ? b.caixas : [];
  for (const cx of combos.slice(0, 10)) {
    const n = inteiro(cx.n, 1, 99);
    const sabores = Array.isArray(cx.sabores) ? cx.sabores : [];
    const qtd = inteiro(cx.qtd ?? 1, 1, 20);
    if (!COMBO.tamanhos.includes(n) || !qtd || sabores.length !== n || !sabores.every(s => COMBO.sabores.includes(s)))
      return erro('O Combo Monstrinho está incompleto. Monte de novo, por favor.');
    const conta = {};
    sabores.forEach(s => (conta[s] = (conta[s] || 0) + 1));
    const desc = Object.entries(conta).map(([s, q]) => `${q} ${PRODUTOS[s].nome}`).join(', ');
    const recado = texto(cx.recado, 80);
    items.push({ id: `combo-${n}`, title: `Combo Monstrinho (${n} fatias)`, description: desc, img: PRODUTOS[sabores[0]].img, quantity: qtd, unit_price: precoCombo(sabores) });
    linhas.push(`${qtd}x Combo Monstrinho (${n} fatias): ${desc}${recado ? ` · recado: "${recado}"` : ''}`);
  }
  if (!items.length) return erro('Sua sacola está vazia.');

  const subtotal = items.reduce((s, i) => s + i.unit_price * i.quantity, 0);
  let frete = '';
  if (recebimento === 'entrega') {
    const taxa = freteDe(subtotal);
    if (taxa > 0) items.push({ id: 'entrega', title: `Entrega em ${ENTREGA.cidade}`, quantity: 1, unit_price: taxa });
    frete = taxa > 0 ? brl(taxa) : 'Grátis';
    linhas.push(`Entrega em ${ENTREGA.cidade}: ${frete}`);
  }
  const total = Math.round(items.reduce((s, i) => s + i.unit_price * i.quantity, 0) * 100) / 100;

  // ---------- cria o pagamento no Mercado Pago (API de Orders · Checkout Pro) ----------
  const site = (env.SITE_URL || 'https://mandragoradoces.com.br').replace(/\/$/, ''); // onde o cliente volta
  const pedido = 'MDG-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase();
  const valor = n => Number(n).toFixed(2);

  // A API de Orders não guarda dados extras, então o pedido completo fica no KV
  const registro = {
    pedido, nome, email, whatsapp, recebimento, frete, endereco, data, obs,
    resumo: linhas.join('\n'), total, criado: new Date().toISOString(), status: 'aguardando',
  };
  const guardar = () => env.PEDIDOS.put(`pedido:${pedido}`, JSON.stringify(registro), { expirationTtl: 60 * 60 * 24 * 90 });
  await guardar();

  // Dados do comprador: o antifraude do Mercado Pago aprova mais quando recebe tudo isso
  const [primeiro, ...resto] = nome.split(/\s+/);
  const tel = whatsapp.length > 11 ? whatsapp.slice(2) : whatsapp; // tira o 55
  const payer = {
    email,
    first_name: primeiro,
    ...(resto.length ? { last_name: resto.join(' ') } : {}),
    phone: { area_code: tel.slice(0, 2), number: tel.slice(2) },
    ...(end ? { address: { street_name: end.rua, street_number: end.numero, neighborhood: end.bairro, city: ENTREGA.cidade } } : {}),
  };

  const montar = (completo) => ({
    type: 'online',
    processing_mode: 'manual',
    total_amount: valor(total),
    external_reference: pedido,
    description: `Pedido ${pedido} · Mandrágora Doces`,
    ...(completo ? { payer } : {}),
    items: items.map(i => ({
      external_code: i.id, title: i.title.slice(0, 120),
      ...(i.description ? { description: i.description.slice(0, 240) } : {}),
      ...(completo && i.img ? { picture_url: `${site}/img/${i.img}.webp` } : {}),
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
  });

  const criar = async (completo, tentativa) => fetch('https://api.mercadopago.com/v1/orders', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.MP_ACCESS_TOKEN}`,
      'content-type': 'application/json',
      accept: 'application/json',
      'x-idempotency-key': `${pedido}-${tentativa}`,
      ...(deviceId ? { 'x-meli-session-id': deviceId } : {}), // Device ID do script de segurança
    },
    body: JSON.stringify(montar(completo)),
  });

  let r, j;
  try {
    r = await criar(true, 1);
    j = await r.json().catch(() => ({}));
    // Se o Mercado Pago recusar algum dado extra, tenta de novo só com o básico
    if (r.status === 400 || r.status === 422) {
      console.log('Mercado Pago recusou dados extras, tentando o básico', JSON.stringify(j));
      r = await criar(false, 2);
      j = await r.json().catch(() => ({}));
    }
  } catch (e) {
    console.log('Mercado Pago fora do ar', String(e));
    return erro('Não conseguimos falar com o Mercado Pago agora. Tente de novo em instantes.', 502);
  }
  if (!r.ok || !j.checkout_url) {
    console.log('Erro Mercado Pago', r.status, JSON.stringify(j));
    return erro('Não conseguimos abrir o pagamento agora. Tente de novo em instantes.', 502);
  }
  registro.mpOrderId = j.id; // permite ao painel confirmar o pagamento direto no Mercado Pago
  await guardar();
  return Response.json({ url: j.checkout_url, pedido, total });
}
