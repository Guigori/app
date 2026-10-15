# FINNOS — Finanças pessoais

Aplicação web/PWA desenvolvida com **React + Vite, FastAPI, Firebase Authentication e Cloud Firestore**.

## Arquitetura atual

| Ambiente | Entrada | Banco financeiro |
| --- | --- | --- |
| Vercel (Preview / produção) | `frontend/api/index.py` → `frontend/finnos/routes.py` | Firestore (Firebase Admin SDK) |
| Desenvolvimento local | `frontend/api/index.py` via `npm run dev:api` | Firestore no projeto de desenvolvimento |
| Compatibilidade histórica | `backend/server.py` encaminha à mesma API Firebase | **Não inicia MongoDB** |

O adaptador `frontend/finnos/lib/db.py` armazena os dados sob `users/{uid}/<collection>/<document>` e verifica a identidade do Firebase. A aplicação web chama a API relativa `/api`. O MongoDB não faz parte do caminho de execução financeiro do FINNOS.

**Não reinstale Motor/PyMongo nem configure MONGO_URL.** Os arquivos antigos em `backend/routers/` e `backend/lib/db.py` permanecem somente para consulta histórica e eventual recuperação controlada. Não estão montados na API de produção ou no servidor de desenvolvimento atual.

## Iniciar localmente

Siga [Desenvolvimento Firebase](docs/DEVELOPMENT_FIREBASE.md). É necessário um projeto Firebase **de testes** e uma credencial Admin desse projeto, mantida fora do Git.

```bash
python3 -m pip install -r frontend/requirements.txt
# Configure FIREBASE_PROJECT_ID, FIREBASE_SERVICE_ACCOUNT_JSON e VITE_FIREBASE_* (projeto de testes).
cd frontend
npm install
npm run dev:api
# Em outro terminal, na mesma pasta:
npm run dev
```

O Vite encaminha `/api` para `127.0.0.1:8002`; nunca usa o backend Mongo em `:8001`.

## Segurança

- Sessões geradas e verificadas por Firebase Auth, com e-mail confirmado e cookie HTTP-only.
- Dados financeiros no Firestore isolados pelo UID verificado no servidor (não por parâmetros enviados pelo navegador).
- Requisições de escrita com cookie sujeitas a verificação de mesma origem.
- Valores monetários serializados como centavos inteiros no Firestore.
- CRUD financeiro sensível e seus vínculos verificados no adaptador transacional.
- Assinaturas cadastradas separadamente; transações históricas não são convertidas automaticamente.

**Verificação externa necessária:** as Firestore Security Rules configuradas no Firebase Console e qualquer acesso direto pelo SDK web exigem inspeção no projeto Firebase. O Admin SDK contorna essas regras; testes de API não substituem a auditoria das regras no Console.

## Testes

```bash
cd frontend
npm run typecheck
npm run test
npm run build

cd ..
PYTHONPATH=frontend python3 -m pytest -q frontend/finnos/tests
# No GitHub Actions também são executados os testes de autenticação, finanças,
# isolamento por UID, integridade financeira, faturas e recuperação de backups.
```

A rota `GET /api/finance/integrity` gera uma auditoria **somente leitura**, restrita ao usuário autenticado. Uma resposta de integridade positiva confirma vínculos entre documentos daquele usuário, mas não prova a presença de registros históricos que nunca foram importados. Compare arquivos/bancos legados apenas se for demonstrado que existem registros a preservar.

## Migração e histórico

- [Auditoria linha a linha da arquitetura MongoDB x Firestore](docs/audits/2026-10-14/README.md).
- [Guia de desenvolvimento Firebase](docs/DEVELOPMENT_FIREBASE.md).
- O código da arquitetura Motor/MongoDB foi retirado do **entrypoint executável**. Os arquivos legados são apenas referência; não use para novos recursos.

**Não apague projetos, backups ou bases financeiras antigas sem verificar a propriedade, os dados existentes e a possibilidade de restauração.** O cutover do aplicativo não depende de haver uma conta MongoDB Atlas pessoal.
