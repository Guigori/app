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
  /** Why the row needs the user's attention before it can be imported. */
  review_reason?: string | null;
  /** Rows whose meaning cannot be imported as a purchase/movement (e.g. invoice credits). */
  blocked?: boolean;
  /** "HH:MM" when the file has it (OFX DTPOSTED); used to tell apart same-day twins. */
  time?: string | null;
  /** OFX FITID: the bank's own id for the line (prevents conferring it twice). */
  fitid?: string | null;
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
const delimiterOf=(line:string)=>{
  let quoted=false;const seen={";":0,"\t":0,",":0};
  for(const ch of line){if(ch==='"')quoted=!quoted;else if(!quoted&&ch in seen)seen[ch as keyof typeof seen]++;}
  return seen[";"]?";":seen["\t"]?"\t":",";
};
/** RFC 4180-style split: delimiters inside quotes (e.g. "-10,50") stay in the field. */
const splitLine=(line:string,delimiter=delimiterOf(line))=>{
  const cells:string[]=[];let cell="",quoted=false;
  for(let i=0;i<line.length;i++){
    const ch=line[i];
    if(ch==='"'){if(quoted&&line[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}
    else if(ch===delimiter&&!quoted){cells.push(cell);cell="";}
    else cell+=ch;
  }
  cells.push(cell);
  return cells.map(x=>x.trim());
};
const normalizeHeader=(x:string)=>x.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
type Columns={date:number;description:number;value:number};
/** Map a header row to its columns; the balance ("saldo") column is never the amount. */
const headerColumns=(cells:string[]):Columns|null=>{
  const h=cells.map(normalizeHeader);
  const find=(re:RegExp)=>h.findIndex(x=>re.test(x)&&!/saldo|balance/.test(x));
  const date=find(/^data|^date|^dt/), value=find(/valor|amount|quantia|montante|^r\$/), description=find(/descri|histor|lancamento|estabelecimento|memo|title|titulo/);
  return date>=0&&value>=0?{date,value,description}:null;
};
const CREDIT_WORDS=/estorno|reembolso|cr[eé]dito|pagamento|pagto|devolu/i;
const invoiceCredit=(description:string,amount:number,ofx:boolean)=>
  (ofx?amount>0:amount<0)||CREDIT_WORDS.test(description);

const row=(date:string,description:string,amount:number,kind:ImportKind,ofx:boolean):ImportRow=>{
  const base={id:crypto.randomUUID(),date,description,value:Math.abs(amount),category_id:null,recurring_candidate:false};
  if(kind==="invoice"){
    if(invoiceCredit(description,amount,ofx))return {...base,type:"despesa",selected:false,blocked:true,review_reason:"Crédito, estorno ou pagamento da fatura: não é importado como compra."};
    return {...base,type:"despesa",selected:true,review_reason:null};
  }
  return {...base,type:amount<0?"despesa":"receita",selected:true,review_reason:null};
};

export function parseFinancialFile(text:string,kind:ImportKind):ImportRow[]{
  const raw=text.replace(/<STMTTRN>/gi,"\n<STMTTRN>").split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  const rows:ImportRow[]=[];
  if(/<OFX/i.test(text)||/<STMTTRN/i.test(text)){
    for(const block of text.split(/<STMTTRN>/i).slice(1)){
      const posted=block.match(/<DTPOSTED>(\d{8})(\d{4})?/i);
      const date=posted?.[1]??"";
      // Banks without a real time send 000000 or 120000: not a usable time.
      const time=posted?.[2]&&!["0000","1200"].includes(posted[2])?`${posted[2].slice(0,2)}:${posted[2].slice(2)}`:null;
      const amount=parseMoney(block.match(/<TRNAMT>([^<\r\n]+)/i)?.[1]??"");
      const description=(block.match(/<(?:NAME|MEMO)>([^<\r\n]+)/i)?.[1]??"Lançamento").trim();
      const fitid=block.match(/<FITID>([^<\r\n]+)/i)?.[1]?.trim()||null;
      if(date&&amount!==null)rows.push({...row(`${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}`,description,amount,kind,true),time,fitid});
    }
  }else{
    let columns:Columns|null=null;
    for(const line of raw){
      const all=splitLine(line);
      const header=headerColumns(all);
      if(header&&!all.some(isoDate)){columns=header;continue;}
      if(columns){
        const date=isoDate(all[columns.date]??""), amount=parseMoney(all[columns.value]??"");
        if(!date||amount===null)continue;
        const description=(columns.description>=0?all[columns.description]:"")||all.find((x,i)=>i!==columns!.value&&i!==columns!.date&&/[A-Za-zÀ-ÿ]{2}/.test(x))||"Lançamento";
        rows.push(row(date,description,amount,kind,false));
        continue;
      }
      const cells=all.map(x=>x.replace(/^"|"$/g,"").trim()).filter(Boolean);
      const dateCell=cells.find(isoDate), date=dateCell?isoDate(dateCell):null;
      const moneyCells=cells.map((x,i)=>({i,v:parseMoney(x)})).filter(x=>x.v!==null&&x.i!==cells.indexOf(dateCell??"")&&/\d/.test(cells[x.i])&&!/[A-Za-zÀ-ÿ]{2}/.test(cells[x.i]));
      if(!date||!moneyCells.length)continue;
      const picked=moneyCells[0];
      const description=cells.find((x,i)=>i!==picked.i&&x!==dateCell&&/[A-Za-zÀ-ÿ]{2}/.test(x))??"Lançamento";
      const parsed=row(date,description,picked.v as number,kind,false);
      // Without a header, a second number may be the running balance: never guess silently.
      if(moneyCells.length>1&&!parsed.blocked)rows.push({...parsed,selected:false,review_reason:"Há mais de um valor nesta linha (ex.: saldo). Confira o valor antes de importar."});
      else rows.push(parsed);
    }
  }
  const counts=new Map<string,number>();
  rows.forEach(r=>{const k=r.description.toLocaleLowerCase("pt-BR").replace(/\d+/g,"").trim();counts.set(k,(counts.get(k)??0)+1)});
  return rows.map(r=>({...r,recurring_candidate:(counts.get(r.description.toLocaleLowerCase("pt-BR").replace(/\d+/g,"").trim())??0)>=2})).slice(0,500);
}

/** OFX closing balance (<LEDGERBAL><BALAMT>), when the bank sends it. */
export function ofxClosingBalance(text:string):number|null{
  const block=text.match(/<LEDGERBAL>([\s\S]*?)(?:<\/LEDGERBAL>|<AVAILBAL>|$)/i)?.[1]??"";
  const amount=block.match(/<BALAMT>([^<\r\n]+)/i)?.[1];
  return amount===undefined?null:parseMoney(amount);
}
