# FINNOS Vertical Menu v1.0 — Referência oficial

Referência aprovada em 08/10/2026: imagem enviada pelo usuário com duas telas iPhone (Modo Cards e Modo Gráficos) e menus verticais brancos ao lado de cada tela.

## Anatomia
- Cápsula branca vertical, largura compacta, cantos totalmente arredondados, borda lilás muito sutil e sombra suave.
- Quatro ações na ordem vertical: Calendário (calendar-days), Cards (layout-list), Gráficos (chart-pie), Filtros (sliders-horizontal).
- Apenas o modo Cards ou Gráficos permanece selecionado, com botão roxo #4B2CFF, ícone branco e raio totalmente arredondado; ícones não selecionados em azul profundo #070F52.
- Calendário e Filtros abrem painéis temporários, sem substituir a seleção persistente de Cards/Gráficos.
- Reutilizar componente compartilhado em todas as telas que necessitem menu vertical; nunca duplicar implementações divergentes.
- Layout de Análise: cabeçalho Análise + Outubro de 2026; visão do período; Descobertas FINNOS com carrossel; grade de widgets compactos; evolução do saldo; assinaturas; distribuição de gastos; botão Modificar painel/biblioteca.
- Modo Cards mostra indicadores numéricos; Modo Gráficos preserva os mesmos dados e mostra gráficos dentro dos widgets.
- Referência visual: imagem aprovada na conversa de 08/10/2026. O arquivo de imagem não está incluído no repositório; solicitar o original antes de uma implementação pixel-perfect.

## Regras de UX
- Sem grandes espaços vazios; números completos sem truncamento.
- Paleta FINNOS: #070F52, #4B2CFF, #5B35FF, branco; respeitar tema claro/escuro.
- Acessibilidade: labels e área de toque >=44px; foco visível; estados selecionados sem ambiguidade.
- Filtros e período sincronizados em todos os widgets; animação suave, responsividade mobile-first.
