// POST /api/webhook  ·  o Mercado Pago avisa aqui quando um pedido (Order) muda de status.
// Quando o pedido está PAGO, juntamos com os dados guardados no checkout e mandamos o e-mail.
import { assinaturaValida, montarEmail } from '../../lib/notificacao.js';

const ok = msg => new Response(msg, { status: 200 });

export async function onRequestPost({ request, env }) {
  const url = new URL(request.url);
  const corpo = await request.json().catch(() => ({}));
  const tipo = url.searchParams.get('type') || url.searchParams.get('topic') || corpo.type || corpo.topic || '';
  const dataId = url.searchParams.get('data.id') || url.searchParams.get('data_id') || corpo?.data?.id;
  if (!/^order/.test(tipo) || !dataId) return ok('ignorado');

  if (env.MP_WEBHOOK_SECRET && !(await assinaturaValida(request, dataId, env.MP_WEBHOOK_SECRET)))
    return new Response('assinatura inválida', { status: 401 });

  // Busca o pedido direto no Mercado Pago (fonte da verdade)
  const r = await fetch(`https://api.mercadopago.com/v1/orders/${encodeURIComponent(dataId)}`, {
    headers: { authorization: `Bearer ${env.MP_ACCESS_TOKEN}`, accept: 'application/json' },
  });
  if (!r.ok) return new Response('erro ao consultar pedido', { status: 502 });
  const order = await r.json();
  if (order.status !== 'processed') return ok(`status ${order.status}`);

  // Evita e-mail duplicado (o Mercado Pago pode avisar mais de uma vez)
  const chave = `pago:${order.id}`;
  if (await env.PEDIDOS.get(chave)) return ok('já avisado');

  const dados = JSON.parse((await env.PEDIDOS.get(`pedido:${order.external_reference}`)) || 'null');
  const email = montarEmail(order, dados);
  const envio = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: env.EMAIL_FROM || 'Mandrágora Pedidos <onboarding@resend.dev>',
      to: (env.ORDER_EMAIL || 'mandragoradoces@gmail.com').split(',').map(s => s.trim()),
      subject: email.subject, html: email.html, text: email.text,
    }),
  });
  if (!envio.ok) {
    console.log('Erro no e-mail', envio.status, await envio.text());
    return new Response('erro no e-mail', { status: 500 }); // o Mercado Pago tenta de novo
  }
  await env.PEDIDOS.put(chave, new Date().toISOString(), { expirationTtl: 60 * 60 * 24 * 90 });
  return ok('ok');
}
