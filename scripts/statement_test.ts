// Plain test script for the statement parser. Run with:
//   node --experimental-strip-types scripts/statement_test.ts
// The module is loaded with a dynamic import so the .ts extension Node needs does not
// trip the project's type-check settings.

type StatementModule = typeof import('../src/server/services/statement');

let failures = 0;
let passes = 0;

function check(name: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passes++;
    console.log(`PASS ${name}`);
  } else {
    failures++;
    console.log(`FAIL ${name}\n     expected ${JSON.stringify(expected)}\n     actual   ${JSON.stringify(actual)}`);
  }
}

// HDFC: preamble, DD/MM/YY dates, separate withdrawal and deposit columns, trailer.
const HDFC = `\uFEFFHDFC BANK Ltd.,,,,,,\r
Account Holder :,MR ARJUN MEHTA,,,,,\r
Account No :,50100234567890,,Currency :,INR,,\r
Statement From :,01/01/2025,To :,28/02/2025,,,\r
,,,,,,\r
Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance\r
01/01/25,NEFT CR-CITI0000002-ACME TECHNOLOGIES PVT LTD-SALARY JAN,N001250012345,01/01/25,,"1,25,000.00","1,43,210.55"\r
03/01/25,UPI-NETFLIX COM-netflixupi.payu@hdfcbank-HDFC0000001-500312345678-Netflix,0000500312345678,03/01/25,649.00,,"1,42,561.55"\r
05/01/25,UPI-BIGBASKET-bigbasket@icici-ICIC0000104-500512345678-groceries,0000500512345678,05/01/25,"2,348.50",,"1,40,213.05"\r
09/01/25,"POS 416021XXXXXX1234 SPOTIFY INDIA, MUMBAI",0000500912345678,09/01/25,119.00,,"1,40,094.05"\r
15/01/25,ACH D- AIRTEL XSTREAM FIBER-1122334455,0000000011223344,15/01/25,"1,178.82",,"1,38,915.23"\r
28/01/25,UPI-JIO PREPAID RECHARGE-jio@yesbank-YESB0000001-502812345678-Recharge,0000502812345678,28/01/25,299.00,,"1,38,616.23"\r
01/02/25,NEFT CR-CITI0000002-ACME TECHNOLOGIES PVT LTD-SALARY FEB,N032250012345,01/02/25,,"1,25,000.00","2,63,616.23"\r
03/02/25,UPI-NETFLIX COM-netflixupi.payu@hdfcbank-HDFC0000001-503412345678-Netflix,0000503412345678,03/02/25,649.00,,"2,62,967.23"\r
13/02/25,EMI 45678901 CHQ S4567890100121 0225,0000000045678901,13/02/25,"1,23,456.78",,"1,39,510.45"\r
,,,,,,\r
STATEMENT SUMMARY :-,,,,,,\r
Opening Balance,Dr Count,Cr Count,Debits,Credits,Closing Bal,\r
"18,210.55",7,2,"1,28,700.10","2,50,000.00","1,39,510.45",\r
*** End of statement ***,,,,,,\r
`;

// ICICI: currency only in the header, DD/MM/YYYY, Value Date listed before Transaction Date.
const ICICI = `DETAILED STATEMENT
Transactions List - PRIYA NAIR - 000401234567
S No.,Value Date,Transaction Date,Cheque Number,Transaction Remarks,Withdrawal Amount (INR ),Deposit Amount (INR ),Balance (INR )
1,02/03/2025,01/03/2025,,NEFT-HDFCN52025030112345-GLOBEX SERVICES-SALARY MAR,0.00,98500.00,152340.10
2,04/03/2025,04/03/2025,,UPI/506312345678/Monthly plan/spotify@icici/SPOTIFY INDIA,119.00,0.00,152221.10
3,07/03/2025,07/03/2025,,UPI/506612345678/groceries/dmart@hdfcbank/DMART READY,3275.40,0.00,148945.70
4,10/03/2025,10/03/2025,,BIL/ONL/001234567890/AIRTEL XSTREAM FIBER/7001234,1178.82,0.00,147766.88
5,12/03/2025,12/03/2025,,UPI/507112345678/Recharge/jio@yesbank/JIO PREPAID RECHARGE,349.00,0.00,147417.88
6,31/03/2025,31/03/2025,,000401234567:Int.Pd:01-01-2025 to 31-03-2025,0.00,1012.00,148429.88
`;

// SBI: tab separated, named months, blank cells as single spaces, Indian digit grouping.
const SBI = [
  'Account Name\t: Mr. ROHAN VERMA',
  'Account Number\t: _00000031234567890',
  'Start Date\t: 1 Apr 2025',
  'End Date\t: 30 Apr 2025',
  '',
  'Txn Date\tValue Date\tDescription\tRef No./Cheque No.\tDebit\tCredit\tBalance',
  '1 Apr 2025\t1 Apr 2025\tBY TRANSFER-NEFT*UTIB0000123*INITECH INDIA*SALARY APR\tTRANSFER FROM 3199123456\t \t1,49,000.00\t1,61,220.75',
  '5 Apr 2025\t5 Apr 2025\tTO TRANSFER-UPI/DR/509512345678/NETFLIX/HDFC/netflixupi/Payme\tTRANSFER TO 4897691234\t649.00\t \t1,60,571.75',
  '11 Apr 2025\t11 Apr 2025\tTO TRANSFER-UPI/DR/510112345678/JIO PREPAID RECHARGE/YESB/jio\tTRANSFER TO 4897695678\t299.00\t \t1,60,272.75',
  '18 Apr 2025\t18 Apr 2025\tTO TRANSFER-UPI/DR/510812345678/RELIANCE FRESH/ICIC/groceries\tTRANSFER TO 4897699012\t1,842.00\t \t1,58,430.75',
  '25-Apr-25\t25-Apr-25\tATM WDL-ATM CASH 1234 MG ROAD BENGALURU\t\t10,000.00\t \t1,48,430.75',
  '',
  '**This is a computer generated statement and does not require a signature.',
].join('\n');

// Axis: one amount column plus a DR/CR column, DD-MM-YYYY.
const AXIS = `Name :- KAVYA REDDY
Statement of Account No - 912010012345678 for the period (From : 01-05-2025 To : 31-05-2025)

Tran Date,CHQNO,PARTICULARS,AMOUNT(INR),DR/CR,BAL,SOL
01-05-2025,,NEFT/CITIN25012345678/UMBRELLA CORP/SALARY MAY,85000.00,CR,97310.20,248
02-05-2025,,UPI/P2M/512212345678/NETFLIX/Payment/HDFC BANK,649.00,DR,96661.20,248
06-05-2025,,UPI/P2M/512612345678/SPOTIFY INDIA/Premium/ICICI BANK,119.00,DR,96542.20,248
09-05-2025,,ECOM PUR/AIRTEL XSTREAM FIBER/GURGAON,1178.82,DR,95363.38,248
11-05-2025,,UPI/P2M/513112345678/ZEPTO/groceries/YES BANK,912.00,DR,94451.38,248
12-05-2025,,UPI/P2A/513212345678/REFUND ZEPTO/YES BANK,120.00,CR,94571.38,248
Opening Balance,TRANSACTION TOTAL,DR 2858.82,CR 85120.00,Closing Balance 94571.38,,
`;

// US bank: MM/DD/YYYY, debits negative, dollar signs, a quoted field with a comma and doubled quotes.
const US = `Date,Description,Amount
01/15/2025,ACME CORP PAYROLL DIRECT DEP,"$3,250.00"
01/17/2025,NETFLIX.COM 866-579-7172 CA,-$15.49
01/20/2025,"TRADER JOE'S #123, ""OAKLAND"" CA",-$84.12
01/22/2025,SPOTIFY USA 877-778-1161 NY,($11.99)
02/01/2025,INTEREST PAYMENT,$0.42
`;

// European bank: semicolons, DD.MM.YYYY, decimal commas and dot grouping.
const EU = `Kontoinhaber;Lena Fischer
IBAN;DE89 3704 0044 0532 0130 00

Date;Payee;Details;Amount;Currency
02.06.2025;Musterfirma GmbH;Gehalt Juni;3.850,00;EUR
03.06.2025;Vermieter Hausverwaltung;Miete Juni;-1.234,56;EUR
05.06.2025;NETFLIX INTERNATIONAL B.V.;Monatsabo;-13,99;EUR
07.06.2025;SPOTIFY AB;Premium;-10,99;EUR
09.06.2025;REWE Markt;Lebensmittel;-62,40;EUR
`;

// No header at all: date, description, amount. Two identical rows to exercise the occurrence counter.
const HEADERLESS = `2025-07-03,NETFLIX SUBSCRIPTION,649
2025-07-05,SPOTIFY PREMIUM,119.00
2025-07-08,CHAI POINT,85
2025-07-08,CHAI POINT,85
2025-07-12,JIO PREPAID RECHARGE,299
`;

// Pipe separated, amounts carrying their own Dr/Cr suffix and a rupee prefix; all days
// are 12 or lower so day-first has to come from the currency rule and row ordering.
const PIPE = `Transaction Date|Remarks|Amount
03/08/2025|UPI/NETFLIX/monthly|Rs. 649.00 Dr
05/08/2025|NEFT SALARY AUG|Rs. 1,10,000.00 Cr
07/08/2025|UPI/AIRTEL XSTREAM FIBER|Rs. 1,178.82 Dr
`;

const GARBAGE = 'hello world\nthis is not, a statement\n\u0000\u0001 {"json": true}\n<html><body>nope</body></html>';

async function main(): Promise<void> {
  const url = new URL('../src/server/services/statement.ts', import.meta.url).href;
  const { parseStatement } = (await import(url)) as StatementModule;

  const hdfc = parseStatement(HDFC);
  check('hdfc: debit count', hdfc.transactions.length, 7);
  check('hdfc: rows read', hdfc.rowsRead, 9);
  check('hdfc: rows skipped (salary credits)', hdfc.rowsSkipped, 2);
  check('hdfc: currency from preamble', hdfc.currency, 'INR');
  check('hdfc: format', hdfc.format, 'CSV with separate withdrawal/deposit columns, day-first dates');
  check('hdfc: first debit', [hdfc.transactions[0].date, hdfc.transactions[0].amount], ['2025-01-03', 649]);
  check('hdfc: netflix narration kept intact', hdfc.transactions[0].description,
    'UPI-NETFLIX COM-netflixupi.payu@hdfcbank-HDFC0000001-500312345678-Netflix');
  check('hdfc: quoted narration with comma', hdfc.transactions[2].description, 'POS 416021XXXXXX1234 SPOTIFY INDIA, MUMBAI');
  check('hdfc: indian grouping', [hdfc.transactions[6].date, hdfc.transactions[6].amount], ['2025-02-13', 123456.78]);
  check('hdfc: no salary in output', hdfc.transactions.some((t) => /SALARY/.test(t.description)), false);
  check('hdfc: ids stable across parses', parseStatement(HDFC).transactions.map((t) => t.id), hdfc.transactions.map((t) => t.id));
  check('hdfc: ids unique', new Set(hdfc.transactions.map((t) => t.id)).size, 7);

  const icici = parseStatement(ICICI);
  check('icici: debit count', icici.transactions.length, 4);
  check('icici: rows read / skipped', [icici.rowsRead, icici.rowsSkipped], [6, 2]);
  check('icici: currency from header', icici.currency, 'INR');
  check('icici: uses transaction date, not value date', icici.transactions[0].date, '2025-03-04');
  check('icici: amounts', icici.transactions.map((t) => t.amount), [119, 3275.4, 1178.82, 349]);
  check('icici: zero deposit rows excluded', icici.transactions.some((t) => /SALARY|Int\.Pd/.test(t.description)), false);

  const sbi = parseStatement(SBI);
  check('sbi: debit count', sbi.transactions.length, 4);
  check('sbi: format', sbi.format, 'Tab-separated file with separate withdrawal/deposit columns');
  check('sbi: named month date', sbi.transactions[0].date, '2025-04-05');
  check('sbi: DD-MMM-YY date', [sbi.transactions[3].date, sbi.transactions[3].amount], ['2025-04-25', 10000]);
  check('sbi: description column, not ref column', sbi.transactions[1].description,
    'TO TRANSFER-UPI/DR/510112345678/JIO PREPAID RECHARGE/YESB/jio');
  check('sbi: currency unknown', sbi.currency, null);

  const axis = parseStatement(AXIS);
  check('axis: debit count', axis.transactions.length, 4);
  check('axis: rows read / skipped', [axis.rowsRead, axis.rowsSkipped], [6, 2]);
  check('axis: format', axis.format, 'CSV with an amount column plus a Dr/Cr indicator column, day-first dates');
  check('axis: currency', axis.currency, 'INR');
  check('axis: dates', axis.transactions.map((t) => t.date), ['2025-05-02', '2025-05-06', '2025-05-09', '2025-05-11']);
  check('axis: credits excluded', axis.transactions.some((t) => /SALARY|REFUND/.test(t.description)), false);

  const us = parseStatement(US);
  check('us: debit count', us.transactions.length, 3);
  check('us: currency', us.currency, 'USD');
  check('us: month-first date', us.transactions[0].date, '2025-01-17');
  check('us: amounts', us.transactions.map((t) => t.amount), [15.49, 84.12, 11.99]);
  check('us: doubled quotes', us.transactions[1].description, 'TRADER JOE\'S #123, "OAKLAND" CA');
  check('us: format', us.format, 'CSV with one signed amount column (negatives read as debits), month-first dates');

  const eu = parseStatement(EU);
  check('eu: debit count', eu.transactions.length, 4);
  check('eu: currency', eu.currency, 'EUR');
  check('eu: european number', [eu.transactions[0].date, eu.transactions[0].amount], ['2025-06-03', 1234.56]);
  check('eu: decimal comma', eu.transactions.map((t) => t.amount).slice(1), [13.99, 10.99, 62.4]);
  check('eu: payee preferred over details', eu.transactions[1].description, 'NETFLIX INTERNATIONAL B.V.');

  const headerless = parseStatement(HEADERLESS);
  check('headerless: count (all positive means all debits)', headerless.transactions.length, 5);
  check('headerless: first row', headerless.transactions[0],
    { id: headerless.transactions[0].id, date: '2025-07-03', description: 'NETFLIX SUBSCRIPTION', amount: 649 });
  check('headerless: duplicate rows get distinct ids', new Set(headerless.transactions.map((t) => t.id)).size, 5);
  check('headerless: ids stable', parseStatement(HEADERLESS).transactions.map((t) => t.id), headerless.transactions.map((t) => t.id));
  check('headerless: format mentions headerless', headerless.format.startsWith('Headerless CSV'), true);

  const pipe = parseStatement(PIPE);
  check('pipe: debit count', pipe.transactions.length, 2);
  check('pipe: currency from Rs.', pipe.currency, 'INR');
  check('pipe: ambiguous dates read day-first for INR', pipe.transactions.map((t) => t.date), ['2025-08-03', '2025-08-07']);
  check('pipe: amount with Dr suffix', pipe.transactions[1].amount, 1178.82);

  // The same US-shaped file with only ambiguous dates: USD means month-first.
  const usAmbiguous = parseStatement('Date,Description,Amount\n03/04/2025,NETFLIX.COM,-$15.49\n03/04/2025,PAYROLL,"$2,000.00"\n');
  check('ambiguous dates: month-first for USD', usAmbiguous.transactions[0]?.date, '2025-03-04');

  for (const [name, input] of [['garbage', GARBAGE], ['empty', ''], ['header only', 'Date,Narration,Withdrawal Amt.\n']] as const) {
    let result: ReturnType<typeof parseStatement> | null = null;
    try { result = parseStatement(input); } catch { result = null; }
    check(`${name}: does not throw and returns no transactions`, result?.transactions, []);
    check(`${name}: format explains the miss`, result?.format.startsWith('Not recognised'), true);
  }

  console.log(`\n${passes} passed, ${failures} failed`);
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.log(`FAIL test script crashed: ${err instanceof Error ? err.stack : String(err)}`);
  process.exit(1);
});
