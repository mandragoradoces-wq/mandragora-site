// =====================================================================
//  MANDRÁGORA · CONFIGURAÇÃO DA LOJA
//  Este é o lugar oficial dos preços, frete e horários. O servidor sempre
//  recalcula o pedido com os valores daqui (o site só mostra), então
//  ninguém consegue pagar um preço diferente mexendo no navegador.
//  Depois de editar, é só salvar no GitHub: tudo atualiza sozinho.
// =====================================================================

// Produtos: id → nome fantasia, descrição curta (vai no e-mail), preço em reais e foto (pasta img/)
export const PRODUTOS = {
  f1: { nome: 'O Original', tipo: 'Fatia de brownie tradicional', preco: 13.9, img: 'original' },
  f2: { nome: 'Feitiço de Cacau', tipo: 'Fatia de brownie com brigadeiro', preco: 15.9, img: 'feitico-cacau' },
  f3: { nome: 'Feitiço de Ninho', tipo: 'Fatia de brownie com brigadeiro de Ninho', preco: 15.9, img: 'feitico-ninho' },
  f4: { nome: 'Feitiço do Amor', tipo: 'Fatia de brownie red velvet', preco: 15.9, img: 'feitico-amor' },
  p1: { nome: 'Poção de Brigadeiro', tipo: 'Brownie de pote de brigadeiro', preco: 21.9, img: 'pocao-brigadeiro' },
  p2: { nome: 'Poção Branca', tipo: 'Brownie de pote de Ninho', preco: 21.9, img: 'pocao-branca' },
  p3: { nome: 'Poção Dupla', tipo: 'Brownie de pote Ninho com brigadeiro', preco: 21.9, img: 'pocao-dupla' },
  g1: { nome: 'Monstrinhos de Cacau', tipo: 'Caixa com 4 brigadeiros tradicionais', preco: 14.9, img: 'monstrinhos-cacau' },
  g2: { nome: 'Fantasminhas', tipo: 'Caixa com 4 brigadeiros de Ninho', preco: 12.9, img: 'fantasminhas' },
  g3: { nome: 'Assombração Mista', tipo: 'Caixa com 2 tradicionais + 2 de Ninho', preco: 12.9, img: 'assombracao-mista' },
  s1: { nome: 'Pavêhomora', tipo: 'Pavê de nata no pote', preco: 24.9, img: 'pavehomora' },
};

// Combo Monstrinho: o cliente escolhe 4 ou 6 fatias de brownie.
// O preço é a soma das fatias escolhidas, com o desconto abaixo (em %).
export const COMBO = {
  tamanhos: [4, 6],
  sabores: ['f1', 'f2', 'f3', 'f4'],
  desconto: 0, // ex.: 10 = 10% de desconto no combo
};

// Entrega
export const ENTREGA = {
  cidade: 'Itapema',
  uf: 'SC',
  taxa: 12,          // taxa fixa para toda a cidade
  gratisAcima: 100,  // frete grátis a partir deste valor em produtos
};

// Endereço de retirada (aparece para o cliente quando ele escolhe "Retirada").
// Enquanto estiver vazio, o site avisa que o endereço é enviado pelo WhatsApp.
export const RETIRADA = 'Rua 406B, 665 · Morretes · Itapema/SC';

// Horários de delivery: dia da semana (0 = domingo … 6 = sábado) → [abre, fecha]
// Dia que não aparece aqui = sem entrega. Fora do horário, o pedido vira encomenda.
export const HORARIOS = {
  1: [9, 19], 2: [9, 19], 3: [9, 19], 4: [9, 19], 5: [9, 19],
  6: [9, 12],
};

export const LOJA = {
  nome: 'Mandrágora Doces',
  fuso: 'America/Sao_Paulo',
  parcelasMax: 3,          // parcelas máximas no cartão
  diasMaxAgendamento: 30,  // até quantos dias à frente dá para agendar
};

// ---------- funções de apoio (não precisa mexer) ----------
export const hoje = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: LOJA.fuso }).format(new Date());

// Hora atual no fuso da loja, em horas decimais (ex.: 14.5 = 14h30)
export const horaAgora = () => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: LOJA.fuso, hour12: false, hour: '2-digit', minute: '2-digit' })
    .formatToParts(new Date()).map(x => [x.type, x.value]));
  return (Number(p.hour) % 24) + Number(p.minute) / 60;
};

const diaSemana = d => new Date(`${d}T12:00:00Z`).getUTCDay();

// A data aceita pedido? (dia com delivery e, se for hoje, antes de fechar)
export function dataValida(d) {
  const h = HORARIOS[diaSemana(d)];
  if (!h) return false;
  if (d === hoje() && horaAgora() >= h[1]) return false;
  return true;
}

export const precoCombo = sabores =>
  Math.round(sabores.reduce((s, id) => s + PRODUTOS[id].preco, 0) * (100 - COMBO.desconto)) / 100;

export const freteDe = subtotal =>
  subtotal >= ENTREGA.gratisAcima ? 0 : ENTREGA.taxa;
