// GET /api/config  ·  o site busca aqui preços, frete e horários atualizados
import { PRODUTOS, COMBO, ENTREGA, RETIRADA, HORARIOS, LOJA, hoje } from '../../lib/loja.js';

export const onRequestGet = ({ env }) =>
  Response.json(
    {
      pagamentos: Boolean((env.INFINITEPAY_HANDLE || env.MP_ACCESS_TOKEN) && env.PEDIDOS),
      provedor: env.INFINITEPAY_HANDLE ? 'infinitepay' : 'mercadopago',
      produtos: PRODUTOS,
      combo: COMBO,
      entrega: ENTREGA,
      retirada: RETIRADA,
      horarios: HORARIOS,
      hoje: hoje(),
      diasMaxAgendamento: LOJA.diasMaxAgendamento,
    },
    { headers: { 'cache-control': 'no-store' } }
  );
