// API da Mandrágora (Cloudflare Worker). O site fica no GitHub Pages e chama estas rotas:
//   GET  /api/config    preços, regiões e se o pagamento está ligado
//   POST /api/checkout  cria o pagamento no Mercado Pago
//   POST /api/webhook   aviso do Mercado Pago (pagamento aprovado → e-mail)
import { onRequestGet as config } from '../functions/api/config.js';
import { onRequestPost as checkout } from '../functions/api/checkout.js';
import { onRequestPost as webhook } from '../functions/api/webhook.js';

// Sites que podem usar esta API (o SITE_URL entra automaticamente, com e sem www)
function origensPermitidas(env) {
  const lista = new Set();
  const site = (env.SITE_URL || 'https://mandragoradoces.com.br').replace(/\/$/, '');
  lista.add(site);
  try {
    const u = new URL(site);
    const alt = u.hostname.startsWith('www.') ? u.hostname.slice(4) : 'www.' + u.hostname;
    lista.add(`${u.protocol}//${alt}`);
  } catch {}
  (env.EXTRA_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean).forEach(o => lista.add(o));
  return lista;
}

function comCors(resp, origem) {
  if (!origem) return resp;
  const r = new Response(resp.body, resp);
  r.headers.set('Access-Control-Allow-Origin', origem);
  r.headers.set('Vary', 'Origin');
  return r;
}

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    const origemPedido = request.headers.get('Origin');
    const origem = origemPedido && origensPermitidas(env).has(origemPedido) ? origemPedido : null;
    const c = { request, env, ctx };

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: origem ? 204 : 403,
        headers: origem ? {
          'Access-Control-Allow-Origin': origem,
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'content-type',
          'Access-Control-Max-Age': '86400',
          Vary: 'Origin',
        } : {},
      });
    }
    if (pathname === '/api/config' && request.method === 'GET') return comCors(await config(c), origem);
    if (pathname === '/api/checkout' && request.method === 'POST') {
      if (origemPedido && !origem) return new Response('Origem não permitida', { status: 403 });
      return comCors(await checkout(c), origem);
    }
    if (pathname === '/api/webhook' && request.method === 'POST') return webhook(c);
    return new Response('API da Mandrágora Doces', { status: pathname === '/' ? 200 : 404 });
  },
};
