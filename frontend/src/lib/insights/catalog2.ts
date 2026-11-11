/**
 * Biblioteca de análises · segunda leva: "Meu orçamento" (o modelo que a pessoa usa, não só 50/30/20) e quinze
 * análises novas. Mesmo formato do catálogo: cada uma diz o que precisa e devolve uma leitura.
 */
import type { Finding } from "@/lib/insights/invoices";
import type { Ctx, Need, Reading, Row } from "@/lib/insights/catalog";
import type { Transaction } from "@/types/finnos";
import { compare, shortMonthName } from "@/lib/insights/compare";
import { addMonth } from "@/lib/format";

const COLORS = ["var(--finnos-purple)", "var(--finnos-violet)", "var(--finnos-lilac)", "#0EA5E9", "#14B8A6", "#F59E0B", "#EC4899", "var(--finnos-app)"];
const pct = (v: number) => `${Math.round(v * 100)}%`;
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const amount = (t: Transaction) => t.adjusted_value ?? t.value;
const spending = (txs: Transaction[]) => txs.filter((t) => t.type === "despesa" && !t.invoice_payment && !t.invoice_refund);
const incomes = (txs: Transaction[]) => txs.filter((t) => t.type === "receita" && !t.invoice_refund);
const sum = (txs: Transaction[]) => txs.reduce((s, t) => s + amount(t), 0);
const short = (m: string) => cap(shortMonthName(m));
const merchant = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ").replace(/\s*\d+\/\d+$/, "");
const groupBy = <T,>(list: T[], key: (t: T) => string) => { const m = new Map<string, T[]>(); list.forEach((t) => { const k = key(t); m.set(k, [...(m.get(k) ?? []), t]); }); return m; };
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00`) - Date.parse(`${a}T12:00:00`)) / 86_400_000);
const weekday = (iso: string) => new Date(`${iso}T12:00:00`).getDay();
const inMonth = (txs: Transaction[], m: string) => txs.filter((t) => t.date.slice(0, 7) === m);
const closedMonths = (month: string, n: number) => Array.from({ length: n }, (_, i) => addMonth(month, -(i + 1)));
const whole = (money: (v: number) => string) => (v: number) => money(v).replace(/,\d\d$/, "");
const PRIORITY: Record<string, string> = { essencial: "Essenciais", flexivel: "Flexíveis", meta: "Metas" };

export const MORE_READERS: Record<string, { needs: Need[]; read: (c: Ctx) => Reading }> = {
  /** Meu orçamento: the person's own budget — personalised, 50/30/20 or, without one, the one FINNOS suggests. */
  "meu-orcamento": {
    needs: ["cycle", "budget", "suggestion"],
    read: ({ cycle, budget, suggestion, money, today, month }) => {
      if (cycle?.progress) {
        const p = cycle.progress, c = cycle.cycle;
        const model = c.mode === "503020" ? "Regra 50/30/20" : "Orçamento personalizado";
        const daysLeft = Math.max(1, daysBetween(today, p.end_date) + 1);
        const groups = Object.keys(PRIORITY).map((k) => {
          const list = p.allocations.filter((a) => a.priority === k);
          return { key: k, label: PRIORITY[k], planned: list.reduce((s, a) => s + a.planned, 0), spent: list.reduce((s, a) => s + a.spent + a.committed, 0) };
        }).filter((g) => g.planned > 0);
        const over = p.allocations.filter((a) => a.spent + a.committed > a.planned && a.planned > 0).sort((a, b) => (b.spent + b.committed - b.planned) - (a.spent + a.committed - a.planned));
        const findings: Finding[] = [
          { tone: p.pace === "acima" ? "bad" : p.pace === "abaixo" ? "good" : "info", text: p.pace === "acima" ? `Você já usou ${Math.round(p.used_percent)}% do orçamento com ${Math.round(p.elapsed_percent)}% do ciclo: está gastando mais rápido que o planejado.` : p.pace === "abaixo" ? `${Math.round(p.used_percent)}% usado com ${Math.round(p.elapsed_percent)}% do ciclo: abaixo do ritmo, ótimo.` : `No ritmo: ${Math.round(p.used_percent)}% usado com ${Math.round(p.elapsed_percent)}% do ciclo.` },
          ...(over.length ? [{ tone: "bad" as const, text: `${over.slice(0, 3).map((a) => a.name ?? "Categoria").join(", ")} ${over.length === 1 ? "passou" : "passaram"} do planejado.` }] : []),
          { tone: p.safe_to_spend >= 0 ? "info" as const : "bad" as const, text: p.safe_to_spend >= 0 ? `Para fechar dentro do plano, dá ${money(p.safe_to_spend / daysLeft)} por dia até ${ddmm(p.end_date)}.` : `O que já está comprometido passa o plano em ${money(-p.safe_to_spend)}.` },
        ];
        return {
          tile: model, value: money(Math.max(0, p.available)), tone: p.available < 0 ? "expense" : undefined, note: `livres no ciclo · ${Math.round(p.used_percent)}% usado`,
          subtitle: `${model} · ${ddmm(p.start_date)} a ${ddmm(p.end_date)}`,
          vs: { c: compare(p.used_percent, p.elapsed_percent, "lower"), label: "usado vs tempo do ciclo (p.p.)", format: "count" },
          chart: groups.length ? { type: "bullets", items: groups.map((g) => ({ label: g.label, value: g.spent, limit: g.planned, note: `${money(g.spent)} / ${money(g.planned)}` })) } : { type: "gauge", percent: p.used_percent / 100, center: `${Math.round(p.used_percent)}%`, detail: `${money(p.spent)} de ${money(p.planned)}` },
          rows: [...p.allocations].sort((a, b) => b.percent - a.percent).map((a) => ({ label: a.name ?? "Categoria", sub: `${PRIORITY[a.priority] ?? ""} · ${money(a.spent + a.committed)} de ${money(a.planned)}`, value: `${Math.round(a.percent)}%`, tone: a.percent > 100 ? "expense" as const : undefined, color: a.color ?? undefined })),
          findings,
          summary: [`Você usa o modelo ${model.toLowerCase()} e já foram ${money(p.spent + p.committed)} dos ${money(p.planned)} planejados.`, findings[0].text, findings[findings.length - 1].text],
          context: { modelo: c.mode, periodo: c.period, planejado: p.planned, gasto: p.spent, comprometido: p.committed, ritmo: p.pace, livre_por_dia: p.safe_to_spend / daysLeft, acima: over.map((a) => a.name) },
        };
      }
      if (budget && budget.planned > 0) {
        const day = Number(today.slice(8, 10)), daysIn = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
        const elapsed = day / daysIn, used = budget.spent / budget.planned;
        const over = budget.rows.filter((r) => r.budget > 0 && r.spent > r.budget);
        return {
          tile: "Limites por categoria", value: money(Math.max(0, budget.remaining)), tone: budget.remaining < 0 ? "expense" : undefined, note: `livres · ${pct(used)} usado com ${pct(elapsed)} do mês`,
          subtitle: "Seus limites por categoria",
          chart: { type: "bullets", items: budget.rows.filter((r) => r.budget > 0).sort((a, b) => b.spent / b.budget - a.spent / a.budget).slice(0, 6).map((r) => ({ label: r.name, value: r.spent, limit: r.budget })) },
          rows: budget.rows.filter((r) => r.budget > 0).map((r) => ({ label: r.name, sub: `${money(r.spent)} de ${money(r.budget)}`, value: pct(r.spent / r.budget), tone: r.spent > r.budget ? "expense" as const : undefined, color: r.color })),
          findings: [{ tone: used > elapsed + 0.1 ? "bad" : "good", text: used > elapsed + 0.1 ? `Você usou ${pct(used)} dos limites com ${pct(elapsed)} do mês: mais rápido que o mês.` : `${pct(used)} usado com ${pct(elapsed)} do mês: dentro do ritmo.` }, ...(over.length ? [{ tone: "bad" as const, text: `${over.map((r) => r.name).slice(0, 3).join(", ")} ${over.length === 1 ? "passou" : "passaram"} do limite.` }] : [])],
          summary: [`Seus limites somam ${money(budget.planned)} e já foram ${money(budget.spent)}.`, used > elapsed + 0.1 ? "O mês está correndo mais rápido que o orçamento." : "O orçamento acompanha o ritmo do mês."],
          context: { planejado: budget.planned, gasto: budget.spent, linhas: budget.rows.map((r) => ({ categoria: r.name, limite: r.budget, gasto: r.spent })) },
        };
      }
      const sug = suggestion?.categories.filter((c) => c.suggested > 0).sort((a, b) => b.suggested - a.suggested) ?? [];
      const total = sug.reduce((s, c) => s + c.suggested, 0);
      return {
        empty: sug.length ? undefined : "Você ainda não tem orçamento. Crie um em Orçamento: personalizado, por categoria, ou pela regra 50/30/20.",
        tile: "Orçamento sugerido", value: money(total), note: "por mês, pelos seus gastos recentes",
        subtitle: "Sem orçamento ainda: o FINNOS sugere um pela sua média",
        chart: { type: "segmented", total, segments: sug.slice(0, 6).map((c, i) => ({ value: c.suggested, color: COLORS[i % COLORS.length], label: c.name })) },
        rows: sug.map((c) => ({ label: c.name, sub: `média ${money(c.average)} · ${c.months_observed} meses`, value: money(c.suggested) })),
        findings: [{ tone: "info", text: `Pela média dos últimos meses, um orçamento de ${money(total)} por mês caberia${suggestion?.expected_income ? ` numa renda de ${money(suggestion.expected_income)}` : ""}.` }],
        summary: [`Você ainda não tem orçamento definido.`, `Pelos seus gastos recentes, o FINNOS sugere ${money(total)} por mês, começando por ${sug[0]?.name ?? "suas maiores categorias"}.`],
        context: { sugestao: sug },
      };
    },
  },

  /** Fim de semana x dias úteis: where the week's money goes. */
  "fim-de-semana": {
    needs: ["tx"],
    read: ({ tx, money, today }) => {
      const list = spending(tx).filter((t) => t.date <= today && !t.fixed);
      const weekend = list.filter((t) => [0, 6].includes(weekday(t.date))), week = list.filter((t) => ![0, 6].includes(weekday(t.date)));
      const daysIn = (wk: boolean) => { let n = 0; for (let d = 1; d <= Number(today.slice(8, 10)); d++) { const iso = `${today.slice(0, 8)}${String(d).padStart(2, "0")}`; if ([0, 6].includes(weekday(iso)) === wk) n++; } return Math.max(1, n); };
      const wkAvg = sum(weekend) / daysIn(true), dAvg = sum(week) / daysIn(false);
      const total = sum(list);
      return {
        empty: list.length ? undefined : "Nenhum gasto variável no mês ainda.",
        tile: "Fim de semana", value: money(wkAvg), note: `por dia · dias úteis ${money(dAvg)}`,
        vs: { c: compare(wkAvg, dAvg, "lower"), label: "vs dia útil", format: "money" },
        chart: { type: "bars", data: [{ label: "Dia útil", value: dAvg, valueLabel: whole(money)(dAvg) }, { label: "Sáb/Dom", value: wkAvg, focus: true, valueLabel: whole(money)(wkAvg) }] },
        rows: [{ label: "Sábados e domingos", sub: plural(weekend.length, "compra", "compras"), value: money(sum(weekend)) }, { label: "Segunda a sexta", sub: plural(week.length, "compra", "compras"), value: money(sum(week)) }],
        findings: [{ tone: wkAvg > dAvg * 1.5 ? "bad" : "info", text: wkAvg > dAvg ? `No fim de semana você gasta ${(wkAvg / Math.max(dAvg, 0.01)).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}x mais por dia que nos dias úteis.` : "Nos dias úteis você gasta mais que no fim de semana." }],
        summary: [`Por dia, você gasta ${money(wkAvg)} no fim de semana e ${money(dAvg)} nos dias úteis.`, total > 0 ? `Sábados e domingos somam ${pct(sum(weekend) / total)} dos gastos variáveis do mês.` : ""].filter(Boolean),
        context: { fim_de_semana_por_dia: wkAvg, dia_util_por_dia: dAvg },
      };
    },
  },

  /** Assinaturas escondidas: the same charge in each of the last months that is not marked as fixed or subscription. */
  "recorrentes-escondidos": {
    needs: ["allTx", "subs"],
    read: ({ allTx, subs, month, money }) => {
      const months = [month, ...closedMonths(month, 2)];
      const known = new Set((subs?.items ?? []).map((s) => merchant(s.name)));
      const groups = groupBy(spending(allTx).filter((t) => !t.fixed && !t.recurrence && !t.installment && months.includes(t.date.slice(0, 7))), (t) => merchant(t.name));
      const found = [...groups.entries()].filter(([k, ts]) => !known.has(k) && new Set(ts.map((t) => t.date.slice(0, 7))).size >= 3)
        .map(([, ts]) => { const values = ts.map(amount); const avg = values.reduce((a, b) => a + b, 0) / values.length; return { name: ts[0].name, avg, steady: Math.max(...values) - Math.min(...values) <= avg * 0.15 }; })
        .filter((f) => f.steady).sort((a, b) => b.avg - a.avg);
      const total = found.reduce((s, f) => s + f.avg, 0);
      return {
        empty: found.length ? undefined : "Nenhum gasto que se repete todo mês sem estar marcado como fixo ou assinatura.",
        tile: "Repete todo mês", value: String(found.length), note: found.length ? `${money(total)}/mês sem estar marcado` : "",
        subtitle: "Cobranças iguais nos últimos 3 meses que não estão como fixas",
        rows: found.map((f) => ({ label: f.name, sub: "3 meses seguidos", value: `${money(f.avg)}/mês` })),
        chart: found.length ? { type: "bars", data: found.slice(0, 5).map((f, i) => ({ label: f.name.slice(0, 8), value: f.avg, focus: i === 0, valueLabel: whole(money)(f.avg) })) } : undefined,
        findings: found.length ? [{ tone: "info", text: `${found.slice(0, 3).map((f) => f.name).join(", ")} ${found.length === 1 ? "aparece" : "aparecem"} todo mês com o mesmo valor: marque como fixo ou assinatura para entrar nas estimativas.` }] : [],
        summary: [`Encontramos ${plural(found.length, "gasto", "gastos")} que se ${found.length === 1 ? "repete" : "repetem"} todo mês com o mesmo valor, somando ${money(total)} por mês.`, "Marcar como fixo ou assinatura faz o FINNOS contar com eles nas estimativas."],
        context: { recorrentes: found },
      };
    },
  },

  /** Contas que subiram de preço: fixed bills and subscriptions charged more than the previous time. */
  "aumentos-de-preco": {
    needs: ["allTx"],
    read: ({ allTx, money }) => {
      const groups = groupBy(spending(allTx).filter((t) => (t.fixed || t.recurrence) && t.status === "pago"), (t) => t.recurrence_id ?? merchant(t.name));
      const ups = [...groups.values()].map((ts) => { const sorted = [...ts].sort((a, b) => b.date.localeCompare(a.date)); const [last, prev] = sorted; return last && prev ? { name: last.name, now: amount(last), before: amount(prev), date: last.date } : null; })
        .filter((x): x is { name: string; now: number; before: number; date: string } => Boolean(x) && x!.now > x!.before + 0.5).sort((a, b) => (b.now - b.before) - (a.now - a.before));
      const extra = ups.reduce((s, u) => s + u.now - u.before, 0);
      return {
        empty: ups.length ? undefined : "Nenhuma conta fixa ficou mais cara na última cobrança.",
        tile: "Ficaram mais caras", value: String(ups.length), tone: ups.length ? "expense" : undefined, note: ups.length ? `+${money(extra)} por mês` : "",
        subtitle: "Contas fixas e assinaturas: última cobrança vs a anterior",
        chart: ups.length ? { type: "bullets", items: ups.slice(0, 4).map((u) => ({ label: u.name, value: u.now, limit: u.before, note: `+${pct((u.now - u.before) / u.before)}` })) } : undefined,
        rows: ups.map((u) => ({ label: u.name, sub: `${money(u.before)} → ${money(u.now)} · ${ddmm(u.date)}`, value: `+${money(u.now - u.before)}`, tone: "expense" as const })),
        findings: ups.length ? [{ tone: "bad", text: `${ups[0].name} subiu de ${money(ups[0].before)} para ${money(ups[0].now)}. Somando tudo, ${money(extra * 12)} a mais por ano.` }] : [],
        summary: ups.length ? [`${plural(ups.length, "conta fixa ficou", "contas fixas ficaram")} mais cara${ups.length === 1 ? "" : "s"} na última cobrança: ${money(extra)} a mais por mês.`, `O maior aumento foi ${ups[0].name}.`] : ["Nenhuma conta fixa aumentou de valor."],
        context: { aumentos: ups },
      };
    },
  },

  /** Gastos fora do orçamento: what was spent in categories without a limit. */
  "fora-do-orcamento": {
    needs: ["budget", "dashboard"],
    read: ({ budget, dashboard, money }) => {
      const limited = new Set((budget?.rows ?? []).filter((r) => r.budget > 0).map((r) => r.category_id));
      const outside = (dashboard?.categories ?? []).filter((c) => c.category_id && !limited.has(c.category_id)).sort((a, b) => b.total - a.total);
      const total = budget?.unbudgeted_spent ?? outside.reduce((s, c) => s + c.total, 0);
      const share = (dashboard?.expense ?? 0) > 0 ? total / dashboard!.expense : 0;
      return {
        empty: budget && budget.planned > 0 ? (outside.length ? undefined : "Todo gasto do mês está em categorias com limite.") : "Defina limites por categoria em Orçamento para ver o que fica de fora.",
        tile: "Fora do orçamento", value: money(total), tone: share > 0.25 ? "expense" : undefined, note: `${pct(share)} do mês sem limite`,
        chart: outside.length ? { type: "donut", center: "Sem limite", slices: outside.slice(0, 6).map((c) => ({ id: c.category_id ?? c.name, name: c.name, value: c.total, color: c.color })) } : undefined,
        rows: outside.map((c) => ({ label: c.name, value: money(c.total), color: c.color })),
        findings: [{ tone: share > 0.25 ? "bad" : "info", text: share > 0.25 ? `${pct(share)} do que você gastou não tem limite: o orçamento não vê esse dinheiro.` : `Só ${pct(share)} do mês está fora do orçamento.` }],
        summary: [`Neste mês ${money(total)} foram em categorias sem limite, ${pct(share)} do total.`, outside[0] ? `A maior delas é ${outside[0].name}: ${money(outside[0].total)}.` : ""].filter(Boolean),
        context: { fora: outside.map((c) => ({ categoria: c.name, valor: c.total })) },
      };
    },
  },

  /** Seu ano até agora: income, spending and what was left this year, and where the year ends at this pace. */
  "ano-ate-agora": {
    needs: ["allTx"],
    read: ({ allTx, month, money, today }) => {
      const year = today.slice(0, 4), prevYear = String(Number(year) - 1);
      const upTo = (y: string) => allTx.filter((t) => t.date.slice(0, 4) === y && t.date.slice(5) <= today.slice(5) && t.status === "pago");
      const cur = upTo(year), prev = upTo(prevYear);
      const inc = sum(incomes(cur)), exp = sum(spending(cur)), net = inc - exp;
      const monthsGone = Number(month.slice(5, 7)) - 1 + Number(today.slice(8, 10)) / 30;
      const projection = monthsGone > 0 ? (net / monthsGone) * 12 : net;
      const byMonth = Array.from({ length: Number(month.slice(5, 7)) }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`).map((m) => { const ts = inMonth(cur, m); return { m, net: sum(incomes(ts)) - sum(spending(ts)) }; });
      return {
        empty: cur.length ? undefined : "Ainda não há lançamentos pagos neste ano.",
        tile: `${year} até agora`, value: `${net >= 0 ? "+" : "−"}${money(Math.abs(net))}`, tone: net < 0 ? "expense" : "income", note: `estimativa do ano ${projection >= 0 ? "+" : "−"}${money(Math.abs(projection))}`,
        vs: { c: compare(exp, prev.length ? sum(spending(prev)) : null, "lower"), label: `gasto vs ${prevYear} até hoje`, format: "money" },
        chart: { type: "bars", data: byMonth.map((b) => ({ label: short(b.m), value: Math.max(0, b.net), focus: b.m === month, valueLabel: whole(money)(b.net) })) },
        rows: [{ label: "Entrou", value: money(inc), tone: "income" as const }, { label: "Saiu", value: money(exp), tone: "expense" as const }, { label: "Sobrou", value: money(net), tone: net < 0 ? "expense" as const : "income" as const }, { label: "Se o ano seguir assim", value: money(projection) }],
        findings: [{ tone: net >= 0 ? "good" : "bad", text: net >= 0 ? `No ritmo atual, ${year} termina com ${money(projection)} sobrando.` : `No ritmo atual, ${year} fecha ${money(-projection)} no negativo.` }],
        summary: [`Em ${year} entraram ${money(inc)} e saíram ${money(exp)}: ${net >= 0 ? "sobraram" : "faltaram"} ${money(Math.abs(net))}.`, `Se o ano seguir assim, termina em ${projection >= 0 ? "+" : "−"}${money(Math.abs(projection))}.`, prev.length ? `Até esta data de ${prevYear} você tinha gastado ${money(sum(spending(prev)))}.` : ""].filter(Boolean),
        context: { ano: year, entrou: inc, saiu: exp, sobrou: net, projecao: projection },
      };
    },
  },

  /** Efeito salário: how much of the month goes in the days right after the income arrives. */
  "efeito-salario": {
    needs: ["tx"],
    read: ({ tx, money }) => {
      const pay = incomes(tx).filter((t) => t.status === "pago").sort((a, b) => amount(b) - amount(a))[0];
      const list = spending(tx).filter((t) => !t.fixed && t.status === "pago");
      if (!pay) return { empty: "Nenhuma receita paga neste mês ainda para comparar.", tile: "Efeito salário", value: "—", note: "", findings: [], summary: ["Ainda não entrou renda neste mês."], context: {} };
      const after = list.filter((t) => { const d = daysBetween(pay.date, t.date); return d >= 0 && d <= 4; });
      const share = sum(list) > 0 ? sum(after) / sum(list) : 0;
      return {
        empty: list.length ? undefined : "Nenhum gasto variável no mês ainda.",
        tile: "5 dias após a renda", value: pct(share), tone: share > 0.4 ? "expense" : undefined, note: `${money(sum(after))} depois de ${pay.name}`,
        chart: { type: "segmented", total: Math.max(sum(list), 0.01), segments: [{ value: sum(after), color: "var(--finnos-purple)", label: "5 dias após a renda" }, { value: sum(list) - sum(after), color: "var(--finnos-lilac)", label: "Resto do mês" }] },
        rows: after.sort((a, b) => amount(b) - amount(a)).slice(0, 10).map((t) => ({ label: t.name, sub: ddmm(t.date), value: money(amount(t)) })),
        findings: [{ tone: share > 0.4 ? "bad" : "good", text: share > 0.4 ? `${pct(share)} dos gastos variáveis saíram nos 5 dias após ${pay.name}: o dinheiro some logo que entra.` : `Só ${pct(share)} dos gastos ficaram nos 5 dias após a renda: bem distribuído.` }],
        summary: [`${pay.name} entrou em ${ddmm(pay.date)}; nos 5 dias seguintes saíram ${money(sum(after))}, ${pct(share)} dos gastos variáveis do mês.`],
        context: { renda: { nome: pay.name, data: pay.date, valor: amount(pay) }, apos: sum(after), parte: share },
      };
    },
  },

  /** Fontes de renda: where the income of the last six months came from, and how concentrated it is. */
  "fontes-de-renda": {
    needs: ["allTx"],
    read: ({ allTx, month, money }) => {
      const months = [month, ...closedMonths(month, 5)];
      const list = incomes(allTx).filter((t) => months.includes(t.date.slice(0, 7)) && t.status === "pago");
      const by = [...groupBy(list, (t) => merchant(t.name)).values()].map((ts) => ({ name: ts[0].name, total: sum(ts), months: new Set(ts.map((t) => t.date.slice(0, 7))).size })).sort((a, b) => b.total - a.total);
      const total = by.reduce((s, b) => s + b.total, 0);
      const topShare = total > 0 ? (by[0]?.total ?? 0) / total : 0;
      return {
        empty: by.length ? undefined : "Nenhuma receita paga nos últimos 6 meses.",
        tile: "Fontes de renda", value: String(by.length), note: by[0] ? `${by[0].name} é ${pct(topShare)}` : "",
        chart: { type: "donut", center: "6 meses", slices: by.slice(0, 6).map((b, i) => ({ id: b.name, name: b.name, value: b.total, color: COLORS[i % COLORS.length] })) },
        rows: by.map((b) => ({ label: b.name, sub: `${b.months} de 6 meses`, value: money(b.total) })),
        findings: [{ tone: topShare > 0.85 ? "info" : "good", text: topShare > 0.85 ? `${pct(topShare)} da sua renda vem de ${by[0]?.name}: uma fonte só concentra quase tudo.` : `A renda vem de ${plural(by.length, "fonte", "fontes")}, nenhuma passa de ${pct(topShare)}.` }],
        summary: [`Nos últimos 6 meses entraram ${money(total)} de ${plural(by.length, "fonte", "fontes")}.`, by[0] ? `${by[0].name} responde por ${pct(topShare)}.` : ""].filter(Boolean),
        context: { fontes: by },
      };
    },
  },

  /** Próximos 30 dias: everything already scheduled to go out in the next 30 days, this month and the next. */
  "proximos-30-dias": {
    needs: ["allTx"],
    read: ({ allTx, today, money }) => {
      const end = new Date(Date.parse(`${today}T12:00:00`) + 30 * 86_400_000).toISOString().slice(0, 10);
      const list = spending(allTx).filter((t) => t.status !== "pago" && !t.card_id && t.date >= today && t.date <= end).sort((a, b) => a.date.localeCompare(b.date));
      const weeks = [0, 1, 2, 3].map((w) => list.filter((t) => Math.floor(daysBetween(today, t.date) / 7.5) === w));
      return {
        empty: list.length ? undefined : "Nada agendado para os próximos 30 dias.",
        tile: "Próximos 30 dias", value: money(sum(list)), note: plural(list.length, "conta agendada", "contas agendadas"),
        chart: { type: "bars", data: weeks.map((w, i) => ({ label: `${i + 1}ª sem`, value: sum(w), future: i > 0, focus: i === 0, valueLabel: whole(money)(sum(w)) })) },
        rows: list.map((t) => ({ label: t.name, sub: `${ddmm(t.date)} · ${t.category_name ?? "Sem categoria"}`, value: money(amount(t)) })),
        findings: list.length ? [{ tone: "info", text: `A semana mais pesada é a ${weeks.indexOf(weeks.reduce((a, b) => (sum(b) > sum(a) ? b : a))) + 1}ª: ${money(Math.max(...weeks.map(sum)))}.` }] : [],
        summary: [`Nos próximos 30 dias estão agendadas ${plural(list.length, "conta", "contas")}, ${money(sum(list))} no total.`, list[0] ? `A próxima é ${list[0].name} em ${ddmm(list[0].date)}.` : ""].filter(Boolean),
        context: { agendado: list.map((t) => ({ nome: t.name, data: t.date, valor: amount(t) })) },
      };
    },
  },

  /** Parcelas novas do mês: installment purchases made this month and how much they add to the next months. */
  "parcelas-novas": {
    needs: ["tx", "prevTx"],
    read: ({ tx, prevTx, money }) => {
      const fresh = (txs: Transaction[]) => spending(txs).filter((t) => t.installment && (t.current_installment ?? 1) === 1 && (t.total_installments ?? 1) > 1);
      const list = fresh(tx).sort((a, b) => amount(b) - amount(a));
      const monthly = list.reduce((s, t) => s + (t.installment_value ?? amount(t) / (t.total_installments ?? 1)), 0);
      const committed = list.reduce((s, t) => s + (t.installment_value ?? amount(t) / (t.total_installments ?? 1)) * ((t.total_installments ?? 1) - 1), 0);
      return {
        empty: list.length ? undefined : "Nenhuma compra parcelada nova neste mês.",
        tile: "Parcelas novas", value: money(monthly), note: `por mês · ${plural(list.length, "compra", "compras")}`,
        vs: { c: compare(list.length, fresh(prevTx).length, "lower"), label: "compras parceladas vs mês passado", format: "count" },
        rows: list.map((t) => { const per = t.installment_value ?? amount(t) / (t.total_installments ?? 1); return { label: t.name, sub: `${t.total_installments}x · ${t.card_name ?? t.account_name}`, value: `${money(per)}/mês` }; }),
        chart: list.length ? { type: "bars", data: list.slice(0, 5).map((t, i) => ({ label: t.name.slice(0, 8), value: t.installment_value ?? amount(t) / (t.total_installments ?? 1), focus: i === 0, valueLabel: `${t.total_installments}x` })) } : undefined,
        findings: list.length ? [{ tone: committed > monthly * 6 ? "bad" : "info", text: `As parcelas novas já comprometem ${money(committed)} dos próximos meses.` }] : [],
        summary: [`Neste mês você fez ${plural(list.length, "compra parcelada", "compras parceladas")}, ${money(monthly)} a mais por mês.`, `Elas já comprometem ${money(committed)} dos próximos meses.`],
        context: { parcelas: list.map((t) => ({ nome: t.name, vezes: t.total_installments, valor: amount(t) })) },
      };
    },
  },

  /** Acima do normal: categories above their average of the last three months. */
  "acima-do-normal": {
    needs: ["allTx"],
    read: ({ allTx, month, money, today }) => {
      const prev = closedMonths(month, 3);
      const cat = (t: Transaction) => t.category_name ?? "Sem categoria";
      const cur = groupBy(spending(inMonth(allTx, month)).filter((t) => t.date <= today), cat);
      const progress = Number(today.slice(8, 10)) / new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
      const list = [...cur.entries()].map(([name, ts]) => {
        const avg = prev.map((m) => sum(spending(inMonth(allTx, m)).filter((t) => cat(t) === name))).reduce((a, b) => a + b, 0) / prev.length;
        return { name, now: sum(ts), avg, expected: avg * progress, color: ts[0].category_color ?? undefined };
      }).filter((c) => c.avg > 0 && c.now > c.expected * 1.2 && c.now - c.expected > 30).sort((a, b) => (b.now - b.expected) - (a.now - a.expected));
      return {
        empty: list.length ? undefined : "Nenhuma categoria acima do que costuma ser até esta altura do mês.",
        tile: "Acima do normal", value: list[0]?.name ?? "Nada", tone: list.length ? "expense" : "income", note: list[0] ? `+${money(list[0].now - list[0].expected)} vs o normal` : "tudo no costume",
        subtitle: "Comparado à média dos últimos 3 meses, até o dia de hoje",
        chart: list.length ? { type: "bullets", items: list.slice(0, 4).map((c) => ({ label: c.name, value: c.now, limit: c.expected, note: `normal ${whole(money)(c.expected)}` })) } : undefined,
        rows: list.map((c) => ({ label: c.name, sub: `normal até hoje ${money(c.expected)} · média do mês ${money(c.avg)}`, value: money(c.now), tone: "expense" as const, color: c.color })),
        findings: list.length ? [{ tone: "bad", text: `${list[0].name} está ${money(list[0].now - list[0].expected)} acima do que costuma estar nesta altura do mês.` }] : [],
        summary: list.length ? [`${plural(list.length, "categoria está", "categorias estão")} acima do normal para esta altura do mês.`, `${list[0].name}: ${money(list[0].now)} contra ${money(list[0].expected)} de costume.`] : ["Todas as categorias estão dentro do que costumam gastar."],
        context: { acima: list },
      };
    },
  },

  /** Onde você economizou: categories below their usual spending — what is working. */
  "onde-economizou": {
    needs: ["allTx"],
    read: ({ allTx, month, money }) => {
      const m = addMonth(month, -1), prev = closedMonths(m, 3);
      const cat = (t: Transaction) => t.category_name ?? "Sem categoria";
      const last = groupBy(spending(inMonth(allTx, m)), cat);
      const names = new Set(prev.flatMap((pm) => spending(inMonth(allTx, pm)).map(cat)));
      const list = [...names].map((name) => {
        const avg = prev.map((pm) => sum(spending(inMonth(allTx, pm)).filter((t) => cat(t) === name))).reduce((a, b) => a + b, 0) / prev.length;
        return { name, now: sum(last.get(name) ?? []), avg };
      }).filter((c) => c.avg > 30 && c.now < c.avg * 0.85).sort((a, b) => (b.avg - b.now) - (a.avg - a.now));
      const saved = list.reduce((s, c) => s + c.avg - c.now, 0);
      return {
        empty: list.length ? undefined : `Em ${shortMonthName(m)} nenhuma categoria ficou bem abaixo da média.`,
        tile: "Você economizou", value: money(saved), tone: "income", note: `em ${shortMonthName(m)} vs a média`,
        subtitle: `${cap(shortMonthName(m))} contra a média dos 3 meses antes`,
        chart: list.length ? { type: "bars", data: list.slice(0, 5).map((c, i) => ({ label: c.name.slice(0, 8), value: c.avg - c.now, focus: i === 0, valueLabel: `−${whole(money)(c.avg - c.now)}` })) } : undefined,
        rows: list.map((c) => ({ label: c.name, sub: `média ${money(c.avg)} → ${money(c.now)}`, value: `−${money(c.avg - c.now)}`, tone: "income" as const })),
        findings: list.length ? [{ tone: "good", text: `${list[0].name} ficou ${money(list[0].avg - list[0].now)} abaixo da média: o que você mudou ali está funcionando.` }] : [],
        summary: list.length ? [`Em ${shortMonthName(m)} você gastou ${money(saved)} a menos que o normal em ${plural(list.length, "categoria", "categorias")}.`, `A maior economia foi em ${list[0].name}.`] : ["Nenhuma economia em relação à média no mês passado."],
        context: { economias: list },
      };
    },
  },

  /** Dinheiro parado: what is in the accounts beyond six months of spending, which could be earning. */
  "dinheiro-parado": {
    needs: ["accounts", "allTx"],
    read: ({ accounts, allTx, month, money }) => {
      const balance = accounts.filter((a) => a.active && a.type !== "beneficio").reduce((s, a) => s + Math.max(0, a.balance), 0);
      const prev = closedMonths(month, 3);
      const avg = prev.map((m) => sum(spending(inMonth(allTx, m)))).reduce((a, b) => a + b, 0) / prev.length;
      const reserve = avg * 6, extra = Math.max(0, balance - reserve);
      const checking = accounts.filter((a) => a.active && ["corrente", "digital", "salario"].includes(a.type)).reduce((s, a) => s + Math.max(0, a.balance), 0);
      return {
        empty: avg > 0 ? undefined : "É preciso alguns meses de gastos para saber quanto é reserva e quanto está parado.",
        tile: "Dinheiro parado", value: money(extra), tone: extra > 0 ? undefined : "income", note: extra > 0 ? "acima de 6 meses de gastos" : "tudo cabe na reserva",
        chart: { type: "segmented", total: Math.max(balance, 0.01), segments: [{ value: Math.min(balance, reserve), color: "var(--income)", label: "Reserva (6 meses)" }, { value: extra, color: "var(--finnos-purple)", label: "Além da reserva" }] },
        rows: [{ label: "Nas contas", value: money(balance) }, { label: "Em conta corrente", value: money(checking) }, { label: "Reserva de 6 meses", value: money(reserve) }, { label: "Além da reserva", value: money(extra) }],
        findings: [{ tone: extra > 0 && checking > reserve ? "info" : "good", text: extra > 0 ? `${money(extra)} estão além da reserva: em conta corrente esse dinheiro não rende.` : "O que você tem nas contas ainda está dentro da reserva de 6 meses." }],
        summary: [`Você tem ${money(balance)} nas contas e gasta em média ${money(avg)} por mês.`, extra > 0 ? `Tirando 6 meses de reserva, sobram ${money(extra)} que poderiam estar rendendo.` : "Esse valor ainda cabe na reserva de emergência."],
        context: { saldo: balance, conta_corrente: checking, reserva_6m: reserve, alem: extra },
      };
    },
  },

  /** Dias no vermelho: days of the month the accounts closed negative. */
  "dias-no-vermelho": {
    needs: ["history"],
    read: ({ history, money }) => {
      const days = history?.days ?? [];
      const red = days.filter((d) => d.balance < 0);
      const lowest = days.reduce<{ date: string; balance: number } | null>((m, d) => (!m || d.balance < m.balance ? d : m), null);
      return {
        empty: days.length ? undefined : "Ainda não há saldo diário neste mês.",
        tile: "Dias no vermelho", value: String(red.length), tone: red.length ? "expense" : "income", note: `de ${days.length} dias do mês`,
        chart: { type: "line", points: days.map((d) => ({ value: d.balance, kind: "real" as const, label: ddmm(d.date) })) },
        rows: red.map((d) => ({ label: ddmm(d.date), value: money(d.balance), tone: "expense" as const })),
        findings: [{ tone: red.length ? "bad" : "good", text: red.length ? `O saldo fechou negativo em ${plural(red.length, "dia", "dias")}; o mais baixo foi ${money(lowest!.balance)} em ${ddmm(lowest!.date)}.` : `Nenhum dia no vermelho; o saldo mais baixo foi ${money(lowest?.balance ?? 0)}.` }],
        summary: [red.length ? `Neste mês o saldo das contas ficou negativo em ${plural(red.length, "dia", "dias")}.` : "Neste mês o saldo nunca ficou negativo.", lowest ? `O ponto mais baixo foi ${money(lowest.balance)} em ${ddmm(lowest.date)}.` : ""].filter(Boolean),
        context: { dias_negativos: red.length, mais_baixo: lowest },
      };
    },
  },

  /** Custo de vida: what an ordinary month costs in essentials (fixed bills + necessities), on average. */
  "custo-de-vida": {
    needs: ["allTx", "categories"],
    read: ({ allTx, categories, month, money }) => {
      const essential = new Set(categories.filter((c) => c.group === "necessidades").map((c) => c.id));
      const prev = closedMonths(month, 3);
      const per = prev.map((m) => { const ts = spending(inMonth(allTx, m)); const ess = ts.filter((t) => t.fixed || t.recurrence || (t.category_id && essential.has(t.category_id))); return { m, ess: sum(ess), all: sum(ts) }; });
      const avg = per.reduce((s, p) => s + p.ess, 0) / per.length, all = per.reduce((s, p) => s + p.all, 0) / per.length;
      const byCat = [...groupBy(prev.flatMap((m) => spending(inMonth(allTx, m))).filter((t) => t.fixed || t.recurrence || (t.category_id && essential.has(t.category_id))), (t) => t.category_name ?? "Sem categoria").entries()].map(([name, ts]) => ({ name, avg: sum(ts) / prev.length, color: ts[0].category_color ?? undefined })).sort((a, b) => b.avg - a.avg);
      return {
        empty: avg > 0 ? undefined : "É preciso alguns meses de lançamentos para calcular o custo de vida.",
        tile: "Custo de vida", value: money(avg), note: `por mês · ${pct(all > 0 ? avg / all : 0)} dos gastos`,
        subtitle: "Contas fixas e necessidades, média dos últimos 3 meses",
        chart: { type: "bars", data: per.reverse().map((p) => ({ label: short(p.m), value: p.ess, valueLabel: whole(money)(p.ess) })) },
        rows: byCat.map((c) => ({ label: c.name, value: `${money(c.avg)}/mês`, color: c.color })),
        findings: [{ tone: "info", text: `Para manter o básico você precisa de ${money(avg)} por mês; uma reserva de 6 meses seria ${money(avg * 6)}.` }],
        summary: [`Seu custo de vida (contas fixas e necessidades) é de ${money(avg)} por mês.`, `Isso é ${pct(all > 0 ? avg / all : 0)} de tudo que você gasta.`, byCat[0] ? `O maior item é ${byCat[0].name}.` : ""].filter(Boolean),
        context: { custo_de_vida: avg, itens: byCat },
      };
    },
  },

  /** Juros e tarifas: what was paid in interest, fees, IOF and annual fees in the last 12 months. */
  "juros-e-tarifas": {
    needs: ["allTx"],
    read: ({ allTx, month, money }) => {
      const months = [month, ...closedMonths(month, 11)];
      const re = /\b(juros?|tarifas?|iof|anuidades?|multas?|encargos?|mora|cesta de servi\w*|taxa de manuten\w*)\b/i;
      const list = spending(allTx).filter((t) => months.includes(t.date.slice(0, 7)) && (re.test(t.name) || re.test(t.category_name ?? "")));
      const total = sum(list);
      const by = [...groupBy(list, (t) => merchant(t.name)).values()].map((ts) => ({ name: ts[0].name, total: sum(ts), count: ts.length })).sort((a, b) => b.total - a.total);
      return {
        empty: list.length ? undefined : "Nenhum juro, tarifa, IOF ou anuidade nos últimos 12 meses.",
        tile: "Juros e tarifas", value: money(total), tone: total > 0 ? "expense" : "income", note: "nos últimos 12 meses",
        chart: { type: "bars", data: months.slice(0, 6).reverse().map((m) => ({ label: short(m), value: sum(list.filter((t) => t.date.slice(0, 7) === m)), focus: m === month })) },
        rows: by.map((b) => ({ label: b.name, sub: `${b.count}x em 12 meses`, value: money(b.total), tone: "expense" as const })),
        findings: list.length ? [{ tone: "bad", text: `Em um ano foram ${money(total)} só em juros e tarifas; ${by[0].name} é o que mais pesa.` }] : [],
        summary: list.length ? [`Nos últimos 12 meses você pagou ${money(total)} em juros, tarifas, IOF e anuidades.`, `O maior é ${by[0].name}: ${money(by[0].total)}.`, "Vale negociar a anuidade ou trocar por uma conta sem tarifa."] : ["Você não pagou juros nem tarifas no último ano."],
        context: { custos: by },
      };
    },
  },
};

export type { Row };
