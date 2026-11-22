// Funções de apoio do webhook: validação de assinatura e montagem do e-mail
const enc = new TextEncoder();
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const brl = n => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// Confere se a notificação veio mesmo do Mercado Pago (assinatura x-signature)
export async function assinaturaValida(request, dataId, segredo) {
  const sig = request.headers.get('x-signature') || '';
  const reqId = request.headers.get('x-request-id') || '';
  const partes = Object.fromEntries(sig.split(',').map(p => p.trim().split('=')));
  if (!partes.ts || !partes.v1) return false;
  const id = /^[a-z0-9]+$/i.test(dataId) ? String(dataId).toLowerCase() : dataId;
  let manifesto = '';
  if (id) manifesto += `id:${id};`;
  if (reqId) manifesto += `request-id:${reqId};`;
  manifesto += `ts:${partes.ts};`;
  const chave = await crypto.subtle.importKey('raw', enc.encode(segredo), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', chave, enc.encode(manifesto));
  const hex = [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, '0')).join('');
  if (hex.length !== partes.v1.length) return false;
  let dif = 0;
  for (let i = 0; i < hex.length; i++) dif |= hex.charCodeAt(i) ^ partes.v1.charCodeAt(i);
  return dif === 0;
}

const metodo = p =>
  p.payment_method_id === 'pix' ? 'Pix'
  : p.payment_type_id === 'credit_card' ? `Cartão de crédito${p.installments > 1 ? ` em ${p.installments}x` : ''}`
  : p.payment_type_id === 'debit_card' ? 'Cartão de débito'
  : p.payment_type_id === 'account_money' ? 'Saldo Mercado Pago'
  : p.payment_type_id || 'Mercado Pago';

export function montarEmail(p) {
  const m = p.metadata || {};
  const data = m.data ? m.data.split('-').reverse().join('/') : '';
  const wa = m.whatsapp ? `https://wa.me/${m.whatsapp.length <= 11 ? '55' : ''}${m.whatsapp}` : '';
  const linha = (k, v) => v ? `<tr><td style="padding:6px 12px 6px 0;color:#8C665B;white-space:nowrap;vertical-align:top">${k}</td><td style="padding:6px 0;font-weight:700">${v}</td></tr>` : '';
  const html = `<div style="font-family:Arial,sans-serif;color:#54251F;max-width:560px">
  <div style="background:#FF4F91;color:#fff;padding:18px 22px;border-radius:16px 16px 0 0">
   <div style="font-size:13px;opacity:.9">Pagamento aprovado · ${esc(m.pedido)}</div>
   <div style="font-size:24px;font-weight:700;margin-top:4px">${brl(p.transaction_amount)} · ${esc(m.nome)}</div>
  </div>
  <div style="background:#FFFCF7;border:1px solid #F2E6D8;border-top:0;padding:18px 22px;border-radius:0 0 16px 16px">
   <h3 style="margin:0 0 8px">Itens</h3>
   <div style="white-space:pre-line;line-height:1.6">${esc(m.resumo)}</div>
   <table style="margin-top:16px;border-collapse:collapse;font-size:15px">
    ${linha('Para', esc(data))}
    ${linha('Recebimento', m.recebimento === 'retirada' ? 'Retirada' : 'Entrega')}
    ${linha('Região', esc(m.regiao))}
    ${linha('Endereço', esc(m.endereco))}
    ${linha('Observações', esc(m.obs))}
    ${linha('WhatsApp', wa ? `<a href="${wa}" style="color:#FF4F91">${esc(m.whatsapp)}</a>` : '')}
    ${linha('Pagamento', `${metodo(p)} · nº ${esc(p.id)}`)}
   </table>
   ${wa ? `<p style="margin-top:18px"><a href="${wa}" style="background:#FF4F91;color:#fff;padding:12px 18px;border-radius:999px;text-decoration:none;font-weight:700">Chamar cliente no WhatsApp</a></p>` : ''}
  </div></div>`;
  const textoSimples = `Pagamento aprovado ${m.pedido}\n${brl(p.transaction_amount)} · ${m.nome}\n\n${m.resumo}\n\nPara: ${data}\nRecebimento: ${m.recebimento}\n${m.regiao ? `Região: ${m.regiao}\nEndereço: ${m.endereco}\n` : ''}${m.obs ? `Observações: ${m.obs}\n` : ''}WhatsApp: ${m.whatsapp}\nPagamento: ${metodo(p)} nº ${p.id}`;
  return {
    subject: `Pedido pago ${m.pedido} · ${m.nome} · ${brl(p.transaction_amount)} · para ${data}`,
    html, text: textoSimples,
  };
}

