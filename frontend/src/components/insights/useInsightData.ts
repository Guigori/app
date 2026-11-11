/** Shared reads of the analysis library: one cache, so every widget on a screen asks the server once. */
import { useQuery } from "@tanstack/react-query";
import { fetchAccounts, fetchBalanceHistory, fetchBudget, fetchCalendar, fetchCards, fetchTransactions } from "@/lib/data";
import { monthRange } from "@/lib/insights/fixedBills";

const stale = { staleTime: 60_000 };
export const useCards = () => useQuery({ queryKey: ["cards"], queryFn: fetchCards, ...stale });
export const useAccounts = () => useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts, ...stale });
export const useCalendar = (month: string) => useQuery({ queryKey: ["calendar", month, "todas"], queryFn: () => fetchCalendar(month), ...stale });
export const useBudget = (month: string) => useQuery({ queryKey: ["budget", month], queryFn: () => fetchBudget(month), ...stale });
export const useBalanceHistory = (month: string) => useQuery({ queryKey: ["balance-history", month], queryFn: () => fetchBalanceHistory(month), ...stale });
/** Everything not paid yet from today to the end of next week or of the month (whichever is later). */
export const useOpenTransactions = (start: string, end: string) => useQuery({ queryKey: ["transactions", "open", start, end], queryFn: () => fetchTransactions({ start_date: start, end_date: end }), ...stale });
export const useMonthEnd = (month: string) => monthRange(month).end;
