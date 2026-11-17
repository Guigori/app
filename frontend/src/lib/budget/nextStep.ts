/**
 * Orçamento · o próximo passo do mês: o ritual em três momentos. No começo do mês, fechar o anterior; perto do fim,
 * planejar o próximo. Só aparece quando há algo a fazer e o aviso está ligado em Configurar.
 */
import { addMonth } from "@/lib/format";

export interface NextStep { kind: "fechar" | "comecar" | "planejar"; month: string; to: string }

export function nextStep({ today, closed, planned, hadMovement, on }: {
  today: string; closed: (m: string) => boolean; planned: (m: string) => boolean; hadMovement: (m: string) => boolean; on: { fechar: boolean; planejar: boolean };
}): NextStep | null {
  const month = today.slice(0, 7), day = Number(today.slice(8, 10));
  const prev = addMonth(month, -1), next = addMonth(month, 1);
  if (on.fechar && day <= 10 && hadMovement(prev) && !closed(prev)) return { kind: "fechar", month: prev, to: `/orcamento/fechar?mes=${prev}` };
  // Right after closing the month before: start this one (choose the rule, what comes in and goes out).
  if (on.planejar && closed(prev) && !planned(month)) return { kind: "comecar", month, to: `/orcamento/novo?mes=${month}` };
  if (on.planejar && day >= 20 && !planned(next)) return { kind: "planejar", month: next, to: `/orcamento/novo?mes=${next}` };
  return null;
}
