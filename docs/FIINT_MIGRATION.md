# FIINT — FINNOS Inteligência

FIINT é o nome canônico do cérebro financeiro do FINNOS. Os nomes FCA e FAC são legados e devem ser removidos das interfaces, documentação e código **somente após** a migração dos imports, consumidores e testes.

## Inventário inicial (2026-10-14)
- `backend/lib/fca.py`: analisador legado de variações por categoria, com projeção simples.
- `backend/lib/fac/analysis.py`: analisador de variações por categoria v1.3, com valores em centavos, estornos, baseline robusto e evidências.
- `backend/lib/db.py` e `backend/lib/ai_context.py`: dependência do MongoDB.
- `frontend/src/lib/firebase.ts`: inicialização de Firebase Auth e Firestore.

## Contrato de migração
1. Preservar algoritmos originais até comparar saídas de referência; nunca eliminar regras sem cobertura de testes.
2. Centralizar o cálculo em `fiint` e adaptar consumidores (Radar, Análises, Finn e Registro Inteligente) por interfaces versionadas.
3. Não tratar análise determinística como modelo treinado. Aprendizado individual e coletivo são capacidades novas, não existentes no analisador de categorias.
4. Migrar leitura e escrita de dados para Firebase/Firestore com autenticação e isolamento por UID, e validar regras de acesso do servidor.
5. Aprendizado coletivo: não publicar registros brutos, nomes livres, identificadores, valores individuais ou dados de pagamento. Exigir avaliação de reidentificação, agregação, base legal e revisão jurídica antes de habilitar.
6. Texto, imagem e voz geram apenas rascunhos a confirmar; nunca criar transações automaticamente.
7. Atualizar imports, testes, métricas, documentação e referências de interface antes de excluir nomes legados.

## Portões de qualidade
- Testes comparativos entre FCA e FAC para transações pagas, estornos, parcelas, transferências, meses sem dados e limites de alerta.
- Paridade entre dados de origem e Firestore; nenhuma leitura entre usuários.
- Desempenho e comportamento em dispositivos móveis.
- Testes de regressão, typecheck e build antes de merge.
- Nenhuma exclusão de MongoDB ou de código legado antes da validação e aprovação do corte.

## Módulos planejados
- `fiint/analysis`: cálculo determinístico e explicações.
- `fiint/learning`: classificação pessoal, correções e agregados coletivos.
- `fiint/recognition`: extração de texto, imagens e voz.
- `fiint/core`: contratos, pontuação, proveniência e orquestração.

Este documento é um plano de migração. Não indica que todas as capacidades já estejam implementadas.

## Decisão arquitetural aprovada — modo offline do beta (2026-10-14)

**Status: decisão de produto e arquitetura aprovada; implementação e testes pendentes.**

- **FIINT online:** o núcleo inteligente permanece em Python, executado pela FastAPI. Firebase Authentication identifica contas online e Firestore armazena seus dados. Não executar o núcleo Python no PWA e não incluir Pyodide no beta.
- **Offline (conta online):** permitir abrir a interface previamente armazenada, consultar rapidamente os dados já disponíveis no dispositivo, visualizar o último resultado salvo de Análises e Radar e criar novos lançamentos locais pendentes de envio. Não recalcular análises, executar OCR/voz online ou apresentar alertas antigos como atualizados.
- **Transparência:** exibir estado offline, data/hora da última atualização de cada visão e quantidade/estado de lançamentos pendentes; saldos e indicadores offline são históricos, não em tempo real.
- **Reconexão:** sincronizar a fila de operações autenticadas, com identificador estável por lançamento e gravação idempotente, resolução explícita de conflitos e tratamento de token expirado. Só atualizar as análises após confirmação da sincronização; falhas não devem apagar lançamentos pendentes.
- **Modo local:** não exigir conta Firebase e não transmitir dados automaticamente ao servidor. Persistir dados no dispositivo, disponibilizar exportação/backup e informar riscos de perda do armazenamento local. Qualquer processamento remoto futuro deve ser solicitado com consentimento e finalidade clara.
- **Infraestrutura cliente:** avaliar IndexedDB para cache e fila de operações, Service Worker para o shell offline e uma política de retenção/limpeza segura. Dados financeiros sensíveis armazenados localmente exigem revisão de segurança, proteção contra acesso indevido e estratégia de logout/remoção de cache.
- **Critérios de aceite:** testar iOS Safari/PWA, falta de conexão durante o lançamento, reenvio após reconexão, operações duplicadas, conflitos entre dispositivos, expiração de sessão, limpeza de armazenamento, alternância de contas e isolamento entre usuários.

Essa decisão substitui a proposta anterior de executar FIINT Python offline via Pyodide no beta. O offline é uma camada de continuidade; o processamento de inteligência permanece no backend.
