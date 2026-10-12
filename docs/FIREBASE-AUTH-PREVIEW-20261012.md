# Correção de autenticação — preview de 12/10/2026

Branch: `feat/firebase-fastapi-migration-20261012`. Nenhuma mudança em main,
produção, MongoDB ou regras Firestore.

## Causas confirmadas no código

- O projeto frontend tinha somente o fallback SPA; não havia função publicada
  para `/api/auth/me`. O proxy do Vite existe apenas no desenvolvimento.
- Login e cadastro chamavam `/api/auth/firebase-session`, ausente no backend.
- A configuração Firebase aceitava quaisquer valores não vazios. Não validava
  linhas `.env` coladas como valores, chaves truncadas nem espaços no começo/fim.

## Correção

`frontend/api/index.py` é uma função FastAPI de autenticação Firebase independente
do backend legado. Não importa MongoDB, não inicializa índices e não escreve em
bancos. A função aceita apenas ambientes `preview` e `development`; rejeita produção.
`frontend/vercel.json` encaminha as três rotas de autenticação para a função `/api`
e preserva o fallback SPA. O preset Vite fica explícito.

O token Google é verificado com Firebase Admin, inclusive revogação e e-mail
confirmado. Um login recente cria cookie Firebase de cinco dias com HttpOnly,
Secure no preview e SameSite=Lax. `/me` verifica o cookie novamente; logout o remove.
Requisições de criação/logout exigem Origin do próprio host. Respostas não têm cache.

O frontend valida o formato da configuração, trata igualmente erros no cadastro
e login e encerra a sessão cliente se a troca por cookie falhar. Logout também
encerra a sessão Firebase cliente.

## Configuração necessária para testar ao vivo

Conferir apenas Preview da branch acima, sem editar entradas compartilhadas com
Production. Copiar os valores de Project settings → Your apps → app Web no
Firebase: `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`,
`VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`,
`VITE_FIREBASE_MESSAGING_SENDER_ID` e `VITE_FIREBASE_APP_ID`.
O valor da chave deve ser somente a chave, sem aspas nem `VITE_FIREBASE_API_KEY=`.

`FIREBASE_SERVICE_ACCOUNT_JSON` é segredo servidor e não recebe prefixo VITE_.
Se `FIREBASE_PROJECT_ID` estiver definido, deve coincidir com o projeto da conta
de serviço. O Google precisa estar habilitado e o host exato do preview precisa
ser autorizado no Firebase. Não flexibilizar restrições ou regras para contornar erros.

Uma chave com formato válido ainda pode ter sido excluída, pertencer a outro
projeto ou ter restrições incompatíveis. A validação local não comprova sua validade
na API Google. Alterações em VITE_* exigem um novo build do preview.

## Limites

A função implementa somente autenticação Google, `/me` e logout. Não publica
os demais endpoints financeiros ou o cadastro legado por e-mail. A migração
completa continua pendente. Não executar o backend legado para este teste,
pois seu startup cria índices MongoDB.

Nesta sessão, o conector Vercel retornou 403 para a equipe `guigori`; o preview
redirecionou para o login Vercel, e o login Google/console Firebase retornou 502
`Connection refused` no navegador remoto. Os valores reais da configuração e
o fluxo OAuth real não foram verificados. Testes com Firebase simulado não
substituem essa verificação.

## Resultados locais

- Python: 28 testes passaram, incluindo autenticação existente, isolamento
  Firestore simulado, diagnóstico e 14 contratos HTTP da nova função.
- Frontend: 21 testes passaram (configuração Firebase, troca de token Google,
  falhas/cleanup e testes existentes de gráfico/demonstração).
- `npm run build`: TypeScript e build Vite aprovados. Vite informa bundle
  maior que 500 kB e import dinâmico inefetivo de api.ts; não bloqueiam o build.
- `git diff --check`: aprovado.

Os testes Firebase usam mocks e não acessaram MongoDB nem Firestore real.
Deploy Vercel e login Google real permanecem pendentes de acesso.
