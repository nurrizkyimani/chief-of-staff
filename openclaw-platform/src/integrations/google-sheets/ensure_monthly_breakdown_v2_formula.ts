import { env } from "../../config/env.js";
import { ReceiptError, getErrorStatus } from "../../errors/receipt_errors.js";
import { createSheetsClient } from "./sheets_client.js";

export const monthlyBreakdownV2DetailFormula = `=LET(receipt_rows,IFERROR(FILTER({TEXT(${env.RECEIPT_SHEET_RAW}!M2:M,"yyyy-mm"),${env.RECEIPT_SHEET_RAW}!H2:H,${env.RECEIPT_SHEET_RAW}!E2:E,${env.RECEIPT_SHEET_RAW}!F2:F,${env.RECEIPT_SHEET_RAW}!A2:A},${env.RECEIPT_SHEET_RAW}!M2:M<>""),{"","","","",""}),raw,IFERROR(SPLIT(FLATTEN(FILTER(${env.CICILAN_SHEET_RAW}!J2:J&"|"&${env.CICILAN_SHEET_RAW}!I2:I&"|"&${env.CICILAN_SHEET_RAW}!E2:E&"|"&${env.CICILAN_SHEET_RAW}!A2:A,${env.CICILAN_SHEET_RAW}!A2:A<>"")&"|"&SEQUENCE(1,120,0)),"|"),{"","","","",""}),cicilan_rows,IFERROR(FILTER({TEXT(EDATE(DATEVALUE(INDEX(raw,,1)&"-01"),VALUE(INDEX(raw,,5))),"yyyy-mm"),IF(INDEX(raw,,1)<>"","cicilan",""),ROUND(VALUE(INDEX(raw,,3))/VALUE(INDEX(raw,,2))),VALUE(INDEX(raw,,5))*0,INDEX(raw,,4)},VALUE(INDEX(raw,,5))<VALUE(INDEX(raw,,2))),{"","","","",""}),QUERY({receipt_rows;cicilan_rows},"select Col1, Col2, sum(Col3), sum(Col4), count(Col5) where Col1 is not null and Col1 <> '' group by Col1, Col2 order by Col1 desc, Col2 label Col1 'month', Col2 'classification', sum(Col3) 'total_amount', sum(Col4) 'total_tax', count(Col5) 'receipt_count'",0))`;

export const monthlyBreakdownV2PivotFormula = `=LET(receipt_rows,IFERROR(FILTER({TEXT(${env.RECEIPT_SHEET_RAW}!M2:M,"yyyy-mm"),${env.RECEIPT_SHEET_RAW}!H2:H,${env.RECEIPT_SHEET_RAW}!E2:E},${env.RECEIPT_SHEET_RAW}!M2:M<>""),{"","",""}),raw,IFERROR(SPLIT(FLATTEN(FILTER(${env.CICILAN_SHEET_RAW}!J2:J&"|"&${env.CICILAN_SHEET_RAW}!I2:I&"|"&${env.CICILAN_SHEET_RAW}!E2:E,${env.CICILAN_SHEET_RAW}!A2:A<>"")&"|"&SEQUENCE(1,120,0)),"|"),{"","","",""}),cicilan_rows,IFERROR(FILTER({TEXT(EDATE(DATEVALUE(INDEX(raw,,1)&"-01"),VALUE(INDEX(raw,,4))),"yyyy-mm"),IF(INDEX(raw,,1)<>"","cicilan",""),ROUND(VALUE(INDEX(raw,,3))/VALUE(INDEX(raw,,2)))},VALUE(INDEX(raw,,4))<VALUE(INDEX(raw,,2))),{"","",""}),source,{receipt_rows;cicilan_rows},total,QUERY(source,"select Col1, sum(Col3) where Col1 is not null and Col1 <> '' group by Col1 order by Col1 desc label Col1 'month', sum(Col3) 'total_month'",0),pivot,QUERY(source,"select Col1, sum(Col3) where Col1 is not null and Col1 <> '' group by Col1 pivot Col2 order by Col1 desc label Col1 'month', sum(Col3) ''",0),HSTACK(total,CHOOSECOLS(pivot,SEQUENCE(1,COLUMNS(pivot)-1,2,1))))`;

export async function ensureMonthlyBreakdownV2Formulas(): Promise<void> {
  try {
    const sheets = createSheetsClient();
    const read = await sheets.spreadsheets.values.batchGet({
      spreadsheetId: env.RECEIPT_SPREADSHEET_ID,
      ranges: [`${env.MONTHLY_BREAKDOWN_V2_SHEET}!A1`, `${env.MONTHLY_BREAKDOWN_V2_SHEET}!G1`],
      valueRenderOption: "FORMULA"
    });
    const values = read.data.valueRanges ?? [];
    const currentDetail = values[0]?.values?.[0]?.[0];
    const currentPivot = values[1]?.values?.[0]?.[0];
    const updates: Array<{ range: string; values: string[][] }> = [];

    if (currentDetail !== monthlyBreakdownV2DetailFormula) {
      updates.push({
        range: `${env.MONTHLY_BREAKDOWN_V2_SHEET}!A1`,
        values: [[monthlyBreakdownV2DetailFormula]]
      });
    }
    if (currentPivot !== monthlyBreakdownV2PivotFormula) {
      updates.push({
        range: `${env.MONTHLY_BREAKDOWN_V2_SHEET}!G1`,
        values: [[monthlyBreakdownV2PivotFormula]]
      });
    }
    if (updates.length === 0) return;

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: env.RECEIPT_SPREADSHEET_ID,
      requestBody: {
        valueInputOption: "USER_ENTERED",
        data: updates
      }
    });
  } catch (error) {
    throw new ReceiptError("SHEETS_WRITE", "Could not update monthly_breakdown_v2 formulas.", {
      cause: error,
      status: getErrorStatus(error)
    });
  }
}
