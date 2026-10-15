"""Builds the bank-statement fixtures used by the accounting tests.
Run:  python3 make_fixtures.py     (needs openpyxl and xlsxwriter; the outputs are committed, so you rarely need to)

One made-up ledger is rendered in several bank layouts so the parser is tested against the same truth each time.
"""
import csv, io, datetime as dt, json
from decimal import Decimal
import openpyxl, xlsxwriter

D = Decimal
OPEN = D('250000.00')
# (date, narration, ref, signed amount)
LEDGER = [
    (dt.date(2026,10,1), 'UPI-RAMESH PATEL-ramesh@okhdfcbank-HDFC0001234-612345678901-Booking DJ-AB12CD', '612345678901', D('1100.00')),
    (dt.date(2026,10,1), 'UPI-RAMESH PATEL-ramesh@okhdfcbank-HDFC0001234-612345678902-Booking DJ-AB12CD', '612345678902', D('1100.00')),
    (dt.date(2026,10,1), 'UPI-RAMESH PATEL-ramesh@okhdfcbank-HDFC0001234-612345678902-Booking DJ-AB12CD', '612345678902', D('1100.00')),
    (dt.date(2026,10,3), 'NEFT CR-RAZORPAY SOFTWARE PRIVATE LIMITED-DAJI CRICKET GROUND-RZP0000123', 'N276100001234', D('48250.50')),
    (dt.date(2026,10,5), 'ACH D- DGVCL ELECTRICITY BILL 4021234567', '000412', D('-18432.00')),
    (dt.date(2026,10,5), 'IMPS-P2A-MUKESH GROUNDSMAN-SALARY OCT', '627812345678', D('-22000.00')),
    (dt.date(2026,10,7), 'CASH DEPOSIT BRANCH VADODARA AKOTA', '', D('15000.00')),
    (dt.date(2026,10,9), 'SMS ALERT CHARGES QTR JUL-SEP 2026', '', D('-35.40')),
    (dt.date(2026,10,12), 'UPI-AMAN SHAH-aman.shah@ybl-YESB0000001-612345678903-Corporate nets', '612345678903', D('2500.00')),
    (dt.date(2026,10,12), 'CHQ PAID-RENT OCT-VADODARA REALTY LLP', '000221', D('-40000.00')),
    (dt.date(2026,10,14), 'NEFT CR-ACME SPORTS NUTRITION-SPONSORSHIP BOARD', 'N286100009876', D('25000.00')),
    (dt.date(2026,10,15), '=HYPERLINK("http://evil.example/x","Click")', 'X1', D('-1.00')),
    (dt.date(2026,10,16), 'POS 4097XXXXXXXX1234 SPORTSWORLD VADODARA BALLS AND NETS', '000778', D('-6250.75')),
]

def with_balance():
    bal = OPEN
    out = []
    for d, n, r, a in LEDGER:
        bal += a
        out.append((d, n, r, a, bal))
    return out
ROWS = with_balance()

def inr(x, west=False):
    """Indian digit grouping: 1,23,456.78"""
    s = f'{abs(x):.2f}'
    whole, frac = s.split('.')
    if west:
        w = f'{int(whole):,}'
    else:
        if len(whole) > 3:
            head, tail = whole[:-3], whole[-3:]
            parts = []
            while len(head) > 2:
                parts.insert(0, head[-2:]); head = head[:-2]
            if head: parts.insert(0, head)
            w = ','.join(parts + [tail])
        else:
            w = whole
    return f'{w}.{frac}'

def write(name, header_rows, header, body, footer_rows=(), delimiter=',', encoding='utf-8-sig'):
    buf = io.StringIO()
    w = csv.writer(buf, delimiter=delimiter, lineterminator='\r\n')
    for r in header_rows: w.writerow(r)
    w.writerow(header)
    for r in body: w.writerow(r)
    for r in footer_rows: w.writerow(r)
    open(name, 'w', encoding=encoding, newline='').write(buf.getvalue())

# 1. HDFC style: dd/mm/yy, Narration, Chq./Ref.No., Value Dt, Withdrawal Amt., Deposit Amt., Closing Balance
write('hdfc.csv',
  [['Account Branch :  VADODARA AKOTA'], ['Customer ID    :  12345678'], ['Account No     :  50100123456789'], ['Statement From : 01/10/2026 To: 31/10/2026'], [], ],
  ['Date','Narration','Chq./Ref.No.','Value Dt','Withdrawal Amt.','Deposit Amt.','Closing Balance'],
  [[d.strftime('%d/%m/%y'), n, r, d.strftime('%d/%m/%y'), inr(-a) if a < 0 else '', inr(a) if a > 0 else '', inr(b)] for d,n,r,a,b in ROWS],
  [[], ['STATEMENT SUMMARY :-'], ['Opening Balance','Dr Count','Cr Count','Debits','Credits','Closing Bal'], [inr(OPEN), '6', '7', '0', '0', inr(ROWS[-1][4])]])

# 2. SBI style: dd Mon yyyy, split dates, Debit/Credit
write('sbi.csv', [['Account Name :', 'DAJI CRICKET GROUND'], ['Account Number :', '30012345678'], []],
  ['Txn Date','Value Date','Description','Ref No./Cheque No.','Debit','Credit','Balance'],
  [[d.strftime('%d %b %Y'), d.strftime('%d %b %Y'), n, r, inr(-a, True) if a < 0 else '', inr(a, True) if a > 0 else '', inr(b, True)] for d,n,r,a,b in ROWS])

# 3. ICICI style: S No., Value Date, Transaction Date, Cheque Number, Transaction Remarks, Withdrawal Amount (INR), Deposit Amount (INR), Balance (INR)
write('icici.csv', [['Transactions List - DAJI CRICKET GROUND - 123456789012 (INR) - Oct 2026'], [], ['Account Number', '123456789012'], []],
  ['S No.','Value Date','Transaction Date','Cheque Number','Transaction Remarks','Withdrawal Amount (INR)','Deposit Amount (INR)','Balance (INR)'],
  [[i+1, d.strftime('%d/%m/%Y'), d.strftime('%d/%m/%Y'), r, n, f'{-a:.2f}' if a < 0 else '0.00', f'{a:.2f}' if a > 0 else '0.00', f'{b:.2f}'] for i,(d,n,r,a,b) in enumerate(ROWS)])

# 4. Kotak style: one amount column + Dr/Cr column
write('kotak.csv', [['Kotak Mahindra Bank'], ['Statement of Account'], []],
  ['Sl. No.','Transaction Date','Value Date','Description','Chq / Ref No.','Amount','Dr / Cr','Balance','Dr / Cr'],
  [[i+1, d.strftime('%d-%m-%Y'), d.strftime('%d-%m-%Y'), n, r, inr(abs(a)), 'DR' if a < 0 else 'CR', inr(b), 'CR'] for i,(d,n,r,a,b) in enumerate(ROWS)])

# 5. Newest first, amounts with Dr/Cr suffix inside the cell, quoted multi-line narration
write('desc_suffix.csv', [],
  ['Date','Particulars','Instrument No','Amount','Balance'],
  [[d.strftime('%d-%b-%y'), n.replace('-', '-\n', 1) if i == 4 else n, r, f'{inr(abs(a))} {"Dr" if a < 0 else "Cr"}', f'{inr(b)} Cr'] for i,(d,n,r,a,b) in reversed(list(enumerate(ROWS)))])

# 6. Semicolon separated, US dates (MM/DD/YYYY), plain signed amounts
write('semicolon_us.csv', [], ['Date','Description','Amount','Balance'],
  [[d.strftime('%m/%d/%Y'), n.replace(';', ','), f'{a:.2f}', f'{b:.2f}'] for d,n,r,a,b in ROWS], delimiter=';')

# 7. Columns swapped: headers say Withdrawal/Deposit but the data is the other way round (balance will not add up)
write('swapped.csv', [], ['Date','Narration','Withdrawal Amt.','Deposit Amt.','Closing Balance'],
  [[d.strftime('%d/%m/%Y'), n, inr(a) if a > 0 else '', inr(-a) if a < 0 else '', inr(b)] for d,n,r,a,b in ROWS])

# 8. Not a statement
open('garbage.csv','w').write('name,colour\r\nbat,willow\r\nball,red\r\n')

# 9. Real workbooks: typed dates and numbers (openpyxl), text dates + shared strings (xlsxwriter)
wb = openpyxl.Workbook(); ws = wb.active; ws.title = 'Statement'
ws.append(['DAJI CRICKET GROUND']); ws.append(['Statement for October 2026']); ws.append([])
ws.append(['Txn Date','Description','Ref No','Debit','Credit','Balance'])
for d,n,r,a,b in ROWS:
    ws.append([dt.datetime(d.year,d.month,d.day), n, r, float(-a) if a < 0 else None, float(a) if a > 0 else None, float(b)])
for row in ws.iter_rows(min_row=5, max_row=4+len(ROWS), min_col=1, max_col=1):
    for c in row: c.number_format = 'dd/mm/yyyy'
wb.save('typed.xlsx')

wb2 = xlsxwriter.Workbook('text_dates.xlsx'); s = wb2.add_worksheet('Sheet1')
for c, h in enumerate(['Date','Narration','Chq/Ref','Withdrawal','Deposit','Balance']): s.write(0, c, h)
for i,(d,n,r,a,b) in enumerate(ROWS, start=1):
    s.write_string(i, 0, d.strftime('%d/%m/%Y')); s.write_string(i, 1, n); s.write_string(i, 2, r)
    s.write_string(i, 3, inr(-a) if a < 0 else ''); s.write_string(i, 4, inr(a) if a > 0 else ''); s.write_string(i, 5, inr(b))
wb2.close()

json.dump({'opening': str(OPEN), 'rows': [{'date': d.isoformat(), 'narration': n, 'ref': r, 'paise': int(a*100), 'balance_paise': int(b*100)} for d,n,r,a,b in ROWS]}, open('truth.json','w'), indent=1)
print('ok', len(ROWS), 'rows')
