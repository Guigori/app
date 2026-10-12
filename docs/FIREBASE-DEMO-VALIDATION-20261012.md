# Firestore: importação demonstrativa e validação incremental

Estado: **migração ainda não concluída**. Produção e main preservadas; PR #4 deve permanecer em rascunho.

## Importação executada

Fonte original preservada: `backend/lib/demo_data.py`; fonte local comparada: `frontend/src/lib/local/engine.ts`.
O importador lê somente constantes e funções puras da fonte, sem inicializar o backend Mongo.
Cada UID recebeu 4 contas, 15 categorias, 2 cartões e 30 transações (51 documentos financeiros).
Founder estava sem registros financeiros. A/B/C tinham 8 registros fictícios cada, comparados exatamente
com o backup criptografado aprovado e preservados. Qualquer documento desconhecido ou alterado bloqueia
uma primeira importação. Não houve substituição de registros nem alteração no Authentication.

IDs UUIDv5 incluem UID, coleção, versão e chave de origem. Referências pertencem ao mesmo UID.
Cada registro importado possui `demo: true`, `demo_import`, `demo_source` e `demo_month`.
O manifesto fixa a versão e o mês: reexecução depois de edição não recria nem sobrescreve registros.
A carga e o manifesto são atômicos por perfil, com revisão financeira comum aos endpoints.
As quatro cargas são transações independentes; uma falha pode deixar perfis parcialmente concluídos,
mas reexecutar conclui os restantes sem duplicar os anteriores.

Reexecução real: `already_imported`, zero gravações para os quatro UIDs.
A cópia do MacBook corrige explicitamente total de R$ 600 para R$ 6.000 (10 x R$ 600),
conforme o exemplo local; a fonte permanece intacta. Valores persistidos em centavos.
Assinaturas são as transações recorrentes; parcelas alimentam faturas calculadas por ciclo.
Não há metas nem ciclos de orçamento nesta fonte. Não foram inventadas entidades como se fossem importadas.
Não há marca visual nova nos componentes: a identificação demonstrativa está nos documentos.

## Evidências e limitações

- Founder: sessão Google existente, Home com dados reais do Firestore no Preview;
  saldo exibido R$ 13.111,85, despesas de outubro R$ 2.998,55, cartões/parcelas e Radar populados.
- Logout Founder: tela de login exibida.
- A/B/C: e-mails esperados, UIDs preservados, ativos, verificados, provedor `password`.
- Login A: recusado pelo Preview; correspondência entre senha do cofre e Authentication ainda não comprovada.
  Senhas não são consultáveis em texto puro no Firebase. Nenhuma redefinição foi executada nesta etapa.
- Backup pós-importação: 237 documentos dos quatro perfis, criptografado, recuperação exata verificada;
  SHA256 `22e1ddee86ca7a71e60296e84b638321f792c36f876c83a5f2c0884b55b13b4f`.
  Arquivo fora do repositório. Recuperação depende da chave administrativa original preservada.
- Backend: suíte anterior e dois testes do importador, 95 aprovados; terceiro teste de reexecução
  acrescentado e aprovado com os outros dois. Total de 96 casos distintos aprovados.
- Frontend: 32 testes aprovados; TypeScript/Vite build aprovado, com aviso existente de tamanho do bundle.
- Testes reais CRUD, pagamentos, acesso cruzado autenticado, sincronização offline e mobile
  ainda não concluídos para os quatro perfis. Testes automatizados não substituem essas evidências.

## Auditoria MongoDB e implantação

O caminho implantado `frontend/api/index.py` usa exclusivamente `frontend/finnos` e Firestore;
nenhum import de Motor ou do servidor legado foi encontrado nesse caminho. O código legado
`backend/lib/db.py`, `backend/server.py`, seed e ferramentas históricas ainda existem para preservação.
Sem conexão de leitura ou export da origem MongoDB, **não é possível afirmar que não existem dados reais**.
O inventário, backup da origem e ensaio histórico permanecem pendentes; nenhum Mongo foi alterado.

O Preview usa `finnos-app`, comprovado pela carga recém-importada visível no Founder.
O backend possui bloqueio explícito fora de Preview/development. A liberação de produção exige
aprovação e validação do ambiente antes de remover esse bloqueio; nenhum deploy de produção foi feito.
FINNOS IA ainda requer configuração de chave protegida e autorização para chamadas com custo.
O acesso especial de validação não será desativado antes de comprovar os logins convencionais.

## Execução do importador

`backend/scripts/import_firestore_demo.py --credential <arquivo protegido> --baseline <backup criptografado>`
é somente inspeção. `--execute` grava exclusivamente os quatro UIDs fixos aprovados em `finnos-app`.
Não registrar conteúdo da credencial, senhas nem dados pessoais em logs ou commits.
