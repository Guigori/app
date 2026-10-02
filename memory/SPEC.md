# FINNOS — Gestão Financeira Pessoal (spec vivo)

App web/PWA de finanças pessoais em **pt-BR (R$)**. Visual fintech consumer.
**Identidade (logo do cliente)**: wordmark FINN⬤S com o "O" como rosca segmentada
(`components/brand/FinnosLogo.tsx`), tinta `#10142B` + roxo `#5B3FE4`/`#8B74F0`.
Sora (títulos/valores) + DM Sans (texto). Light / **dark neutro real** (`#0A0A0C`,
sem tom azulado) / system. **Sem mascote** — removido a pedido do cliente.

> UI/UX: redesenho no padrão do app **Calen** (menu agrupado, abas no topo, chips,
> tiles lilás) está PENDENTE — aguardando o cliente enviar todas as fotos de referência.

Stack: FastAPI + MongoDB (motor) / Vite + React 19 + TS strict + Tailwind v4 + shadcn (base-nova).

## Escopo entregue
Estrutura global, autenticação (com código por e-mail), sidebar/mobile nav, botão
**Voltar** em todas as telas internas, dashboard, contas, categorias, transações
(CRUD + filtros + parcelamento), responsividade, botão global "+", PWA, dark mode,
dados demo, **conta local** e **FINNOS IA com chave do próprio usuário**.
**Placeholders "Em breve"**: Cartões, Orçamento, Assinaturas, Metas, Investimentos.

## Dois modos de uso (`src/lib/mode.ts`)
- **Conta completa** (`account`): dados no servidor, login com e-mail confirmado.
- **Conta local** (`local`): nada sai do navegador. Toda a lógica roda em
  `src/lib/local/engine.ts` (espelho de `backend/lib/stats.py`) sobre localStorage
  (`src/lib/local/store.ts`). A FINNOS IA não funciona neste modo (os dados não
  chegam ao servidor) e a UI diz isso explicitamente.
- `src/lib/data.ts` é a ÚNICA fronteira de dados das páginas: decide servidor vs local.
  Toda nova tela deve chamar `data.ts`, nunca `apiGet` direto.

## Autenticação (fluxo atual)
1. `POST /api/auth/signup` (nome, e-mail, senha + **confirmação de senha**) → cria
   usuário NÃO verificado, envia **código de 6 dígitos** por e-mail → `202`, sem sessão.
2. `POST /api/auth/verify-email` (e-mail + código) → marca verificado, cria categorias
   padrão e abre a sessão (cookie httpOnly).
3. `POST /api/auth/resend-code` → novo código (cooldown de 60s).
- Código: guardado só como hash pbkdf2, expira em 15 min, máx. 5 tentativas.
- `login` de e-mail não confirmado → `403`. E-mail indeliverable → `400` com
  mensagem clara (não 502).
- E-mail transacional: integração gerenciada da Emergent (`lib/email.py`), templates
  server-side, com gate anti-phishing (sem formulários, sem links não-https).

## FINNOS IA (chave do próprio usuário)
- O app **não embute** chave de LLM. Cada usuário cadastra a dele em Configurações:
  ChatGPT (OpenAI), Claude (Anthropic) ou Gemini (Google).
- `PUT /api/ai/keys` valida a chave com uma chamada real antes de salvar; a chave é
  criptografada (Fernet, `FERNET_KEY` no .env), nunca retorna ao frontend (só máscara
  `sk-•••1234`) e nunca vai para log.
- `POST /api/ai/ask` monta o contexto financeiro no servidor (`lib/ai_context.py`),
  delimita os dados do usuário em `<dados>` como conteúdo NÃO confiável (defesa contra
  prompt injection) e trunca em 9000 chars. Erros do provedor (401/429/cota/modelo)
  viram mensagens específicas em português.

## Modelo de dados (Mongo; todo registro financeiro tem `user_id`)
- `users` — id (uuid4), name, email (único), password_hash (pbkdf2_sha256),
  email_verified, verification_code_hash/expires_at/attempts/sent_at, created_at
- `sessions` — token (uuid4), user_id, expires_at (30d) → cookie httpOnly `finnos_session`
- `accounts` — name, institution, type (corrente|salario|digital|poupanca|carteira), color, initial_balance, active
- `categories` — name, icon, color, group (necessidades|desejos|metas), monthly_budget, monthly_goal
- `transactions` — name, value, type (receita|despesa|transferencia), status (pago|pendente|agendado),
  date `YYYY-MM-DD`, account_id, to_account_id, category_id, fixed, recurrence, installment,
  total_installments, current_installment, installment_value, adjusted_value, attachment, notes
- Índices em `lib/db.py`; ids são uuid4 string (nunca ObjectId).

## Regras de negócio (backend/lib/stats.py)
- **Saldo**: `initial_balance` + efeitos de transações com `status="pago"`. Pendente/agendado
  nunca move saldo. Parcelado soma apenas as parcelas já vencidas (`min(due, total)`).
- **Mês (receita/despesa)**: parcelado entra como 1 `installment_value` por mês, da compra
  até a última parcela — parcelas futuras não duplicam no mês atual.
- **50/30/20**: limites = 50/30/20% da **receita do mês**; status dentro(≤80%)/proximo(≤100%)/acima.
- **Comparação mês anterior**: só quando o mês anterior tem dados (`prev_income/prev_expense = null`
  caso contrário) — nunca comparação falsa.
- Transferência não conta como receita/despesa; `value` usa `adjusted_value` quando informado.

## API (tudo em `api_router`, prefixo `/api`)
`POST /auth/signup|login|logout`, `GET|PATCH /auth/me` ·
`GET|POST /accounts`, `GET|PUT|DELETE /accounts/{id}` (detalhe traz últimas 8 tx) ·
`GET|POST /categories`, `PUT|DELETE /categories/{id}` ·
`GET|POST /transactions` (filtros: month, type, status, category_id, account_id, search),
`PUT|DELETE /transactions/{id}` · `GET /dashboard?month=YYYY-MM` · `POST /demo/load|clear` ·
`POST /auth/verify-email|resend-code` · `GET /ai/providers`, `GET|PUT /ai/keys`,
`DELETE /ai/keys/{provider}`, `POST /ai/ask`

Autorização: toda query filtra por `user_id` da sessão → um usuário nunca lê dados de outro
(404 em recurso alheio). Excluir conta/categoria com transações vinculadas → 409.

## Rotas do frontend
`/login`, `/cadastro` (públicas) · `/` dashboard, `/transacoes`, `/contas`, `/categorias`,
`/configuracoes` · `/cartoes` `/orcamento` `/assinaturas` `/metas` `/investimentos` (Em breve).
`RequireAuth` protege tudo; sem sessão → `/login`.

## Dados demo
- Conta demo pronta: `demo@finnos.app` / `demo1234` (criada por `backend/seed.py`, idempotente).
- Botão "Carregar dados demo" em Configurações substitui os registros do usuário logado;
  "Limpar meus dados" devolve a conta ao estado real. Quem se cadastra começa **vazio**,
  com 15 categorias padrão — demo nunca se mistura com dados reais.
- Demo: 4 contas (Nubank, Inter, Itaú, Carteira), 2 meses de histórico, 1 parcelamento
  (MacBook 10x de R$ 600, parcela 3), despesas fixas, 1 agendada e 1 pendente.

## Analytics + Orçamento (entregue)
- `GET /api/analytics/trends` — últimos 6 meses (label pt-BR, income/expense/net) para os
  gráficos das folhas de detalhe.
- `GET /api/analytics/budget?month=YYYY-MM` — planejado/utilizado/restante/percentual,
  receita do mês, gasto sem orçamento e linhas por categoria agrupadas por 50/30/20.
- Home: os 4 cards de resumo (Receitas, Despesas, Saldo do mês, Investimentos) são
  clicáveis e abrem `MetricDetailSheet` com barras dos 6 meses + tabela de fluxo de caixa.
- Página `/orcamento`: resumo do mês, barras por categoria com status (uso normal /
  próximo do limite / limite ultrapassado, com ícone+texto além da cor) e edição inline
  do orçamento da categoria. Mutações invalidam `categories`, `dashboard`, `budget` e
  `trends` — o resumo atualiza sem trocar de mês.

## Pendente / futuro (arquitetura preparada, nada fictício na UI)
- **Redesenho UI/UX no padrão Calen** — aguardando fotos de referência do cliente.
- Cartões, assinaturas, metas, investimentos.
- Recuperação de senha por e-mail (a infra de e-mail já está pronta).
- Migrar dados da conta local para a conta completa.
- Open Finance/OFX/CSV, múltiplas moedas, notificações.

## Observações de implementação (armadilhas já resolvidas)
- `PUT /transactions/{id}` preserva o `id` (regenerá-lo órfã o registro).
- Saldo usa **status** como fonte da verdade (`pago` conta, independente da data).
- Dashboard: o nome de cada fatia da rosca é re-resolvido por fatia (reusar a variável
  do loop anterior nomeava todas as fatias igual).
- Toasts em `bottom-center`: em `bottom-right` cobriam o FAB e engoliam o clique.
- FAB usa DropdownMenu (um Popover controlado reabria ao focar o trigger).
