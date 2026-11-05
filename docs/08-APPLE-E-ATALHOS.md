# 08 — Apple, Apple Pay e Atalhos

## Objetivo
Registrar receitas e despesas pelo iPhone, inclusive sem abrir o FINNOS, para qualquer usuário com conta.

## Como funciona
Configurações → Integrações e automações.

- **Registrar sem abrir o app** (conta FINNOS): o usuário gera um código pessoal (`fns_…`) e o coloca no atalho.
  - `GET /api/shortcuts/opcoes` devolve tipos, formas, carteiras (contas e cartões) e categorias do próprio usuário.
  - `POST /api/shortcuts/lancamentos` recebe `valor`, `tipo`, `forma`, `carteira`, `categoria`, `parcelas`, `descricao`, `data` e `id` (opcional).
  - Toda resposta é `{"ok", "mensagem"}`, inclusive erros, para o atalho mostrar.
- **Apple Pay**: automação Transação do Atalhos chamando o mesmo `POST` com Valor, Comerciante e Cartão. Sem categoria, usa a do último lançamento com o mesmo nome.
- **Abrir já preenchido** (também no modo local): link `/registro-inteligente#texto=…` ou `#valor=…&nome=…&cartao=…`. Nada é gravado sem confirmação.
- **Notificações da Carteira**: indisponível; o iOS não permite que apps ou sites leiam notificações de outros apps.

## Regras
- O código é mostrado uma vez e guardado só como hash SHA-256 em `integration_tokens` (coleção só do servidor).
  - Ele só lista nomes e cria lançamentos.
  - Limite de 60 usos por hora; até 5 códigos por usuário; revogável a qualquer momento.
  - Uma conta desativada ou sem e-mail confirmado também desativa o código.
- O lançamento passa pela mesma validação e gravação do app (contas, cartões, faturas, parcelas) e fica com `source = "ios_shortcut"`.
- O mesmo envio repetido em até 2 minutos (ou com o mesmo `id`) grava uma vez só.
- Cada uso, aceito ou recusado, fica em `users/{uid}/integration_audit` e aparece em Atividade recente.
- Atalho pronto para todos: publique o atalho pelo iCloud e defina `VITE_FINNOS_SHORTCUT_URL`; o botão "Adicionar o atalho" aparece.

## Status
Implementado e testado em testes automatizados; falta validar em um iPhone real.
