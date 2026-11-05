"""Builds the ready-made "Registrar no FINNOS" shortcut that Integrações offers.

    python3 scripts/build_shortcut.py            # writes the unsigned file
    shortcuts sign --mode anyone -i <unsigned> -o public/atalhos/registrar-no-finnos.shortcut

The shortcut asks once, when added, for the connection code FINNOS shows
("https://endereço|fns_…"), so one file works for every user and every domain.
Then: Quanto foi? → Despesa ou receita → Forma → Conta ou cartão → Categoria →
Parcelas (só no crédito) → POST /api/shortcuts/lancamentos → notificação.
"""
import plistlib
import sys
import uuid
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "build" / "registrar-no-finnos.unsigned.shortcut"
# Keys the shortcut reads from /opcoes and sends to /lancamentos; tests compare them with the API.
OPTION_KEYS = ["tipos", "formas", "carteiras", "categorias"]
BODY_KEYS = ["valor", "tipo", "forma", "carteira", "categoria", "parcelas"]


def new_id() -> str:
    return str(uuid.uuid4()).upper()


def output(action_id: str, name: str) -> dict:
    return {"Type": "ActionOutput", "OutputUUID": action_id, "OutputName": name}


def variable(name: str) -> dict:
    return {"Type": "Variable", "VariableName": name}


def attachment(value: dict) -> dict:
    return {"Value": value, "WFSerializationType": "WFTextTokenAttachment"}


def text(*parts) -> dict:
    """A text field mixing plain strings and variables."""
    string, ranges = "", {}
    for part in parts:
        if isinstance(part, str):
            string += part
        else:
            ranges[f"{{{len(string.encode('utf-16-le')) // 2}, 1}}"] = part
            string += "￼"
    return {"Value": {"string": string, "attachmentsByRange": ranges}, "WFSerializationType": "WFTextTokenString"}


def fields(items: list[tuple[str, dict]]) -> dict:
    return {
        "Value": {"WFDictionaryFieldValueItems": [{"WFItemType": 0, "WFKey": text(k), "WFValue": v} for k, v in items]},
        "WFSerializationType": "WFDictionaryFieldValue",
    }


def action(identifier: str, **params) -> dict:
    return {"WFWorkflowActionIdentifier": f"is.workflow.actions.{identifier}", "WFWorkflowActionParameters": params}


def build() -> dict:
    ids = {k: new_id() for k in ["config", "split", "first", "last", "options", "tipos", "msg1", "valor", "tipo", "formas", "forma",
                                  "carteiras", "carteira", "categorias", "categoria", "one", "parcelas", "post", "msg"]}
    auth = fields([("Authorization", text("Bearer ", variable("Codigo")))])
    when_empty, when_credit = new_id(), new_id()

    def pick(key: str, list_id: str, choice_id: str, prompt: str) -> list[dict]:
        return [
            action("getvalueforkey", UUID=list_id, WFInput=attachment(output(ids["options"], "Conteúdo do URL")),
                   WFGetDictionaryValueType="Value", WFDictionaryKey=key),
            action("choosefromlist", UUID=choice_id, WFInput=attachment(output(list_id, "Valor do Dicionário")),
                   WFChooseFromListActionPrompt=prompt),
        ]

    actions = [
        # 0: the connection code, filled in by the import question.
        action("gettext", UUID=ids["config"], WFTextActionText="COLE_O_CODIGO_DE_CONEXAO"),
        action("text.split", UUID=ids["split"], text=attachment(output(ids["config"], "Texto")),
               WFTextSeparator="Custom", WFTextCustomSeparator="|"),
        action("getitemfromlist", UUID=ids["first"], WFInput=attachment(output(ids["split"], "Texto Dividido")), WFItemSpecifier="First Item"),
        action("setvariable", WFVariableName="Endereco", WFInput=attachment(output(ids["first"], "Item da Lista"))),
        action("getitemfromlist", UUID=ids["last"], WFInput=attachment(output(ids["split"], "Texto Dividido")), WFItemSpecifier="Last Item"),
        action("setvariable", WFVariableName="Codigo", WFInput=attachment(output(ids["last"], "Item da Lista"))),
        action("downloadurl", UUID=ids["options"], WFURL=text(variable("Endereco"), "/api/shortcuts/opcoes"),
               WFHTTPMethod="GET", ShowHeaders=True, WFHTTPHeaders=auth),
        action("getvalueforkey", UUID=ids["tipos"], WFInput=attachment(output(ids["options"], "Conteúdo do URL")),
               WFGetDictionaryValueType="Value", WFDictionaryKey="tipos"),
        # No lists back (code revoked, no account…): show FINNOS's message and stop.
        action("conditional", GroupingIdentifier=when_empty, WFControlFlowMode=0, WFCondition=101,
               WFInput={"Type": "Variable", "Variable": attachment(output(ids["tipos"], "Valor do Dicionário"))}),
        action("getvalueforkey", UUID=ids["msg1"], WFInput=attachment(output(ids["options"], "Conteúdo do URL")),
               WFGetDictionaryValueType="Value", WFDictionaryKey="mensagem"),
        action("alert", WFAlertActionTitle="FINNOS", WFAlertActionMessage=text(output(ids["msg1"], "Valor do Dicionário")),
               WFAlertActionCancelButtonShown=False),
        action("exit"),
        action("conditional", GroupingIdentifier=when_empty, WFControlFlowMode=2),
        action("ask", UUID=ids["valor"], WFAskActionPrompt="Quanto foi?", WFInputType="Number"),
        action("choosefromlist", UUID=ids["tipo"], WFInput=attachment(output(ids["tipos"], "Valor do Dicionário")),
               WFChooseFromListActionPrompt="Despesa ou receita?"),
        *pick("formas", ids["formas"], ids["forma"], "Como pagou?"),
        *pick("carteiras", ids["carteiras"], ids["carteira"], "Conta ou cartão"),
        *pick("categorias", ids["categorias"], ids["categoria"], "Categoria"),
        action("gettext", UUID=ids["one"], WFTextActionText="1"),
        action("setvariable", WFVariableName="Parcelas", WFInput=attachment(output(ids["one"], "Texto"))),
        action("conditional", GroupingIdentifier=when_credit, WFControlFlowMode=0, WFCondition=4, WFConditionalActionString="Crédito",
               WFInput={"Type": "Variable", "Variable": attachment(output(ids["forma"], "Item Escolhido"))}),
        action("ask", UUID=ids["parcelas"], WFAskActionPrompt="Em quantas parcelas?", WFInputType="Number", WFAskActionDefaultAnswerNumber="1"),
        action("setvariable", WFVariableName="Parcelas", WFInput=attachment(output(ids["parcelas"], "Entrada Fornecida"))),
        action("conditional", GroupingIdentifier=when_credit, WFControlFlowMode=2),
        action("downloadurl", UUID=ids["post"], WFURL=text(variable("Endereco"), "/api/shortcuts/lancamentos"),
               WFHTTPMethod="POST", ShowHeaders=True, WFHTTPHeaders=auth, WFHTTPBodyType="JSON",
               WFJSONValues=fields([
                   ("valor", text(output(ids["valor"], "Entrada Fornecida"))),
                   ("tipo", text(output(ids["tipo"], "Item Escolhido"))),
                   ("forma", text(output(ids["forma"], "Item Escolhido"))),
                   ("carteira", text(output(ids["carteira"], "Item Escolhido"))),
                   ("categoria", text(output(ids["categoria"], "Item Escolhido"))),
                   ("parcelas", text(variable("Parcelas"))),
               ])),
        action("getvalueforkey", UUID=ids["msg"], WFInput=attachment(output(ids["post"], "Conteúdo do URL")),
               WFGetDictionaryValueType="Value", WFDictionaryKey="mensagem"),
        action("notification", WFNotificationActionTitle="FINNOS", WFNotificationActionBody=text(output(ids["msg"], "Valor do Dicionário"))),
    ]
    return {
        "WFWorkflowName": "Registrar no FINNOS",
        "WFWorkflowClientVersion": "2607.0.5",
        "WFWorkflowMinimumClientVersion": 900,
        "WFWorkflowMinimumClientVersionString": "900",
        "WFWorkflowIcon": {"WFWorkflowIconStartColor": 4282601983, "WFWorkflowIconGlyphNumber": 59446},
        "WFWorkflowTypes": [],
        "WFWorkflowInputContentItemClasses": [],
        "WFWorkflowOutputContentItemClasses": [],
        "WFWorkflowHasShortcutInputVariables": False,
        "WFQuickActionSurfaces": [],
        "WFWorkflowImportQuestions": [{
            "ActionIndex": 0, "Category": "Parameter", "ParameterKey": "WFTextActionText", "DefaultValue": "",
            "Text": "Cole o código de conexão do FINNOS (Configurações → Integrações → Gerar código).",
        }],
        "WFWorkflowActions": actions,
    }


if __name__ == "__main__":
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else OUT
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(plistlib.dumps(build(), fmt=plistlib.FMT_BINARY))
    print(target)
