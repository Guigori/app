# 12 — Roadmap

## Fase 0 — estabilização
- corrigir roteamento SPA na Vercel;
- mapear backend/deploy atual;
- congelar arquitetura-alvo nesta documentação.

## Fase 1 — Firebase
- criar projetos/ambientes;
- Firebase Authentication;
- modelar Firestore;
- Security Rules deny-by-default;
- App Check;
- integrar validação de token ao FastAPI.

## Fase 2 — migração
- substituir autenticação própria;
- migrar domínios MongoDB -> Firestore;
- testes A/B de autorização;
- persistência e sincronização Mac/iPhone;
- retirar MongoDB somente após equivalência.

## Fase 3 — dados e portabilidade
- persistência local definitiva;
- importar/exportar;
- formato de backup versionado;
- iCloud Drive e Google Drive;
- restauração testada.

## Fase 4 — integrações
- Apple/Atalhos após validação técnica;
- FINNOS IA no backend;
- futuras integrações financeiras/Open Finance somente com revisão de segurança.

## Fase 5 — produto
- Orçamento V2;
- Metas;
- Investimentos;
- Espaços adicionais;
- observabilidade, auditoria e hardening contínuo.

## Definition of Done para dados reais
Cadastro/login estáveis, autorização testada entre usuários, persistência consistente, backup/restauração testados, logs/segredos revisados e ambiente de produção validado.
