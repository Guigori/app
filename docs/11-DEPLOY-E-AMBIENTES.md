# 11 — Deploy e Ambientes

## Frontend
Vite/React. Produção atual na Vercel: `finnos.vercel.app`.

## SPA routing
O app usa BrowserRouter. O ambiente de produção deve possuir fallback de SPA para rotas de frontend sem capturar indevidamente `/api/*` ou assets.

## Backend
FastAPI existe no repositório. No desenvolvimento, Vite encaminha `/api` para `localhost:8001`. Esse proxy de desenvolvimento não publica o backend automaticamente em produção.

## Firebase
Configuração de projeto, ambientes, variáveis e credenciais ainda deve ser implementada. Credenciais administrativas Firebase jamais entram no frontend/repositório.

## Ambientes
Planejar no mínimo desenvolvimento e produção separados. Mudanças de schema/rules devem ser testadas antes de produção.

## Deploy seguro
Não considerar deploy concluído apenas porque o frontend abriu: validar rotas diretas, API, autenticação, persistência, regras de segurança e sincronização.
