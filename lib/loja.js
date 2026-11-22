// =====================================================================
//  MANDRÁGORA · CONFIGURAÇÃO DA LOJA
//  Este é o lugar oficial dos preços. O servidor sempre recalcula o
//  pedido com os valores daqui (o site só mostra), então ninguém consegue
//  pagar um preço diferente mexendo no navegador.
//  Depois de editar, é só salvar no GitHub: o site atualiza sozinho.
// =====================================================================

// Produtos avulsos: id → nome e preço (em reais)
export const PRODUTOS = {
  b1: { nome: 'Brownie Clássico', preco: 12 },
  b2: { nome: 'Brownie Ninho com Nutella', preco: 15 },
  b3: { nome: 'Brownie Doce de Leite', preco: 14 },
  b4: { nome: 'Brownie Rosa', preco: 15 },
  p1: { nome: 'Bolo de pote Ninho com Morango', preco: 16 },
  p2: { nome: 'Bolo de pote Brigadeiro', preco: 15 },
  p3: { nome: 'Bolo de pote Prestígio', preco: 15 },
  p4: { nome: 'Bolo de pote Red Velvet', preco: 17 },
};

// Caixa Monstrinha: quantidade de brownies → preço, e sabores permitidos
export const CAIXA = {
  tamanhos: { 4: 48, 6: 70 },
  sabores: ['b1', 'b2', 'b3', 'b4'],
};

// Regiões de entrega (VALORES DE EXEMPLO: troquem pelos bairros e taxas reais)
export const REGIOES = [
  { id: 'r1', nome: 'Região 1 · bairros vizinhos', taxa: 8 },
  { id: 'r2', nome: 'Região 2 · até 6 km', taxa: 12 },
  { id: 'r3', nome: 'Região 3 · até 10 km', taxa: 18 },
];

export const LOJA = {
  nome: 'Mandrágora Doces',
  fuso: 'America/Sao_Paulo',
  parcelasMax: 3,          // parcelas máximas no cartão
  diasMaxAgendamento: 30,  // até quantos dias à frente dá para agendar
};

// Data de hoje no fuso da loja, no formato AAAA-MM-DD
export const hoje = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: LOJA.fuso }).format(new Date());
