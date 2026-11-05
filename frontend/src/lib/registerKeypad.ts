/** Calculator keypad of the quick entry: what each key does and how the expression is valued. */
export const OPS = ["+", "−", "×", "÷"];
/** Calculator keypad: evaluates "12,50+3×2" with × ÷ before + −; a trailing operator is ignored. */
export function evaluateExpression(expr: string): number {
  const tokens = expr.match(/\d+(?:,\d*)?|[+−×÷]/g) ?? [];
  const nums: number[] = [];
  const ops: string[] = [];
  for (const t of tokens) {
    if (OPS.includes(t)) ops.push(t);
    else nums.push(Number(t.replace(",", ".")));
  }
  ops.length = Math.max(0, Math.min(ops.length, nums.length - 1));
  const terms = [nums[0] ?? 0];
  const signs: string[] = [];
  ops.forEach((op, i) => {
    const b = nums[i + 1];
    if (op === "×") terms[terms.length - 1] *= b;
    else if (op === "÷") terms[terms.length - 1] = b ? terms[terms.length - 1] / b : 0;
    else { signs.push(op); terms.push(b); }
  });
  const result = signs.reduce((acc, op, i) => (op === "+" ? acc + terms[i + 1] : acc - terms[i + 1]), terms[0]);
  return Math.round(result * 100) / 100;
}
export const KEYS = ["1", "2", "3", "+", "4", "5", "6", "−", "7", "8", "9", "×", ",", "0", "⌫", "÷"];

/** Next expression after a key: never two operators in a row, one comma per number,
 *  at most 2 decimals and 9 digits, and no leading zeros. */
export function pressKey(current: string, key: string): string {
  const lastNumber = current.split(/[+−×÷]/).at(-1) ?? "";
  if (key === "⌫") return current.slice(0, -1);
  if (OPS.includes(key)) return !current ? current : OPS.includes(current.at(-1) ?? "") ? current.slice(0, -1) + key : current + key;
  if (key === ",") return lastNumber.includes(",") ? current : current + (lastNumber ? "," : "0,");
  if (lastNumber.includes(",") && lastNumber.split(",")[1].length >= 2) return current;
  if (lastNumber.replace(",", "").length >= 9) return current;
  return lastNumber === "0" ? current.slice(0, -1) + key : current + key;
}

/** What the user is typing, in Brazilian format ("R$ 1.234,5"); null when there is an operator. */
export function typedDisplay(expr: string): string | null {
  if (!expr || /[+−×÷]/.test(expr)) return null;
  const [int, dec] = expr.split(",");
  return `R$ ${Number(int || "0").toLocaleString("pt-BR")}${dec !== undefined ? `,${dec}` : ""}`;
}
