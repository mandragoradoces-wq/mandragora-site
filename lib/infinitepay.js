// Integração com o Checkout Integrado da InfinitePay
// Liga quando a variável INFINITEPAY_HANDLE (InfiniteTag, sem o $) está cadastrada no Cloudflare.
import { lerPedido, salvarPedido } from './pedidos.js';
import { montarEmail, enviarEmail } from './notificacao.js';

const API = 'https://api.checkout.infinitepay.io';
export const handleDe = env => String(env.INFINITEPAY_HANDLE || '').trim().replace(/^[$@]/, '');
const cabecalhos = env => ({
  'content-type': 'application/json',
  accept: 'application/json',
  ...(env.INFINITEPAY_API_KEY ? { 'x-api-key': env.INFINITEPAY_API_KEY } : {}),
});
const erro = (msg, status = 400) => Response.json({ error: msg }, { status });

// Cria o link de pagamento e devolve a URL para o site redirecionar o cliente
export async function criarLinkInfinitePay({ env, site, api, pedido, registro, guardar, items, end, nome, email, whatsapp }) {
  const base = {
    ...(env.INFINITEPAY_API_KEY ? {} : { handle: handleDe(env) }),
    order_nsu: pedido,
    redirect_url: `${site}/?pedido=retorno`,
    webhook_url: `${api}/api/webhook-infinitepay`,
    items: items.map(i => ({
      quantity: i.quantity,
      price: Math.round(i.unit_price * 100), // em centavos
      description: i.title.slice(0, 120),
    })),
  };
  const tel = whatsapp.length > 11 ? whatsapp : `55${whatsapp}`;
  // Dados do cliente e endereço pré-preenchem o checkout da InfinitePay.
  // Itapema usa CEP geral (88220-000), então dá para mandar o endereço completo sem pedir CEP no site.
  const contato = { ...base, customer: { name: nome, email, phone_number: `+${tel}` } };
  const completo = end ? { ...contato, address: {
    cep: '88220000', street: end.rua, number: end.numero, neighborhood: end.bairro,
    city: 'Itapema', state: 'SC', ...(end.complemento ? { complement: end.complemento } : {}),
  } } : contato;

  const criar = corpo => fetch(`${API}/links`, { method: 'POST', headers: cabecalhos(env), body: JSON.stringify(corpo) });
  let r, j;
  try {
    // Tenta completo; se recusar, só contato; se recusar de novo, o básico
    const tentativas = completo === contato ? [contato, base] : [completo, contato, base];
    for (const corpo of tentativas) {
      r = await criar(corpo);
      j = await r.json().catch(() => ({}));
      if (r.status !== 400 && r.status !== 422) break;
      console.log('InfinitePay recusou, tentando com menos dados', r.status, JSON.stringify(j));
    }
  } catch (e) {
    console.log('InfinitePay fora do ar', String(e));
    return erro('Não conseguimos abrir o pagamento agora. Tente de novo em instantes.', 502);
  }
  const url = j.url || j.link || j.checkout_url || j.payment_url || j?.data?.url;
  if (!r.ok || !url) {
    console.log('Erro InfinitePay', r.status, JSON.stringify(j));
    return erro('Não conseguimos abrir o pagamento agora. Tente de novo em instantes.', 502);
  }
  registro.provedor = 'infinitepay';
  await guardar();
  return Response.json({ url, pedido, total: registro.total });
}

// Confirma o pagamento direto na InfinitePay (o aviso deles não tem assinatura).
// Se estiver pago: marca no painel e manda o e-mail (uma vez só).
export async function confirmarInfinitePay(env, dados) {
  const order_nsu = String(dados.order_nsu || '');
  const slug = String(dados.slug || dados.invoice_slug || '');
  const transaction_nsu = String(dados.transaction_nsu || '');
  if (!order_nsu || !slug || !transaction_nsu) return { status: 'incompleto' };

  const r = await fetch(`${API}/payment_check`, {
    method: 'POST', headers: cabecalhos(env),
    body: JSON.stringify({ handle: handleDe(env), order_nsu, transaction_nsu, slug }),
  });
  if (!r.ok) throw new Error(`payment_check respondeu ${r.status}`);
  const j = await r.json();
  if (!j.paid) return { status: 'aguardando' };

  const metodoCod = dados.capture_method || j.capture_method || '';
  const parcelas = Number(dados.installments || j.installments || 1);
  const p = await lerPedido(env, order_nsu);
  if (!p) { console.log('Pago na InfinitePay, mas pedido não encontrado', order_nsu); return { status: 'pago' }; }

  if (p.status !== 'pago') {
    p.status = 'pago';
    p.pagoEm = new Date().toISOString();
    p.metodo = metodoCod === 'pix' ? 'Pix' : metodoCod === 'credit_card' ? `Cartão de crédito${parcelas > 1 ? ` em ${parcelas}x` : ''}` : (metodoCod || 'InfinitePay');
    p.valorPago = p.total;
    p.ipSlug = slug;
    p.ipTransacao = transaction_nsu;
    if (dados.receipt_url) p.recibo = String(dados.receipt_url);
    await salvarPedido(env, p);
  }

  const chave = `pago:ip:${transaction_nsu}`;
  if (!(await env.PEDIDOS.get(chave))) {
    const pseudoOrder = {
      id: transaction_nsu, external_reference: p.pedido, total_paid_amount: p.total,
      rotulo: 'InfinitePay nº', recibo: p.recibo,
      transactions: { payments: [{ payment_method: { id: metodoCod === 'pix' ? 'pix' : metodoCod, type: metodoCod }, installments: parcelas }] },
    };
    if (await enviarEmail(env, montarEmail(pseudoOrder, p))) {
      await env.PEDIDOS.put(chave, new Date().toISOString(), { expirationTtl: 60 * 60 * 24 * 90 });
      console.log('E-mail do pedido enviado', p.pedido);
    }
  }
  return { status: 'pago', pedido: p.pedido };
}
