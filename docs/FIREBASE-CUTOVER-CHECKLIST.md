# FINNOS — projeto único e aprovação de produção pendente

Decisão atual do proprietário: utilizar somente `finnos-app` para Authentication e Firestore. `finnos-dev` fica preservado e inativo; não executar os procedimentos antigos de cópia para ele. Preview e produção da Vercel continuam separados. Nenhuma promoção/merge está autorizada.

## Identidades e configuração

O Preview desta branch usa `FIREBASE_PROJECT_ID=finnos-app` e reaproveita a credencial administrativa já existente. Não criar novas chaves, não alterar a credencial de produção nem expor valores. O backend exige correspondência entre projeto configurado e credencial e continua indisponível em produção até implantação autorizada.

A conta pessoal autenticada pelo Google é preservada no mesmo UID. Não transferir registros financeiros nem conceder privilégios administrativos à conta pessoal apenas para usá-la como principal. Os UIDs de teste A/B/C existentes são preservados. Não excluir outros usuários sem revisão e autorização.

Para vincular `teste.a@finnos.test`, `teste.b@finnos.test`, `teste.c@finnos.test` aos UIDs sintéticos aprovados:

```sh
python backend/scripts/configure_test_users.py --credential /caminho-protegido/credencial.json
python backend/scripts/configure_test_users.py --credential /caminho-protegido/credencial.json --execute
```

O script faz preflight das três identidades, verifica colisões de e-mail antes de alterar qualquer uma, solicita senhas de pelo menos 20 caracteres por entrada oculta e altera apenas a autenticação dos UIDs de teste. O proprietário gera e guarda as senhas no app Senhas da Apple. Os hashes dos documentos financeiros são comparados antes/depois; nenhum documento é escrito. Nenhuma senha é armazenada em texto puro. Testar login/logout, persistência, recuperação administrativa privada (os e-mails fictícios não recebem mensagens) e isolamento. Só então desativar o acesso especial de validação.

## Backup Firestore atual

`backup_firebase_users.py` lê somente o UID pessoal confirmado e os três UIDs sintéticos aprovados. Captura em duas leituras comparadas e criptografa o arquivo com AES-GCM; a chave temporária é encapsulada com a chave pública da credencial administrativa já existente. Nenhum documento é escrito. A recuperação depende de manter com segurança a mesma chave privada; a exclusão ou perda do arquivo privado impede a recuperação deste backup.

```sh
python backend/scripts/backup_firebase_users.py --credential /caminho-protegido/credencial.json --output /caminho-protegido/backup.enc.json
python backend/scripts/backup_firebase_users.py --credential /caminho-protegido/credencial.json --output /caminho-protegido/backup.enc.json --verify-existing
```

Um backup real de 28 documentos foi gerado e recuperado criptograficamente em 12/10/2026. Não é um backup completo de todo o projeto, um snapshot transacional de coleções arbitrárias, nem um ensaio de restauração no Firestore. Não executar restauração sobre dados pessoais sem revisão e autorização.

## Histórico e recuperação

A origem MongoDB ainda depende de conexão somente leitura ou dump BSON nativo, sem credenciais no chat. Inventariar coleções, contagens, índices, relacionamentos e propriedade. Criar backup nativo consistente e criptografado; validar restauração em MongoDB isolado antes de qualquer migração real.

`encrypted_backup.py` criptografa e verifica recuperação byte a byte de um arquivo de backup já produzido. `finance_migration_plan.py` valida precisão monetária, referências, IDs, datas e mapeamento de propriedade aprovado. O modo de ensaio antigo para finnos-dev não deve ser executado: preparar destino de ensaio revisado antes de usá-lo. Pagamentos legados e saldos consolidados ainda requerem reconciliação. O antigo migrador MongoDB com --execute continua bloqueado.

No projeto compartilhado, testes só podem alterar os três UIDs fictícios aprovados, sem operações destrutivas em dados pessoais. Backups e mecanismos de restauração precisam ser verificados com dados reais; testes de fixture não certificam um backup original. Backups pagos/PITR exigem aprovação de custos. Não alterar regras Firestore, desligar MongoDB, migrar histórico real, promover produção ou fazer merge sem aprovação.

## Gate final

Todos os módulos e cálculos no navegador; três logins e seis acessos cruzados; sincronização real offline/reconexão/troca de usuário; chaves IA criptografadas e chamadas pagas somente após aprovação de custos; backup restaurado e histórico reconciliado. Manter PR #4 em rascunho até concluir esses critérios.
