# 02 — Arquitetura

## Alvo

```text
React / TypeScript / Vite
        |
        +--> Modo Local --> armazenamento local
        |
        +--> Firebase Authentication
                    |
              token de identidade
                    |
                FastAPI
              /         \
     regras sensíveis   Firestore
```

## Responsabilidades
**Frontend:** interface, estado de apresentação e operações permitidas ao cliente.

**Firebase Authentication:** cadastro, login, identidade, provedores Google/Apple, verificação/recuperação conforme configuração.

**FastAPI:** valida token Firebase, aplica autorização e regras de negócio, protege secrets, integra serviços externos e executa operações privilegiadas.

**Firestore:** persistência da Conta FINNOS. Cada documento financeiro deve possuir vínculo inequívoco com usuário/espaço.

**App Check:** camada adicional contra clientes não autorizados; não substitui Authentication nem autorização.

## Legado
O backend atual usa MongoDB (`MONGO_URL`/`DB_NAME`), sessões próprias e cookies httpOnly. A migração será incremental. Não apagar rotas/dados legados antes dos testes de equivalência e plano de migração.

## Regra de dependência
Funcionalidades locais não devem depender de disponibilidade do Firebase/FastAPI para leitura dos dados locais.
