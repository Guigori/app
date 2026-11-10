# 08 — Apple, Apple Pay e Atalhos

## Objetivo
Registrar receitas e despesas pelo iPhone, inclusive sem abrir o FINNOS, para qualquer usuário com conta.

## Como funciona
Configurações → Integrações e automações. A tela mostra só **Apple Pay** (compras pendentes) e as opções de IA. Os fluxos antigos foram **removidos por completo**: o atalho pronto (`registrar-no-finnos.shortcut` e `scripts/build_shortcut.py`), `GET /api/shortcuts/opcoes`, `POST /api/shortcuts/lancamentos` e o link "abrir já preenchido" (`/registro-inteligente#texto=…`, `#valor=…`). Toda compra do Apple Pay passa pela revisão.

**Tela do Apple Pay:** no topo, o estado ("Funcionando · última compra em…", "Falta terminar no iPhone" ou "Ainda não configurado"); depois, como as compras são registradas (débito padrão, aprendizado, registrar automaticamente); os iPhones conectados com **Desconectar**; e o passo a passo no iPhone, recolhido quando as compras já estão chegando.

- **Código de conexão** (conta FINNOS): o usuário gera um código pessoal (`fns_…`) e o coloca na automação.

- **Apple Pay**: a automação Transação chama `POST /api/shortcuts/pendentes` com `valor`, `descricao` (comerciante), `carteira` (nome do cartão, como o Apple Pay informa), e opcionalmente `data` e `id`.
  - A compra fica numa fila no servidor (`users/{uid}/pending_captures`), **sem abrir o app e sem entrar no saldo**.
  - Aparece em **Compras pendentes** no Início e no Fluxo, e no sino (Avisos). Cada uma tem **Registrar** (vira um lançamento comum, com a mesma validação do app) e **Excluir**.
  - **De onde saiu o dinheiro**: o servidor compara o nome do cartão com os cartões e contas cadastrados, sem diferenciar maiúsculas e acentos. Achou um cartão: mostra "Cartão X · fatura paga por Y". Achou uma conta: "Conta X". Não achou, ou achou mais de um: a compra é guardada mesmo assim, marcada como **não cadastrada**, e o app exige escolher cartão ou conta antes de registrar. Nunca assume a primeira conta.
  - Cadastrar o cartão depois limpa o aviso sozinho: a origem é conferida de novo a cada abertura.
  - Resposta `{"ok", "mensagem", "id", "repetido", "nome", "valor", "origem", "cadastrado"}`. O mesmo envio repetido em até 2 minutos (ou com o mesmo `id`) vira uma pendência só. Limite de 100 pendências por usuário.
  - `GET /api/pending-captures`, `POST /api/pending-captures/{id}/confirm` (corpo opcional: `account_id`, `card_id`, `category_id`, `name`, `value`, `date`, `installments`) e `DELETE /api/pending-captures/{id}` usam a sessão do app. Registrar duas vezes grava uma só; sem categoria, usa a do último lançamento com o mesmo nome.
  - Passo a passo no app: Configurações → Integrações → "Apple Pay".
  - **Tela:** cada compra é uma linha curta com o resumo do que será registrado ("Débito · Itaú · Mercado") e os botões **Registrar** e **Alterar** (ou **Completar**, quando falta conta ou cartão). Alterar abre um painel de baixo com tudo da compra. O Início mostra só as 3 mais urgentes (as esquecidas primeiro) e "Ver todas" leva ao Fluxo, que lista todas.
  - **Débito ou Crédito:** no painel, a escolha fica no topo, com **Débito como padrão**. Débito pede a conta (sai na hora). Crédito pede o cartão e as parcelas, e mostra em qual fatura a compra cai (a primeira com fechamento no dia da compra ou depois, como em `lib/cards.py`). `POST /api/pending-captures/{id}/confirm` aceita `method` = `debito` | `credito`; débito parcelado é recusado.
  - **Aprendizado** (`users/{uid}/capture_rules`): cada registro feito pela pessoa guarda (1) o comerciante normalizado (`merchant_key`: sem acento, sem prefixo de maquininha como `PAG*`, sem códigos com número, sem LTDA) com a categoria usada, e (2) o nome do cartão do Apple Pay com a conta do débito e o cartão do crédito. A lista (`GET /api/pending-captures`) devolve `suggested_method` (sempre `debito`), `suggested_account_id`, `suggested_card_id`, `suggested_category_id`, `learned_wallet` e `learned_category`. Corrigir a categoria uma vez passa a valer a nova.
  - **Conta e cartão com o mesmo nome** (por exemplo a conta "Nubank" e o cartão "Nubank Roxinho", e o Apple Pay manda "Nubank"): a lista devolve `ambiguous: true` e a compra mostra dois botões de um toque, "Débito · Nubank" e "Crédito · Nubank Roxinho". Nada é assumido: essas compras ficam fora do lote e nunca são registradas automaticamente.
  - **Marca no Fluxo:** todo lançamento vindo da fila tem `capture` = `apple_pay` (revisado) ou `apple_pay_auto` (automático) e `capture_unusual` quando foi registrado com valor alto. O Fluxo mostra o selo "Apple Pay" / "Apple Pay · automático" (e "valor alto") e tem o filtro Origem; `/transacoes?origem=apple-pay` ou `?origem=apple-pay-auto` abre filtrado.
  - **Registrar em lote:** `POST /api/pending-captures/confirm-all` registra no débito só as que já têm conta sugerida; as outras continuam esperando.
  - **Cartão não cadastrado:** a pendência avisa e oferece "Cadastrar como conta ou vale" (no Débito) ou "Cadastrar como cartão" (no Crédito), abrindo as telas que o app já tem com o nome do Apple Pay preenchido; ou a pessoa escolhe outra conta ou cartão na lista, e essa escolha é aprendida para as próximas.
  - **Registrar automaticamente** (desligado por padrão, `GET/PUT /api/pending-captures/settings`): só no débito, quando o mesmo nome de cartão do Apple Pay foi registrado na mesma conta 3 vezes seguidas e o comerciante teve a mesma categoria 3 vezes seguidas (`AUTO_AFTER`), com data não futura e valor até 2× a média do comerciante (`AUTO_MAX_RATIO`). Essa trava tem botão próprio ("Esperar quando o valor fugir do normal", `hold_unusual`, ligado por padrão); desligada, a compra é registrada e marcada "valor alto". `PUT /settings` só muda os campos enviados. Uma compra no crédito zera a sequência daquele cartão. Cada uma vai para `users/{uid}/pending_auto`, aparece no Início numa linha recolhida "N registradas automaticamente" (7 dias), aberta em "Conferir" e gera push. `POST /api/pending-captures/auto/{id}/undo` apaga o lançamento, devolve a compra para as pendentes e zera as sequências; `DELETE /api/pending-captures/auto/{id}` confirma ("está certo").
  - **Aviso:** o sino mostra a pendência (com "pendente há N dias" a partir de 3 dias). Com push configurado no servidor (`FINNOS_PUSH_ENABLED`, chaves VAPID) e o app instalado na tela de início, chega também um aviso sem o valor.
  - **Compra de teste:** `POST /api/pending-captures/test` cria uma pendência falsa que só pode ser excluída.
  - **Ativação no app:** Configurações → Integrações → "Apple Pay" (explicação animada, passo a passo com desenho de cada tela, teste e opções). Para mostrar capturas reais de tela em vez dos desenhos, coloque `passo-2.png` a `passo-6.png` em `frontend/public/atalhos/passos/`.
  - **Limite do iOS:** automações pessoais (como a de Transação) não podem ser compartilhadas como atalho pronto; só atalhos comuns. Por isso a automação é guiada passo a passo.
- **Notificações da Carteira**: indisponível; o iOS não permite que apps ou sites leiam notificações de outros apps.

## Regras
- O código é mostrado uma vez e guardado só como hash SHA-256 em `integration_tokens` (coleção só do servidor).
  - Ele só cria compras pendentes. Os iPhones conectados ficam na tela do Apple Pay, com Desconectar.
  - Limite de 60 usos por hora; até 5 códigos por usuário; revogável a qualquer momento.
  - Uma conta desativada ou sem e-mail confirmado também desativa o código.
- O lançamento passa pela mesma validação e gravação do app (contas, cartões, faturas, parcelas) e fica com `source = "ios_shortcut"`, `operation_id = "pending:<id>"` e `capture_auto` / `capture_unusual`.
- O mesmo envio repetido em até 2 minutos (ou com o mesmo `id`) grava uma vez só.
- Cada uso, aceito ou recusado, fica em `users/{uid}/integration_audit` e aparece em Atividade recente.

## Status
Implementado e testado em testes automatizados; falta validar em um iPhone real.
