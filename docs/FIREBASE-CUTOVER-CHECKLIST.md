# FINNOS — aprovação do cutover ainda pendente

Projeto de testes criado: `finnos-dev`, Spark, Firestore Standard `(default)` em `southamerica-east1`, acesso direto negado pelas regras. `finnos-app` foi preservado. Localização e dois papéis IAM foram aprovados pelo proprietário durante a preparação.

## Configuração exclusiva do Preview

Conta de serviço: `finnos-preview-api@finnos-dev.iam.gserviceaccount.com`; somente Datastore User e Firebase Authentication Admin no projeto dev. Não conceder Editor/Owner nem papéis em `finnos-app`. A chave administrativa precisa ser criada e inserida pelo proprietário no segredo da Vercel. Não copiar a chave para Git, logs, relatórios ou campos de frontend.

Criar um app Web em `finnos-dev` e configurar as variáveis abaixo **somente em Preview desta branch**:

- `FIREBASE_PROJECT_ID=finnos-dev`.
- `FIREBASE_SERVICE_ACCOUNT_JSON`: segredo administrativo do projeto dev.
- `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_APP_ID` e demais campos da configuração Web dev.
- `FERNET_KEY`: segredo exclusivo dev para criptografia das chaves dos provedores de IA.
- `FINNOS_AI_PAID_CALLS_ENABLED`: deixar ausente até aprovação de custos de testes de IA.

Não substituir valores de Production. O backend financeiro falha fechado se Preview apontar para `finnos-app` ou se o projeto da credencial não corresponder ao configurado. O entrypoint continua indisponível fora de Preview/development; habilitar produção é uma etapa futura aprovada, não está implementada como promoção automática.

## Três identidades de teste

UIDs existentes a preservar:

- A: `finnos-preview-b68274e7-369c-4957-bed9-1958ae98dbb2-a`.
- B: `finnos-preview-b68274e7-369c-4957-bed9-1958ae98dbb2-b`.
- C: `finnos-preview-b68274e7-369c-4957-bed9-1958ae98dbb2-c`.

E-mails no destino dev: `teste.a@finnos.test`, `teste.b@finnos.test`, `teste.c@finnos.test`. Não alterar identidades na origem. `copy_preview_test_users.py` confere as identidades sintéticas, referências e conteúdo persistido; copia apenas os recursos definidos e mantém os mesmos UIDs no destino. Sem `--execute`, só inspeciona a origem. Com execução, solicita senhas fortes distintas via entrada oculta; use o app Senhas da Apple para gerar e guardar cada senha. Nenhuma senha vai para arquivos. As contas ficam verificadas administrativamente somente no dev, sem depender de e-mails fictícios.

Credenciais administrativas devem ficar fora do repositório e ser disponibilizadas por caminhos locais protegidos nas variáveis `FINNOS_SOURCE_ADMIN_FILE` e `FINNOS_DEV_ADMIN_FILE`. A origem é sempre `finnos-app` e só é lida; o único destino permitido é `finnos-dev`.

```sh
python backend/scripts/copy_preview_test_users.py
python backend/scripts/copy_preview_test_users.py --execute
```

Antes de copiar, verificar contas e contagens esperadas, preservação dos saldos e quaisquer novos registros do Preview. Depois, login convencional, logout, sessão persistente, parcelas, pagamentos e seis pares de isolamento precisam ser repetidos no Chrome. Recuperação de senha deve ser ensaiada com um link administrativo mantido privado, pois os e-mails de teste não recebem mensagens. Remover o acesso especial de validação **após** esses testes passarem; não desativá-lo antecipadamente e perder o acesso às identidades originais.

## Histórico MongoDB: origem ainda não disponível

A origem do backend antigo é configurada por `MONGO_URL` e `DB_NAME` em `backend/.env`. As variáveis não foram encontradas no projeto Vercel consultado nem no ambiente local. O README aponta para `mongod` local no pod antigo, sem comprovação do host atual ou quantidades de documentos. Não existe inventário real nem backup histórico certificado nesta etapa.

Disponibilizar uma conexão **somente leitura** ao banco FINNOS e ao seu nome, em um ambiente protegido fora do Git, ou um dump BSON nativo produzido no backend antigo. Não enviar URI/senha pelo chat. Precisamos também da versão MongoDB, informação de replica set/standalone e do critério de consistência do dump. Se houver gravações concorrentes, um dump sem snapshot/oplog não prova consistência financeira.

Inventariar todas as coleções, inclusive as não incluídas na allowlist de migração; registrar contagens, índices e relações por usuário sem publicar dados pessoais. Produzir um arquivo BSON nativo com as ferramentas oficiais `mongodump`; usar autenticação interativa/configuração protegida, sem credenciais na linha de comando. Para replica set, avaliar dump consistente com oplog com o administrador da origem. Nenhuma pausa ou alteração de produção será executada automaticamente.

Criptografar o arquivo nativo e validar a recuperação byte a byte:

```sh
python backend/scripts/encrypted_backup.py --archive /caminho-privado/dump.archive --output /caminho-privado/dump.archive.enc
```

A senha do backup deve ser distinta e guardada no app Senhas. Guardar o arquivo criptografado e os hashes em armazenamento protegido. O teste criptográfico não substitui um ensaio `mongorestore` em MongoDB isolado: verificar índices, contagens, relações e valores após restaurar. Não restaurar sobre a origem.

Exportar as coleções financeiras para JSON estendido com IDs estáveis; conferir um mapeamento de proprietário legado → UID Firebase, com evidência e aprovação humana. Não inferir propriedade apenas por nome ou similaridade de e-mail. O plano rejeita precisão monetária além de centavos, referências ausentes e registros sem proprietário comprovado.

```sh
python backend/scripts/finance_migration_plan.py --export /caminho-privado/export.json --ownership /caminho-privado/ownership-reviewed.json --output /caminho-privado/plan.json
python backend/scripts/finance_migration_plan.py --export /caminho-privado/export.json --ownership /caminho-privado/ownership-reviewed.json --output /caminho-privado/rehearsal-plan.json --rehearse --run historical-rehearsal
```

O ensaio só grava em `finnos-dev/migration_runs/<run>/users/...`, nunca na área financeira ativa. É idempotente, compara hashes na releitura e recusa sobrescrever divergências. A preparação exclui credenciais legadas; o backup nativo completo continua sendo a fonte de recuperação. O antigo modo `--execute` foi bloqueado, pois copiava para coleções globais sem comprovar propriedade.

Ainda precisa de tratamento explícito e comparação de pagamentos de faturas legados (`paid_cycles`), datas BSON e eventuais saldos já consolidados. Não certificar um plano histórico com fixtures como se tivesse usado os dados originais.

## Gate final

Não migrar histórico real, desligar MongoDB, alterar `main`, promover Preview ou habilitar produção sem aprovação explícita. Antes da aprovação: todos os módulos no dev, três logins convencionais, isolamento e sincronização reais, backup restaurado e histórico reconciliado. Backups programados/PITR exigem avaliação de faturamento; não houve upgrade Blaze. Consultas do adaptador atual têm limite de leitura por usuário e falham em vez de exibir totais truncados. A paginação/indexação por volume real deve ser avaliada com o inventário. As leituras administrativas ignoram regras Firestore e dependem das verificações UID do FastAPI; regras deny-all mantêm o cliente fechado.
