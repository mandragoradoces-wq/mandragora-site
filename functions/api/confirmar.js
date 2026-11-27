// POST /api/confirmar  ·  o site chama aqui quando o cliente volta da InfinitePay,
// para confirmar o pagamento na hora (sem depender do aviso automático).
import { confirmarInfinitePay } from '../../lib/infinitepay.js';

export async function onRequestPost({ request, env }) {
  const b = await request.json().catch(() => ({}));
  try {
    const res = await confirmarInfinitePay(env, b);
    return Response.json({ status: res.status });
  } catch (e) {
    console.log('Confirmar: erro', b.order_nsu, String(e));
    return Response.json({ status: 'erro' }, { status: 502 });
  }
}
