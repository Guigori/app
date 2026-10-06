import { Link } from "react-router-dom";
import { ArrowLeft, BarChart3 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";

type ChartSpec = {
  name: string;
  purpose: string;
  where: string;
  rule: string;
  status: "Principal" | "Complementar";
  preview: "donut" | "heatmap" | "projection" | "gauge" | "bullet" | "sparkline";
};

const chartSpecs: ChartSpec[] = [
  {
    name: "Pizza / Donut",
    purpose: "Mostrar composição e participação dentro de um total.",
    where: "Home, categorias, composição de gastos e orçamento por grupos.",
    rule: "Use para composição. Não use para tendência no tempo.",
    status: "Principal",
    preview: "donut",
  },
  {
    name: "Mapa de calor calendário",
    purpose: "Mostrar intensidade e frequência de movimentação ao longo dos dias.",
    where: "Análise mensal e leitura de hábitos financeiros.",
    rule: "Quanto maior a movimentação no dia, maior a intensidade visual.",
    status: "Principal",
    preview: "heatmap",
  },
  {
    name: "Linha de projeção",
    purpose: "Unir saldo real até hoje com estimativa até o fim do período.",
    where: "Home e Análise.",
    rule: "Realizado em linha sólida com pontos. Futuro em linha tracejada e linguagem de previsto.",
    status: "Principal",
    preview: "projection",
  },
  {
    name: "Gauge / Barra segmentada",
    purpose: "Mostrar o percentual usado de um orçamento ou meta.",
    where: "Orçamento total, metas e resumos compactos.",
    rule: "Gauge em destaques. Barra segmentada quando o espaço for menor.",
    status: "Principal",
    preview: "gauge",
  },
  {
    name: "Bullet chart",
    purpose: "Comparar gasto atual com limite, orçamento ou referência.",
    where: "Cartões, categorias com limite e orçamento.",
    rule: "A marca vertical representa o limite. Ao ultrapassá-la, o excedente muda para despesa/risco.",
    status: "Principal",
    preview: "bullet",
  },
  {
    name: "Sparklines",
    purpose: "Mostrar tendência rápida sem ocupar o espaço de um gráfico completo.",
    where: "Cards de saldo, categorias, receita, despesa e indicadores.",
    rule: "Sem eixos e sem excesso de rótulos. Serve como contexto visual rápido.",
    status: "Principal",
    preview: "sparkline",
  },
];

function DonutPreview() {
  return (
    <div className="flex items-center gap-5">
      <div
        className="h-24 w-24 rounded-full"
        style={{
          background: "conic-gradient(var(--finnos-purple) 0 52%, var(--finnos-violet) 52% 74%, var(--finnos-lilac) 74% 88%, var(--finnos-app) 88% 100%)",
          WebkitMask: "radial-gradient(circle, transparent 0 48%, #000 50%)",
          mask: "radial-gradient(circle, transparent 0 48%, #000 50%)",
        }}
      />
      <div className="space-y-2 text-xs text-muted-foreground">
        <div><span className="font-semibold text-foreground">52%</span> principal</div>
        <div><span className="font-semibold text-foreground">22%</span> secundário</div>
        <div><span className="font-semibold text-foreground">14%</span> apoio</div>
      </div>
    </div>
  );
}

function HeatmapPreview() {
  const levels = [0,1,2,0,3,1,0,2,4,1,0,3,2,1,4,0,2,3,1,4,2,0,3,1,2,4,1,0];
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-7 gap-1.5">
        {levels.map((level, index) => (
          <div
            key={index}
            className="aspect-square rounded-md border border-border/40"
            style={{
              backgroundColor:
                level === 0 ? "var(--muted)" :
                level === 1 ? "color-mix(in srgb, var(--finnos-purple) 24%, var(--background))" :
                level === 2 ? "color-mix(in srgb, var(--finnos-purple) 45%, var(--background))" :
                level === 3 ? "color-mix(in srgb, var(--finnos-violet) 72%, var(--background))" :
                "var(--finnos-purple-live)",
            }}
          />
        ))}
      </div>
      <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
        <span>Menos</span>
        {[1,2,3,4].map((level) => (
          <span
            key={level}
            className="h-3 w-3 rounded-[3px]"
            style={{
              backgroundColor:
                level === 1 ? "color-mix(in srgb, var(--finnos-purple) 24%, var(--background))" :
                level === 2 ? "color-mix(in srgb, var(--finnos-purple) 45%, var(--background))" :
                level === 3 ? "color-mix(in srgb, var(--finnos-violet) 72%, var(--background))" :
                "var(--finnos-purple-live)",
            }}
          />
        ))}
        <span>Mais</span>
      </div>
    </div>
  );
}

function ProjectionPreview() {
  return (
    <svg viewBox="0 0 320 120" className="h-28 w-full" role="img" aria-label="Exemplo de linha real e projeção futura">
      <line x1="12" y1="98" x2="308" y2="98" stroke="var(--border)" strokeWidth="2" />
      <polyline points="12,88 52,68 92,76 132,52 168,58" fill="none" stroke="var(--finnos-purple)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      {[12,52,92,132,168].map((x, i) => {
        const ys = [88,68,76,52,58];
        return <circle key={x} cx={x} cy={ys[i]} r="4.5" fill="var(--finnos-purple)" />;
      })}
      <line x1="168" y1="58" x2="302" y2="36" stroke="var(--chart-3)" strokeWidth="4" strokeDasharray="8 8" strokeLinecap="round" />
      <circle cx="302" cy="36" r="6" fill="var(--background)" stroke="var(--chart-3)" strokeWidth="4" />
      <text x="158" y="20" fill="var(--muted-foreground)" fontSize="11">hoje</text>
      <text x="245" y="26" fill="var(--chart-3)" fontSize="11">previsto</text>
    </svg>
  );
}

function GaugePreview() {
  return (
    <div className="space-y-4">
      <div className="relative mx-auto h-24 w-48 overflow-hidden">
        <div className="absolute left-0 top-0 h-48 w-48 rounded-full border-[18px] border-muted" />
        <div
          className="absolute left-0 top-0 h-48 w-48 rounded-full border-[18px] border-transparent"
          style={{
            borderTopColor: "var(--finnos-purple)",
            borderLeftColor: "var(--finnos-purple)",
            transform: "rotate(-24deg)",
          }}
        />
        <div className="absolute inset-x-0 bottom-0 text-center">
          <span className="font-heading text-2xl font-bold text-foreground">70%</span>
          <span className="block text-[11px] text-muted-foreground">do orçamento usado</span>
        </div>
      </div>
      <div className="flex h-3 overflow-hidden rounded-full bg-muted">
        <span className="w-[58%] bg-[var(--finnos-purple)]" />
        <span className="w-[18%] bg-[var(--finnos-violet)]" />
        <span className="w-[12%] bg-[var(--finnos-lilac)]" />
      </div>
    </div>
  );
}

function BulletPreview() {
  return (
    <div className="space-y-5">
      {[
        { label: "Cartão principal", width: "64%", over: false },
        { label: "Compras", width: "92%", over: true },
      ].map((item) => (
        <div key={item.label} className="space-y-1.5">
          <div className="flex justify-between text-xs">
            <span className="font-medium text-foreground">{item.label}</span>
            <span className="text-muted-foreground">{item.over ? "limite excedido" : "dentro do limite"}</span>
          </div>
          <div className="relative h-3 rounded-full bg-muted">
            <div
              className="h-3 rounded-full"
              style={{ width: item.width, backgroundColor: item.over ? "var(--expense)" : "var(--finnos-purple)" }}
            />
            <div className="absolute bottom-[-5px] left-[78%] top-[-5px] w-1 rounded-full bg-foreground" title="Limite" />
          </div>
        </div>
      ))}
    </div>
  );
}

function SparklinePreview() {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {[
        { label: "Saldo total", value: "R$ 11.476", points: "0,34 28,30 55,24 80,12 110,15 140,14 170,16 200,15", color: "var(--finnos-purple)" },
        { label: "Resultado", value: "+R$ 1.840", points: "0,38 28,35 55,31 80,27 110,30 140,20 170,18 200,10", color: "var(--finnos-violet)" },
      ].map((item) => (
        <div key={item.label} className="rounded-xl border border-border bg-background/50 p-3">
          <div className="text-xs text-muted-foreground">{item.label}</div>
          <div className="mt-0.5 text-sm font-semibold text-foreground">{item.value}</div>
          <svg viewBox="0 0 200 46" className="mt-2 h-12 w-full">
            <polyline points={item.points} fill="none" stroke={item.color} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      ))}
    </div>
  );
}

function ChartPreview({ type }: { type: ChartSpec["preview"] }) {
  if (type === "donut") return <DonutPreview />;
  if (type === "heatmap") return <HeatmapPreview />;
  if (type === "projection") return <ProjectionPreview />;
  if (type === "gauge") return <GaugePreview />;
  if (type === "bullet") return <BulletPreview />;
  return <SparklinePreview />;
}

export default function ChartSettings() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 animate-fade-up">
      <div className="flex items-start gap-3">
        <Link to="/configuracoes" className={buttonVariants({ variant: "ghost", size: "icon" })} aria-label="Voltar para configurações">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary" aria-hidden="true" />
            <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground">Gráficos FINNOS</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">Biblioteca visual oficial: significado, cores e locais de uso de cada gráfico.</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="font-heading">Semântica de cores</CardTitle>
          <CardDescription>As cores têm significado fixo em qualquer gráfico do FINNOS.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2">
          {[
            { label: "Receita / entrada", color: "var(--income)" },
            { label: "Despesa / saída", color: "var(--expense)" },
            { label: "Previsto / projeção", color: "var(--chart-3)" },
            { label: "Resultado / performance", color: "var(--finnos-purple)" },
            { label: "Institucional / estrutura", color: "var(--finnos-app)" },
            { label: "Destaque violeta", color: "var(--finnos-violet)" },
          ].map((item) => (
            <div key={item.label} className="flex items-center gap-3 rounded-xl border border-border p-3">
              <span className="h-4 w-4 rounded-full ring-2 ring-background" style={{ backgroundColor: item.color }} />
              <span className="text-sm font-medium">{item.label}</span>
            </div>
          ))}
          <p className="sm:col-span-2 mt-1 text-xs text-muted-foreground">
            Regra FINNOS: cores fortes e reconhecíveis. Evitar tons pastéis ou apagados. Vermelho, verde e amarelo são semânticos; roxo identifica resultado e a marca.
          </p>
        </CardContent>
      </Card>

      <div className="space-y-4">
        {chartSpecs.map((chart) => (
          <Card key={chart.name} data-testid={`chart-spec-${chart.preview}`}>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="font-heading text-lg">{chart.name}</CardTitle>
                <Badge variant={chart.status === "Principal" ? "default" : "secondary"}>{chart.status}</Badge>
              </div>
              <CardDescription>{chart.purpose}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-2xl border border-border bg-muted/25 p-4">
                <ChartPreview type={chart.preview} />
              </div>
              <div className="grid gap-3 text-sm sm:grid-cols-2">
                <div className="rounded-xl bg-muted/60 p-3">
                  <span className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Onde usar</span>
                  <p className="mt-1 text-foreground">{chart.where}</p>
                </div>
                <div className="rounded-xl bg-muted/60 p-3">
                  <span className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Regra de uso</span>
                  <p className="mt-1 text-foreground">{chart.rule}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="font-heading">Gramática visual FINNOS</CardTitle>
          <CardDescription>O tipo de gráfico deve responder à pergunta financeira, não apenas decorar a tela.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
          <div className="rounded-xl bg-muted/60 p-3"><strong>Composição</strong><span className="block text-muted-foreground">Pizza / Donut</span></div>
          <div className="rounded-xl bg-muted/60 p-3"><strong>Comportamento</strong><span className="block text-muted-foreground">Mapa de calor calendário</span></div>
          <div className="rounded-xl bg-muted/60 p-3"><strong>Futuro</strong><span className="block text-muted-foreground">Linha de projeção</span></div>
          <div className="rounded-xl bg-muted/60 p-3"><strong>Progresso</strong><span className="block text-muted-foreground">Gauge / Barra segmentada</span></div>
          <div className="rounded-xl bg-muted/60 p-3"><strong>Limite</strong><span className="block text-muted-foreground">Bullet chart</span></div>
          <div className="rounded-xl bg-muted/60 p-3"><strong>Tendência rápida</strong><span className="block text-muted-foreground">Sparklines</span></div>
        </CardContent>
      </Card>
    </div>
  );
}
