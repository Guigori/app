# 07 — Backup, Importação e Exportação

Backup é independente do modo de conta.

## Destinos planejados
- iCloud Drive;
- Google Drive;
- ambos;
- nenhum.

## Conceitos
**Backup:** cópia restaurável completa do estado FINNOS.

**Exportação:** formato interoperável para uso externo (ex.: CSV/planilha quando suportado).

**Importação:** entrada de dados externos com validação, prévia e prevenção de duplicidade.

**Sincronização:** mantém dispositivos atualizados; não é sinônimo de backup.

## Formato FINNOS
Planejado um formato versionado de backup (ex.: `.finnos`) com criptografia e metadados mínimos para restauração. Especificação ainda pendente.

## Segurança
Nunca gravar senha/token em exportações. Backups financeiros em nuvem devem ser protegidos e a restauração deve validar versão/integridade.
