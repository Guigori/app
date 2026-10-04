# 06 — Segurança

FINNOS trata dados financeiros como sensíveis. Nenhum componente é considerado seguro apenas por usar Firebase.

## Requisitos
- HTTPS;
- Firebase Authentication para identidade remota;
- validação de token no FastAPI;
- autorização por usuário/espaço em toda operação;
- Firestore Security Rules com deny-by-default;
- App Check onde aplicável;
- secrets somente no servidor/secret manager;
- rate limiting e proteção contra abuso;
- logs sem senhas, tokens ou conteúdo financeiro desnecessário;
- backups e restauração testados;
- princípio de menor privilégio;
- MFA obrigatório para contas administrativas;
- ambientes de desenvolvimento/produção separados.

## Regra crítica
Conhecer um `transaction_id`, `account_id` ou outro ID nunca concede acesso. O servidor/regras devem confirmar propriedade.

## Testes obrigatórios
Criar ao menos usuários A e B e provar que A não consegue ler/escrever/excluir dados de B, inclusive alterando IDs/requisições manualmente.

## Criptografia
Avaliar criptografia de campos/backup em nível de aplicação conforme modelo de ameaça. Não criar criptografia própria sem revisão.
