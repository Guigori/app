# 08 — Apple, Apple Pay e Atalhos

## Objetivo
Automatizar a captura de transações no ecossistema Apple e permitir direcionamento para o espaço escolhido (inicialmente Pessoal).

## Fluxo conceitual
Apple/Atalho -> normalização/validação -> modo atual -> persistência Local ou Conta FINNOS.

## Regra
Captura e armazenamento são responsabilidades separadas. A automação deve respeitar o modo escolhido pelo usuário.

## Importante
O FINNOS atual é Web/PWA. Capacidades de Apple Pay, Shortcuts/App Intents, CloudKit/iCloud e execução em segundo plano variam por plataforma e podem exigir app iOS nativo. Validar APIs/entitlements oficiais antes de prometer comportamento específico.

## Status
Planejado; não documentar como implementado até teste em dispositivo real.
