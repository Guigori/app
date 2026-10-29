import type { SyncOperation } from "./queue";

type ConnectionState = "online" | "offline";

const ENTITY_NAMES: Record<string, string> = {
  "account.create": "conta",
  "category.create": "categoria",
  "card.create": "cartão",
  "subscription.create": "assinatura",
};

function countLabel(amount: number, singular: string, plural: string): string {
  return `${amount} ${amount === 1 ? singular : plural}`;
}

/** Pure presentation layer: offline entity drafts must never masquerade as
 * financial transactions or as server-acknowledged registrations.
 */
export function describeSyncQueue(
  operations: readonly SyncOperation[],
  connection: ConnectionState,
  syncing: boolean,
): { text: string; ariaLabel: string; blocker: SyncOperation | null } {
  const transactionCount = operations.filter((op) => op.kind.startsWith("transaction.")).length;
  const entityCount = operations.length - transactionCount;
  const descriptions = [
    transactionCount ? countLabel(transactionCount, "lançamento", "lançamentos") : "",
    entityCount ? countLabel(entityCount, "cadastro", "cadastros") : "",
  ].filter(Boolean);
  const items = descriptions.join(" e ");
  const blocker = operations.find((op) => op.status === "conflict") ?? null;

  if (blocker) {
    const kind = blocker.kind.startsWith("transaction.")
      ? "lançamento"
      : `cadastro de ${ENTITY_NAMES[blocker.kind] ?? "item"}`;
    return {
      blocker,
      text: `Sincronização bloqueada · revisar ${kind} · ${items} na fila`,
      ariaLabel: `Sincronização bloqueada. Revisar ${kind}. ${items} aguardando.`,
    };
  }
  if (connection === "offline") {
    const text = operations.length
      ? `Você está offline · ${items} ${operations.length === 1 ? "pendente" : "pendentes"} neste aparelho, ainda sem confirmação no servidor`
      : "Você está offline · os dados disponíveis neste aparelho continuam funcionando";
    return { blocker: null, text, ariaLabel: text };
  }
  if (syncing && operations.length) {
    return {
      blocker: null,
      text: `Sincronizando ${items}…`,
      ariaLabel: `Sincronizando ${items}`,
    };
  }
  if (operations.length) {
    const text = `${items} aguardando sincronização com o servidor`;
    return { blocker: null, text, ariaLabel: text };
  }
  return {
    blocker: null,
    text: "Tudo sincronizado",
    ariaLabel: "Tudo sincronizado",
  };
}
