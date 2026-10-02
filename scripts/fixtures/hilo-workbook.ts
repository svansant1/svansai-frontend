import type { WorkbookSpec } from "../../lib/artifacts/workbook-spec";

// Test fixture only: real chat generation uses the generic workbook schema, not a keyword template.
export const hiloPrompt = `Create an interactive Excel workbook for blackjack Hi-Lo card-counting practice using a 6-deck shoe. Do not create a static reference table.
I need 6 rounds with separate cells where I can manually enter the actual card ranks dealt, such as 2, 5, 9, 10, J, Q, K, or A.
2–6 = +1, 7–9 = 0, 10/J/Q/K/A = -1.
Calculate hand count, cumulative running count, estimated decks remaining based on cards entered, and true count using actual Excel formulas.
Include a top summary: Current Running Count, Estimated Decks Remaining, True Count, Shoe Status. Send it as an .xlsx file.`;

export function hiloSpec(): WorkbookSpec {
  const summary: WorkbookSpec["sheets"][number] = { name: "Summary", columnWidths: [23,18,23,18,23,18,15,24], freezeRows: 10, cells: [
    { address: "A1", value: "Six-deck Hi-Lo practice", style: "title" },
    { address: "A3", value: "Current Running Count", style: "header" }, { address: "C3", value: "Estimated Decks Remaining", style: "header" },
    { address: "E3", value: "True Count", style: "header" }, { address: "G3", value: "Shoe Status", style: "header" },
    { address: "A4", formula: "D16", style: "output" }, { address: "C4", formula: "E16", numberFormat: "0.00", style: "output" },
    { address: "E4", formula: "F16", numberFormat: "0.00", style: "output" },
    { address: "G4", formula: 'IF(COUNTIF(C11:C16,"Fix cards")>0,"Fix card entries",IF(SUM(B11:B16)=0,"Not started",IF(E16=0,"Shoe exhausted","In progress")))', style: "output" },
    { address: "A7", value: "Starting decks" }, { address: "B7", value: 6 }, { address: "C7", value: "Cards per deck" }, { address: "D7", value: 52 },
    { address: "A8", value: "Enter actual ranks in the blue cells on Card Inputs. Clear entries to restart. True count is unrounded running count / decks remaining.", style: "note" },
    ...["Round","Cards entered","Hand count","Running count","Decks remaining","True count"].map((value,index) => ({ address: `${String.fromCharCode(65+index)}10`, value, style: "header" as const })),
  ], merges: ["A1:H1", "A8:H8"], conditionalFormats: [{ range: "D11:D16", operator: "lessThan", value: 0, color: "FEE2E2" }] };
  const inputs: WorkbookSpec["sheets"][number] = { name: "Card Inputs", freezeRows: 3, columnWidths: Array(12).fill(12), cells: [{ address: "A1", value: "Card ranks — blue inputs, green calculated values", style: "title" }], merges: ["A1:L1"], validations: [], formulaFills: [] };
  const ranks = ["2","3","4","5","6","7","8","9","10","J","Q","K","A"];
  for (let round = 0; round < 6; round++) {
    const rank = String.fromCharCode(65 + round * 2), value = String.fromCharCode(66 + round * 2), row = 11 + round;
    inputs.cells.push({ address: `${rank}3`, value: `Round ${round+1}`, style: "header" }, { address: `${value}3`, value: "Hi-Lo value", style: "header" });
    inputs.validations!.push({ range: `${rank}4:${rank}55`, type: "list", values: ranks });
    const card = `UPPER(TRIM(${rank}4&""))`;
    const is = (choices: string[]) => `OR(${choices.map((v) => `${card}="${v}"`).join(",")})`;
    inputs.formulaFills!.push({ range: `${value}4:${value}55`, formula: `IF(${rank}4="","",IF(${is(ranks.slice(0,5))},1,IF(${is(ranks.slice(5,8))},0,IF(${is(ranks.slice(8))},-1,"Invalid"))))` });
    const range = `'Card Inputs'!${value}4:${value}55`;
    summary.cells.push(
      { address: `A${row}`, value: round+1 },
      { address: `B${row}`, formula: `COUNT(${range})` },
      { address: `C${row}`, formula: `IF(COUNTIF(${range},"Invalid")>0,"Fix cards",SUM(${range}))` },
      { address: `D${row}`, formula: `IF(COUNTIF($C$11:C${row},"Fix cards")>0,"Fix cards",SUM($C$11:C${row}))` },
      { address: `E${row}`, formula: `MAX(0,$B$7-SUM($B$11:B${row})/$D$7)`, numberFormat: "0.00" },
      { address: `F${row}`, formula: `IF(OR(D${row}="Fix cards",E${row}=0),"N/A",D${row}/E${row})`, numberFormat: "0.00" },
    );
  }
  return { version: 1, title: "Blackjack Hi-Lo Practice", sheets: [summary, inputs] };
}
