export type ImportKind = "statement" | "invoice";
export type ImportRow = {
  id: string;
  date: string;
  description: string;
  value: number;
  type: "receita" | "despesa";
  selected: boolean;
  category_id: string | null;
  recurring_candidate: boolean;
};

const parseMoney=(raw:string)=>{
  const cleaned=raw.replace(/[^0-9,.-]/g,"").trim();
  if(!cleaned)return null;
  const normalized=cleaned.includes(",")?cleaned.replace(/\./g,"").replace(",","."):cleaned;
  const n=Number(normalized);
  return Number.isFinite(n)?n:null;
};
const isoDate=(raw:string)=>{
  const value=raw.trim();
  let m=value.match(/^(\d{4})[-/](\d{2})[-/](\d{2})/);
  if(m)return `${m[1]}-${m[2]}-${m[3]}`;
  m=value.match(/^(\d{2})[/-](\d{2})[/-](\d{4})/);
  if(m)return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
};
const splitLine=(line:string)=>line.includes(";")?line.split(";"):line.includes("\t")?line.split("\t"):line.split(",");

export function parseFinancialFile(text:string,kind:ImportKind):ImportRow[]{
  const raw=text.replace(/<STMTTRN>/gi,"\n<STMTTRN>").split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  const rows:ImportRow[]=[];
  if(/<OFX/i.test(text)||/<STMTTRN/i.test(text)){
    for(const block of text.split(/<STMTTRN>/i).slice(1)){
      const date=(block.match(/<DTPOSTED>(\d{8})/i)?.[1]??"");
      const amount=parseMoney(block.match(/<TRNAMT>([^<\r\n]+)/i)?.[1]??"");
      const description=(block.match(/<(?:NAME|MEMO)>([^<\r\n]+)/i)?.[1]??"Lançamento").trim();
      if(date&&amount!==null)rows.push({id:crypto.randomUUID(),date:`${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}`,description,value:Math.abs(amount),type:kind==="invoice"?"despesa":amount<0?"despesa":"receita",selected:true,category_id:null,recurring_candidate:false});
    }
  }else{
    for(const line of raw){
      const cells=splitLine(line).map(x=>x.replace(/^"|"$/g,"").trim()).filter(Boolean);
      const dateCell=cells.find(isoDate), date=dateCell?isoDate(dateCell):null;
      const moneyCells=cells.map((x,i)=>({i,v:parseMoney(x)})).filter(x=>x.v!==null&&x.i!==cells.indexOf(dateCell??""));
      if(!date||!moneyCells.length)continue;
      const picked=moneyCells[moneyCells.length-1];
      const amount=picked.v as number;
      const description=cells.find((x,i)=>i!==picked.i&&x!==dateCell&&/[A-Za-zÀ-ÿ]{2}/.test(x))??"Lançamento";
      rows.push({id:crypto.randomUUID(),date,description,value:Math.abs(amount),type:kind==="invoice"?"despesa":amount<0?"despesa":"receita",selected:true,category_id:null,recurring_candidate:false});
    }
  }
  const counts=new Map<string,number>();
  rows.forEach(r=>{const k=r.description.toLocaleLowerCase("pt-BR").replace(/\d+/g,"").trim();counts.set(k,(counts.get(k)??0)+1)});
  return rows.map(r=>({...r,recurring_candidate:(counts.get(r.description.toLocaleLowerCase("pt-BR").replace(/\d+/g,"").trim())??0)>=2})).slice(0,500);
}
