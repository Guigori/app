# 10 — Funcionalidades

## Implementadas/atuais
Rotas existentes no frontend:
- Início;
- Calendário/Transações;
- Contas;
- Categorias;
- Configurações;
- Cartões e fatura;
- Orçamento e configurações;
- Fluxo;
- Assinaturas;
- Cadastro/Login.

Metas e Investimentos possuem rotas, mas estão marcados como Coming Soon no código atual.

## Domínios
Transações suportam evolução para receitas/despesas, categorias, contas, cartões e parcelas. Dashboard possui resumo e análises. Navegação possui preferências locais.

## Gráfico do Início (Saldo ao longo do tempo)
- **Saldo** é o dinheiro nas contas em cada dia, com a mesma regra do "Saldo total" (`GET /api/analytics/balance-history`, `finnos/lib/cash_history.py`): compra no cartão só sai da conta quando a fatura é paga, transferência entre contas próprias não muda o total, lançamento pendente nunca conta. Meses passados terminam no saldo real do fim daquele mês, não no saldo de hoje.
- **Receitas** e **Despesas** são o que entrou e foi gasto no mês até cada dia (compra no cartão conta no dia da compra).
- Depois de hoje, a linha tracejada é estimativa: o saldo de hoje mais o que ainda está previsto.
- A forma como o gráfico foi deixado (tipo, período, séries ligadas) fica guardada no aparelho e na conta (`finnos:chart-preferences:v1`, sincronizada como `chart`). O tema claro/escuro também é sincronizado (`theme`).

## Compras pendentes (Apple Pay)
O Atalho do iPhone deixa cada compra numa fila no servidor, sem abrir o app e sem mexer no saldo. Elas aparecem em **Compras pendentes** no Início e no Fluxo, e no sino de avisos.
- Cada compra mostra de onde sai o dinheiro (cartão e conta que paga a fatura, ou conta) e se o cartão está cadastrado.
- **Débito ou Crédito** em cada compra, com Débito como padrão; Crédito mostra cartão, parcelas e a fatura em que cai.
- O FINNOS **aprende** a categoria de cada comerciante (mesmo com códigos no nome) e a conta ou cartão de cada nome de cartão do Apple Pay.
- **Registrar** ou **Excluir** uma a uma; **Registrar N no débito** de uma vez; **registrar automaticamente** (desligado por padrão) só no débito e depois de 3 confirmações iguais, com **Desfazer**.
- Cartão não cadastrado: cadastrar pela tela de cartão ou de conta que o app já tem, com o nome do Apple Pay preenchido, ou escolher outro na lista.
- Pendente há 3 dias ou mais ganha lembrete; compra de teste para ver o fluxo funcionando.
- Ativação guiada, com animação, em Configurações → Integrações. Detalhes técnicos em [08 — Apple e Atalhos](08-APPLE-E-ATALHOS.md).

## Orçamento — direção de produto
Modelos 50/30/20 ou personalizado; ciclos e periodicidades; planejado/comprometido/realizado/disponível; histórico de ciclos; alterações estruturais preferencialmente no ciclo seguinte.

## FINNOS IA
Recurso do produto que deverá usar backend para operações que envolvam secrets/serviços externos. Nunca expor chave privada no bundle do navegador.

## Estado
Este arquivo descreve o escopo; detalhes de cada módulo devem ganhar documentação própria conforme estabilizarem.
