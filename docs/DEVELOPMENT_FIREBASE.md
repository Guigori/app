# Desenvolvimento do FINNOS com Firebase e Firestore

Esta é a arquitetura financeira **ativa** publicada na Vercel.
Não use `backend/server.py` (Motor/MongoDB) para testar o FINNOS atual.

## Pré-requisitos

- Python 3.12+ e Node.js compatível com `frontend/package.json`.
- Um **projeto Firebase de desenvolvimento/testes**, com Authentication e Firestore habilitados.
- Credencial Firebase Admin com acesso **somente** ao projeto de desenvolvimento.
- As variáveis públicas `VITE_FIREBASE_*` no frontend devem pertencer ao mesmo projeto do Admin SDK.

## Início local — dois terminais

No primeiro terminal, com o projeto de testes e a credencial local segura
(**nunca salve JSON de credencial no Git**):

```bash
python3 -m pip install -r frontend/requirements.txt
cd frontend
export VERCEL_ENV=development
export FIREBASE_PROJECT_ID="ID_DO_PROJETO_DE_TESTE"
export FIREBASE_SERVICE_ACCOUNT_JSON="$(cat /caminho/seguro/firebase-admin-dev.json)"
npm run dev:api
```

A API agora roda em **127.0.0.1:8002** usando `frontend/api/index.py`
e as mesmas rotas `frontend/finnos/` da Vercel. Não há dependência de MongoDB
nessa execução. Ela falha com HTTP 503 caso a credencial não esteja presente
ou o ID do projeto não coincida; **não** muda automaticamente para MongoDB.

No segundo terminal:

```bash
cd frontend
npm install
npm run dev
```

Abra http://localhost:3000. O Vite envia `/api/*` para `127.0.0.1:8002`
por padrão, preservando o cabeçalho `Host` para a verificação de mesma origem.
Caso sua API rode em outro endereço, inicie o Vite com
`FINNOS_DEV_API_TARGET=http://127.0.0.1:PORTA npm run dev`.

## Autenticação

As rotas financeiras continuam exigindo Firebase Auth com e-mail verificado
e cookie de sessão autenticado (ou token Bearer válido). O proxy local
não fornece dados fictícios, bypass de autenticação nem acesso sem UID.

Nunca utilize a credencial de produção ou o projeto `finnos-app` para
testes destrutivos. Use usuários e documentos fictícios no projeto de testes.

## Comparação com produção

| Ambiente | Entry point | Banco |
| --- | --- | --- |
| Vercel | `frontend/api/index.py` | Firebase/Firestore |
| Local (novo) | `frontend/api/index.py` via `npm run dev:api` | Firebase/Firestore de testes |
| Legado arquivado | `backend/server.py` em `:8001` | MongoDB — não é usado pelo Vite atual |

Verifique as mudanças locais antes de criar um PR:

```bash
cd frontend && npm run typecheck && npm run test && npm run build
cd .. && PYTHONPATH=frontend python3 -m pytest -q frontend/finnos/tests
```

Nenhum comando acima cria, transfere ou exclui dados de usuários reais.
