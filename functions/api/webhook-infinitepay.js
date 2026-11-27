// POST /api/webhook-infinitepay  ·  a InfinitePay avisa aqui quando um pagamento muda.
// O aviso não tem assinatura, então tudo é confirmado direto na InfinitePay antes de valer.
import { confirmarInfinitePay } from '../../lib/infinitepay.js';

export async function onRequestPost({ request, env }) {
  const b = await request.json().catch(() => ({}));
  try {
    const res = await confirmarInfinitePay(env, b);
    console.log('Webhook InfinitePay', b.order_nsu, res.status);
    return new Response('ok', { status: 200 });
  } catch (e) {
    console.log('Webhook InfinitePay: erro ao confirmar', b.order_nsu, String(e));
    return new Response('erro', { status: 400 }); // a InfinitePay tenta de novo
  }
}
