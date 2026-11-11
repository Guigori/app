/**
 * FINNOS analysis library: self-contained analyses (data + reading + card) that any screen can drop in.
 * The calculations live in `@/lib/insights/*` (pure, tested); these components fetch, read and draw them.
 *
 * - InvoicesInsight: last, current and next invoices of one card or all cards → Cartões, Início, Análise.
 * - InstallmentsInsight: installments running, what is left, next months and budget impact → Cartões, Análise.
 * - FixedBillsInsight: fixed bills of a period, paid and still to pay → Início, Fluxo.
 */
export { InvoicesInsight } from "./InvoicesInsight";
export { InstallmentsInsight } from "./InstallmentsInsight";
export { FixedBillsInsight } from "./FixedBillsInsight";
export { InsightShell, FindingList, BigMoney } from "./InsightShell";
