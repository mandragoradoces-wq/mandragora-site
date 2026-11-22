// POST /api/webhook  ·  o Mercado Pago chama aqui quando um pagamento muda de status.
// Se estiver APROVADO, mandamos o pedido completo por e-mail para a loja.

import { assinaturaValida, montarEmail } from '../../lib/notificacao.js';

export async function onRequestPost({ request, env }) {
  const url = new URL(request.url);
  const corpo = await request.json().catch(() => ({}));
  const tipo = url.searchParams.get('type') || url.searchParams.get('topic') || corpo.type || corpo.topic;
  const dataId = url.searchParams.get('data.id') || corpo?.data?.id || url.searchParams.get('id');
  if (tipo !== 'payment' || !dataId) return new Response('ignorado', { status: 200 });

  if (env.MP_WEBHOOK_SECRET && !(await assinaturaValida(request, dataId, env.MP_WEBHOOK_SECRET)))
    return new Response('assinatura inválida', { status: 401 });

  // Busca o pagamento direto no Mercado Pago (fonte da verdade)
  const r = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(dataId)}`, {
    headers: { authorization: `Bearer ${env.MP_ACCESS_TOKEN}` },
  });
  if (!r.ok) return new Response('erro ao consultar pagamento', { status: 502 });
  const p = await r.json();
  if (p.status !== 'approved') return new Response('ok', { status: 200 });

  // Evita e-mail duplicado (o Mercado Pago pode avisar mais de uma vez)
  const chave = `pago:${p.id}`;
  if (env.PEDIDOS && (await env.PEDIDOS.get(chave))) return new Response('já avisado', { status: 200 });

  const email = montarEmail(p);
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
  if (env.PEDIDOS) await env.PEDIDOS.put(chave, new Date().toISOString(), { expirationTtl: 60 * 60 * 24 * 90 });
  return new Response('ok', { status: 200 });
}
