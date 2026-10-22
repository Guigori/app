import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchAccounts, fetchTransactions, fetchTrends, fetchRadar } from "@/lib/data";
import { currentMonth } from "@/lib/format";
type Section = "carteira" | "transacoes" | "analises" | "radar" | "configuracoes";
const money = (value: number) => new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(value);
const surface = "rounded-xl border border-black/[0.07] bg-white p-5 dark:border-white/10 dark:bg-[#1b1c22]";
const names: Record<Section,string> = {carteira:"Carteira",transacoes:"Transações",analises:"Análises",radar:"Radar",configuracoes:"Configurações"};
/** Dashboard-specific presentation, sharing the existing financial data layer. */
export default function DashboardSection({ section }: {section: Section}) {
  const accounts = useQuery({queryKey:["accounts"],queryFn:fetchAccounts,enabled:section==="carteira"});
  const transactions = useQuery({queryKey:["dashboard-transactions",currentMonth()],queryFn:()=>fetchTransactions({month:currentMonth()}),enabled:section==="transacoes"});
  const trends = useQuery({queryKey:["trends",6,currentMonth()],queryFn:()=>fetchTrends(6,currentMonth()),enabled:section==="analises"});
  const radar = useQuery({queryKey:["radar"],queryFn:fetchRadar,enabled:section==="radar"});
  const query = section==="carteira"?accounts:section==="transacoes"?transactions:section==="analises"?trends:section==="radar"?radar:null;
  return <div className="space-y-6">
    <div><p className="text-[11px] font-semibold uppercase tracking-[.16em] text-[#5b35ff]">FINNOS / Dashboard</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">{names[section]}</h1><p className="mt-2 text-sm text-neutral-500">Gerencie suas informações financeiras em uma visão ampliada.</p></div>
    {query?.isPending && <div role="status" className={surface}>Carregando informações…</div>}
    {query?.isError && <div role="alert" className={surface}>Não foi possível carregar as informações. <button className="ml-2 font-semibold text-[#5b35ff]" onClick={()=>query.refetch()}>Tentar novamente</button></div>}
    {section==="carteira" && accounts.data && <div className="grid gap-3 lg:grid-cols-2">{accounts.data.length ? accounts.data.map(a=><article key={a.id} className={surface}><p className="text-sm font-semibold">{a.name}</p><p className="mt-2 text-xs text-neutral-500">Conta cadastrada</p></article>) : <p className={surface}>Nenhuma conta cadastrada.</p>}</div>}
    {section==="transacoes" && transactions.data && <section className={surface}><h2 className="mb-4 text-sm font-semibold">Movimentações do mês</h2>{transactions.data.length ? transactions.data.slice(0,100).map(tx=><div key={tx.id} className="flex justify-between gap-4 border-t border-black/5 py-3 text-sm dark:border-white/10"><div className="min-w-0"><p className="truncate font-medium">{tx.name}</p><p className="text-xs text-neutral-500">{tx.date} · {tx.category_name ?? "Sem categoria"}</p></div><span className="shrink-0 font-medium tabular-nums">{money(tx.adjusted_value ?? tx.value)}</span></div>) : <p className="text-sm text-neutral-500">Nenhuma transação neste mês.</p>}</section>}
    {section==="analises" && trends.data && <section className={surface}><h2 className="mb-4 text-sm font-semibold">Evolução mensal</h2><div className="overflow-x-auto"><table className="w-full min-w-[520px] text-left text-sm"><thead className="text-xs text-neutral-500"><tr><th className="pb-3">Mês</th><th>Receitas</th><th>Despesas</th><th>Resultado</th></tr></thead><tbody>{trends.data.months.map(m=><tr key={m.month} className="border-t border-black/5 dark:border-white/10"><td className="py-3">{m.label}</td><td>{money(m.income)}</td><td>{money(m.expense)}</td><td className="font-semibold">{money(m.net)}</td></tr>)}</tbody></table></div></section>}
    {section==="radar" && radar.data && <section className={surface}><h2 className="mb-4 text-sm font-semibold">Sinais financeiros</h2>{radar.data.items.length ? radar.data.items.map(s=><article key={s.id} className="border-t border-black/5 py-4 dark:border-white/10"><h3 className="text-sm font-semibold">{s.title}</h3><p className="mt-1 text-xs text-neutral-500">{s.description}</p></article>) : <p className="text-sm text-neutral-500">Nenhum sinal ativo.</p>}</section>}
    {section==="configuracoes" && <section className={surface}><h2 className="text-sm font-semibold">Preferências e conta</h2><p className="mt-2 text-sm text-neutral-500">As preferências permanecem compartilhadas entre o App e o Dashboard.</p><Link to="/configuracoes" className="mt-4 inline-block text-sm font-semibold text-[#5b35ff]">Abrir configurações da conta →</Link></section>}
  </div>;
}
