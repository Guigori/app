# FIINT Registro Inteligente — contrato de integração (beta)

## Estado real
- Implementado: interpretação determinística de texto, prévia autenticada, detecção limitada de contas, valores, datas e parcelas; memória pessoal de categorias confirmadas e exclusão dessa memória.
- Não implementado: OCR de comprovantes, captura da câmera, transcrição de voz, classificação por LLM, aprendizado federado/coletivo, confirmação transacional integrada e persistência Firestore para a memória.
- Dependência atual: MongoDB para contas, categorias e memória no backend. Não desativar o MongoDB com base nesta funcionalidade.

## API
`POST /api/fiint/registration/preview` com corpo `{"text":"Transferi R$ 200 do Nubank para o Inter hoje"}`. Retorna `{"engine":"FIINT","draft":{...}}`. O rascunho contém `type`, `value`, `name`, `date`, `account_id`, `to_account_id`, `category_id`, `installment`, `total_installments`, `installment_value`, `missing_fields`, `requires_confirmation`, `source`. Campos incertos permanecem nulos.

`POST /api/fiint/registration/learn-category` com `{"merchant":"Padaria São José","category_id":"<ID da categoria cadastrada>"}` deve ser chamado **somente após uma correção explicitamente confirmada** pelo usuário. Não invocar automaticamente ao abrir uma prévia. O endpoint grava uma associação pessoal.

`DELETE /api/fiint/registration/learn-category/{merchant}` remove a associação pessoal. Codificar o segmento da URL corretamente.

## Frontend
1. Permitir digitação de linguagem natural e mostrar estado de carregamento e erros 401/422.
2. Mostrar prévia **editável**. Validar os campos faltantes, tipo, data, valor, contas, cartão e parcelas.
3. Exigir confirmação explícita; então enviar payload validado ao endpoint de transações existente. Não confundir prévia com lançamento persistido.
4. Nunca presumir conta de destino quando a direção da transferência for ambígua.
5. Aprender categoria apenas após confirmação e com indicação clara ao usuário. Oferecer opção de desfazer.
6. Câmera e anexos: interface pode capturar arquivo local, mas **não** enviar para a API de texto como se fosse OCR; exigir implementação específica e revisão de segurança.
7. Não expor dados pessoais em logs, métricas ou provedores de IA sem autorização.

## Critérios de homologação
- Testes de unitários e integração autenticada com isolamento por usuário.
- Validação de datas inválidas, quantias em formatos brasileiros, transferências ambíguas, parcelas e duplicatas.
- Testar resposta com categorias/contas vazias e categorias excluídas.
- Testar integração com backend efetivamente utilizado em produção (Firebase vs MongoDB), iOS Safari e PWA.
- Executar pytest, build e checagens de segurança; manter PR em draft até aprovação.

## Código de terceiros
Ver `THIRD_PARTY_NOTICES.md`. Nenhum código externo foi incorporado por este documento.
