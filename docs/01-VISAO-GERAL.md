# 01 — Visão Geral

## Produto
FINNOS centraliza organização, acompanhamento e planejamento financeiro pessoal com foco em clareza, previsibilidade e experiência premium.

## Modos
### Local
Dados ativos permanecem no dispositivo. Conta em nuvem não é obrigatória.

### Conta FINNOS
Identidade via Firebase Authentication e sincronização dos dados financeiros via infraestrutura FINNOS/Firebase.

Backup não define o modo: usuários Local ou Conta FINNOS poderão escolher iCloud Drive, Google Drive, ambos ou nenhum.

## Plataformas
Implementado como Web/PWA responsiva. Uma integração Apple mais profunda pode exigir cliente nativo no futuro; isso não deve ser presumido como disponível em PWA.

## Domínio
Produção: `finnos.vercel.app`.

## Status
- Implementado: frontend React/PWA, páginas financeiras principais, modo local existente, backend FastAPI/MongoDB legado.
- Em migração: autenticação e persistência de Conta FINNOS para Firebase.
- Planejado: backups em nuvem, importação/exportação ampliada, Apple Pay/Atalhos, Metas e Investimentos completos.
