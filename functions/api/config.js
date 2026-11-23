// GET /api/config  ·  o site busca aqui preços e regiões atualizados
import { PRODUTOS, CAIXA, REGIOES, LOJA, hoje } from '../../lib/loja.js';

export const onRequestGet = ({ env }) =>
  Response.json(
    {
      pagamentos: Boolean(env.MP_ACCESS_TOKEN && env.PEDIDOS),
      produtos: PRODUTOS,
      caixa: CAIXA,
      regioes: REGIOES,
      hoje: hoje(),
      diasMaxAgendamento: LOJA.diasMaxAgendamento,
    },
    { headers: { 'cache-control': 'no-store' } }
  );
