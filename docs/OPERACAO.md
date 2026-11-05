# FINNOS · Operação

O que precisa ser feito fora do código para monitoramento, segurança e backups, e como verificar cada item.

## 1. Monitoramento de erros (Sentry)
O código já está pronto e fica **desligado** enquanto não houver DSN.

1. Crie uma conta em sentry.io (o plano gratuito atende) e dois projetos: **finnos-web** (React) e **finnos-api** (Python/FastAPI).
2. Na Vercel, em Project → Settings → Environment Variables (Production e Preview), cadastre:
   - `VITE_SENTRY_DSN`: o DSN do finnos-web;
   - `SENTRY_DSN`: o DSN do finnos-api.
3. Faça um novo deploy: as variáveis `VITE_*` entram na build.
4. Para conferir, force um erro (por exemplo, uma URL de API inexistente) e veja se o evento chega ao Sentry.

**O que nunca é enviado**, garantido por `scrub` / `scrubEvent`, que têm testes:
- corpo das requisições;
- cookies e cabeçalhos de autenticação;
- parâmetros da URL (`?month=…`);
- variáveis locais da pilha;
- identidade do usuário;
- dados dos breadcrumbs.

O tracing e o session replay estão desligados.

## 2. Política de segurança (CSP)
O `vercel.json` envia, nas páginas e nos arquivos do app (a API responde só JSON):
- **Valendo já:** `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options: DENY` e `Permissions-Policy` (câmera e microfone só no próprio site).
- **Em observação:** `Content-Security-Policy-Report-Only`. O navegador só **avisa** o que bloquearia, sem quebrar nada.

**Para passar a valer:**
1. Em produção, abra o console do navegador e use o app inteiro: login com Google, ler uma foto de recibo, importar um PDF, abrir gráficos.
2. Anote qualquer aviso `[Report Only]`. Se aparecer um domínio legítimo, ele entra na diretiva correspondente.
3. Sem avisos por alguns dias, renomeie o cabeçalho para `Content-Security-Policy` no `vercel.json`.

**Domínios liberados hoje:**
- `apis.google.com`, `www.gstatic.com`, `*.googleapis.com` e `*.firebaseapp.com`: login Firebase com Google.
- `cdn.jsdelivr.net`: worker e idioma do leitor de recibos (tesseract.js).
- `*.ingest.sentry.io`: monitoramento.

## 3. Regras do Firestore (com você)
Com o PR #56 em produção, o navegador **não acessa mais o Firestore diretamente**: toda leitura e escrita passa pela API, que usa o Admin SDK e ignora as regras. Por isso, as regras podem ficar totalmente fechadas para clientes:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

**Antes de publicar:**
- Confirme no Firebase Console → Firestore → Uso que não há leituras de clientes web nos últimos dias.
- Publique primeiro no projeto de teste e depois em `finnos-app`.

Nenhuma automação do projeto altera regras nem IAM: essa mudança é sua.

## 4. Backup semanal
- **Agendamento:** o workflow `backup-weekly.yml` roda toda segunda às 06:00 UTC e usa o segredo `FINNOS_CRON_SECRET`, o mesmo do dispatcher de notificações. Sem o segredo, ele é pulado.
- **Verificação:**
  - Em GitHub → Actions → "FINNOS · Backup semanal", o log mostra só contagens (`users/saved/skipped/failed`).
  - No app, Configurações → Dados e backup lista as cópias, e cada uma pode ser baixada.
- **Rodar na hora:** Actions → "FINNOS · Backup semanal" → Run workflow.
