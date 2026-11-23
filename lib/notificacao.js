// Funções de apoio do webhook: validação de assinatura e montagem do e-mail
const enc = new TextEncoder();
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const brl = n => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// Confere se a notificação veio mesmo do Mercado Pago (assinatura x-signature)
async function hmacHex(segredo, texto) {
  const chave = await crypto.subtle.importKey('raw', enc.encode(segredo), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', chave, enc.encode(texto));
  return [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, '0')).join('');
}
const iguais = (a, b) => {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
};

// Confere se a notificação veio mesmo do Mercado Pago (assinatura x-signature)
export async function assinaturaValida(request, dataId, segredo) {
  const sig = request.headers.get('x-signature') || '';
  const reqId = request.headers.get('x-request-id') || '';
  const partes = Object.fromEntries(sig.split(',').map(p => p.trim().split('=')));
  if (!partes.ts || !partes.v1) return false;
  const ids = [...new Set([String(dataId), String(dataId).toLowerCase()])];
  for (const id of ids) {
    let manifesto = `id:${id};`;
    if (reqId) manifesto += `request-id:${reqId};`;
    manifesto += `ts:${partes.ts};`;
    if (iguais(await hmacHex(segredo, manifesto), partes.v1)) return true;
  }
  return false;
}

const metodo = pg => {
  const id = pg?.payment_method?.id, tipo = pg?.payment_method?.type;
  if (id === 'pix') return 'Pix';
  if (tipo === 'credit_card') return `Cartão de crédito${pg.installments > 1 ? ` em ${pg.installments}x` : ''}`;
  if (tipo === 'debit_card') return 'Cartão de débito';
  if (tipo === 'account_money') return 'Saldo Mercado Pago';
  return tipo || id || 'Mercado Pago';
};

// order = resposta do GET /v1/orders/{id}; dados = o que o checkout guardou no KV
export function montarEmail(order, dados) {
  const m = dados || {};
  const pg = order.transactions?.payments?.[0] || {};
  const pedido = m.pedido || order.external_reference || order.id;
  const valorPago = order.total_paid_amount || order.total_amount;
  const resumo = m.resumo || (order.items || []).map(i => `${i.quantity}x ${i.title}${i.description ? `: ${i.description}` : ''}`).join('\n');
  const data = m.data ? m.data.split('-').reverse().join('/') : '';
  const wa = m.whatsapp ? `https://wa.me/${m.whatsapp.length <= 11 ? '55' : ''}${m.whatsapp}` : '';
  const linha = (k, v) => v ? `<tr><td style="padding:6px 12px 6px 0;color:#8C665B;white-space:nowrap;vertical-align:top">${k}</td><td style="padding:6px 0;font-weight:700">${v}</td></tr>` : '';
  const aviso = dados ? '' : '<p style="background:#FFF2D8;padding:10px 12px;border-radius:10px">Não encontramos os dados de entrega deste pedido. Confira no painel do Mercado Pago e fale com o cliente.</p>';
  const html = `<div style="font-family:Arial,sans-serif;color:#54251F;max-width:560px">
  <div style="background:#FF4F91;color:#fff;padding:18px 22px;border-radius:16px 16px 0 0">
   <div style="font-size:13px;opacity:.9">Pagamento aprovado · ${esc(pedido)}</div>
   <div style="font-size:24px;font-weight:700;margin-top:4px">${brl(valorPago)}${m.nome ? ` · ${esc(m.nome)}` : ''}</div>
  </div>
  <div style="background:#FFFCF7;border:1px solid #F2E6D8;border-top:0;padding:18px 22px;border-radius:0 0 16px 16px">
   ${aviso}
   <h3 style="margin:0 0 8px">Itens</h3>
   <div style="white-space:pre-line;line-height:1.6">${esc(resumo)}</div>
   <table style="margin-top:16px;border-collapse:collapse;font-size:15px">
    ${linha('Para', esc(data))}
    ${linha('Recebimento', m.recebimento ? (m.recebimento === 'retirada' ? 'Retirada' : 'Entrega') : '')}
    ${linha('Região', esc(m.regiao))}
    ${linha('Endereço', esc(m.endereco))}
    ${linha('Observações', esc(m.obs))}
    ${linha('WhatsApp', wa ? `<a href="${wa}" style="color:#FF4F91">${esc(m.whatsapp)}</a>` : '')}
    ${linha('Pagamento', `${metodo(pg)} · pedido MP ${esc(order.id)}`)}
   </table>
   ${wa ? `<p style="margin-top:18px"><a href="${wa}" style="background:#FF4F91;color:#fff;padding:12px 18px;border-radius:999px;text-decoration:none;font-weight:700">Chamar cliente no WhatsApp</a></p>` : ''}
  </div></div>`;
  const text = `Pagamento aprovado ${pedido}\n${brl(valorPago)}${m.nome ? ` · ${m.nome}` : ''}\n\n${resumo}\n\n` +
    (dados ? `Para: ${data}\nRecebimento: ${m.recebimento}\n${m.regiao ? `Região: ${m.regiao}\nEndereço: ${m.endereco}\n` : ''}${m.obs ? `Observações: ${m.obs}\n` : ''}WhatsApp: ${m.whatsapp}\n` : 'Dados de entrega não encontrados.\n') +
    `Pagamento: ${metodo(pg)} · pedido MP ${order.id}`;
  return {
    subject: `Pedido pago ${pedido}${m.nome ? ` · ${m.nome}` : ''} · ${brl(valorPago)}${data ? ` · para ${data}` : ''}`,
    html, text,
  };
}
