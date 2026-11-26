// Funções de apoio dos pedidos guardados no KV (usadas pelo webhook e pelo painel)

const TTL = 60 * 60 * 24 * 90; // pedidos ficam guardados por 90 dias

export const metodoDe = order => {
  const pg = order?.transactions?.payments?.[0] || {};
  const id = pg?.payment_method?.id, tipo = pg?.payment_method?.type;
  if (id === 'pix') return 'Pix';
  if (tipo === 'credit_card') return `Cartão de crédito${pg.installments > 1 ? ` em ${pg.installments}x` : ''}`;
  if (tipo === 'debit_card') return 'Cartão de débito';
  if (tipo === 'account_money') return 'Saldo Mercado Pago';
  return tipo || id || '';
};

// Traduz o status da order do Mercado Pago para o status do painel
export const statusDe = order =>
  order?.status === 'processed' ? 'pago'
  : ['canceled', 'cancelled', 'expired', 'failed', 'refunded', 'charged_back'].includes(order?.status) ? 'cancelado'
  : 'aguardando';

export async function lerPedido(env, ref) {
  return JSON.parse((await env.PEDIDOS.get(`pedido:${ref}`)) || 'null');
}

export async function salvarPedido(env, p) {
  await env.PEDIDOS.put(`pedido:${p.pedido}`, JSON.stringify(p), { expirationTtl: TTL });
}

// Marca como pago com os dados da order (idempotente). Devolve o pedido guardado (ou null)
export async function marcarPago(env, order) {
  const p = await lerPedido(env, order.external_reference);
  if (!p) return null;
  if (p.status !== 'pago') {
    p.status = 'pago';
    p.pagoEm = new Date().toISOString();
    p.metodo = metodoDe(order);
    p.valorPago = Number(order.total_paid_amount || order.total_amount || p.total);
    p.mpOrderId = order.id;
    await salvarPedido(env, p);
  }
  return p;
}

// Consulta uma order no Mercado Pago
export async function consultarOrder(env, id) {
  const r = await fetch(`https://api.mercadopago.com/v1/orders/${encodeURIComponent(id)}`, {
    headers: { authorization: `Bearer ${env.MP_ACCESS_TOKEN}`, accept: 'application/json' },
  });
  if (!r.ok) throw new Error(`Mercado Pago respondeu ${r.status}`);
  return r.json();
}
