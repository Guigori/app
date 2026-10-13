# FINNOS — validação para uso diário (12/10/2026)

## Autenticação corrigida

A causa da falha A era o formulário chamar `/api/auth/login`, rota legada ausente no Preview,
e exibir uma mensagem genérica de senha incorreta. A configuração das senhas não foi alterada.
Login/cadastro/verificação e recuperação agora usam o SDK Firebase; apenas o ID token é enviado
para a sessão HTTP-only do FastAPI. O cadastro usa link de confirmação, em lugar do código legado.
Dados locais não são enviados à rota antiga de migração: ficam preservados no aparelho e a limitação
é comunicada ao usuário. O acesso especial sem senha foi retirado após os logins A/B/C passarem.

Preview `finnos-app`: e-mail/senha e Google ativados, confirmado no Console. A/B/C entraram com as
credenciais existentes do cofre, exibindo R$ 17.055,07 / R$ 20.998,28 / R$ 24.941,50.
A preservou sessão após reload; logout e troca A→B→C ocorreram sem dados do perfil anterior.
Founder teve login Google, logout e novo login comprovados na validação anterior.
Nenhuma senha foi redefinida. Não houve reimportação da demonstração.

## Operações e isolamento

66 verificações reais passaram no mesmo entrypoint FastAPI, via TestClient, com tokens/sessões
Firebase reais e Cloud Firestore real, sem mocks de autenticação ou banco. Para os testes de API,
tokens customizados administrativos foram usados somente nas quatro identidades aprovadas;
isso não substitui os logins convencionais comprovados separadamente no navegador.

- Sessões verificadas e logout nos quatro UIDs.
- 36 leituras cruzadas negadas (12 pares direcionais × contas/cartões/transações).
- Identidade divergente no cabeçalho negada nos quatro perfis; referência de conta estrangeira rejeitada.
- Criação, leitura, edição e exclusão de transação temporária com saldo atualizado.
- Centavos persistidos como inteiros; transferências atualizam origem e destino.
- Compra parcelada não debita conta bancária; três parcelas de R$ 33,33 / 33,33 / 33,34.
- Pagamento parcial e total debita uma vez; repetição retorna o mesmo resultado;
  reutilização com valor diferente retorna conflito. Limite ajustado exatamente.
- Compra em ciclo pago protegida contra exclusão; versão offline antiga rejeitada com 409.
- Registros temporários da API removidos exclusivamente pelos IDs criados no teste.
  Documentos anteriores comparados e intactos; revisão interna incrementada normalmente.

Os pagamentos foram testados pela API local com o banco real; não se afirma que um pagamento
foi submetido na tela da Vercel. O navegador comprovou login, leitura e persistência da sincronização.

## Mobile e offline

Chrome DevTools, preset iPhone 16: viewport observado 393 × 852, documento com largura 393.
Home, navegação Carteira→Fluxo e formulário financeiro foram usados nessa dimensão.
É emulação de viewport, não teste em iPhone físico.

Uma despesa temporária de R$ 0,01 foi salva com rede Offline no DevTools: toast confirmou salvamento
local e Firestore tinha zero documentos com o identificador do teste. Após reconectar, apareceu
exatamente um documento, `value_cents=1`, `version=1`. O ID de operação é durável e a API recusa
replay com conteúdo diferente. Conflitos e troca de UID também têm testes automatizados.

Foi encontrado um defeito de apresentação: React Query pausava consultas offline, ocultando a linha
salva da lista. O cliente agora permite leitura local offline e execução imediata das mutações para
que a fila seja gravada em IndexedDB; `sync-success` invalida as consultas para atualizar os dados.
A nova regressão executa MutationObserver offline e verifica a gravação durável, sem pausa em memória.

## Segurança e implantação preparada

As regras reais de Firestore foram lidas via API administrativa: `allow read, write: if false`.
Nenhuma regra mudou. Acesso financeiro é exclusivamente via FastAPI com UID verificado e validação
de referências. Cookies são Secure/HttpOnly/SameSite=lax em Preview e futura produção; sem cache.

Produção continua bloqueada por padrão. A branch prepara ativação explicitamente por
`FINNOS_FIREBASE_PRODUCTION_ENABLED=1` somente após aprovação; a configuração ainda não foi aplicada
na Vercel. Diagnostics e validação antiga não poderão operar em produção. Main/produção não alteradas.

Backups criptografados pré e pós-importação preservados fora do repositório; recuperação autenticada
byte a byte verificada. O pós-importação contém 237 documentos dos quatro perfis. Preservar o arquivo
original da credencial em armazenamento protegido: sem sua chave privada não se recupera esse arquivo.
Não é backup completo do projeto ou do Authentication, nem backup do MongoDB. Senhas ficam no cofre.

## Recuperação e aprovação

1. Antes da promoção, gerar novo backup criptografado dos UIDs aprovados; verificar sua recuperação.
2. Preservar juntos o arquivo criptografado, hash, data, lista de UIDs e referência segura à chave original.
3. Em incidente, interromper novas escritas; capturar o estado atual antes de restaurar.
4. Validar a recuperação em namespace/quarentena, sem sobrescrever `users/{uid}`; conferir centavos,
   IDs, referências e ciclos/pagamentos. Não recriar identidades nem associar dados por e-mail.
5. Restaurar sobre perfis ativos somente após revisão do diff e aprovação explícita do proprietário.
6. Rollback da implantação restaura o deploy anterior, mas não desfaz movimentos financeiros:
   correções financeiras exigem procedimento auditado e backup, sem reset de saldo.

A origem MongoDB permanece inacessível: não há MONGO_URL configurada localmente ou origem comprovada.
Não se pode declarar inexistência de histórico. O caminho ativo Firebase não importa Motor/Mongo;
o backend legado e os procedimentos históricos estão preservados. Para transferir histórico, fornecer
conexão somente leitura ou dump BSON protegido com identificação do banco; nada será excluído.

FINNOS IA com provedor externo exige chave protegida/configuração de criptografia e autorização de custos;
isso não bloqueia os lançamentos, saldos e faturas. Nenhuma chamada paga foi executada.

Testes locais atuais: 97 backend, 42 frontend, build aprovado. Detalhes funcionais e screenshots
ficam nos artefatos locais da validação; segredos nunca foram incluídos no repositório.

Uma corrida na troca de UID durante o commit IndexedDB também foi corrigida: o leitor
confere a identidade novamente após gravar o cache e mantém as chaves individuais de
transação presas ao UID capturado no início. Regressão confirma rejeição da resposta
antiga e ausência de snapshot antigo na chave do novo usuário.
