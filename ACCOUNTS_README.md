# Accounts & Billing — installation and use

This update adds a dedicated `accounts.html` section to the existing Haulxify Partner Portal. It retains the old hired-lead collection tracker under **Lead Collections**. It does not automatically turn old lead collections into accounting transactions, so you can choose correct opening balances without double counting.

## Install on your existing portal

1. Back up your Supabase database and existing website files.
2. In the existing project's **SQL Editor**, run **accounts_setup.sql**, as the database owner. This is an additive, transactional installer. It creates the financial tables and functions and closes the profile self-promotion/signup role paths found in the supplied setup. Do **not** rerun the original `setup.sql` on a live project.
3. Upload the updated site files, including `accounts.html`, all `finance-*` / `finance.*` files, the modified `app.js`, `nav.html`, `admin.html`, and the **complete vendor folder**. Keep your existing `config.js` project URL and public anon/publishable key. This remains a static website; no application server, build step, paid PDF service, or new Edge Function is required for accounting.
4. Sign in as an active, approved super admin. Open **Accounts** in the top navigation, then **Business settings**. Enter the firm's actual name, address, contact details, tax/registration identifier, payment instructions and terms. Defaults are **HAULXIFY**, **PKR** base currency, and **Asia/Karachi**. Set the base currency before recording anything: it is protected once documents or ledger entries exist.
5. If `unionenterprisespakistan@gmail.com` already existed in Supabase Auth when the installer ran, it receives **View only**, without changing its portal role. If it does not exist, invite/create it through the existing portal, then select **Accounts → Access → View only → Save access** for the correct user. No password is invented or created by this update. The account must be active, approved and email-confirmed.
6. Run **accounts_verify.sql** for the read-only checks, then test with a super admin, the Union user, and an ordinary user before using real records.

Keep the internal **portal_finance** schema out of Supabase's exposed schemas. The browser calls the guarded `public.finance_api` function. Every financial table uses RLS; direct browser inserts, updates and deletes are denied. Do not put a service-role/secret key in `config.js`.

The supplied archive calls an existing **invite-user Edge Function**, but does not contain its implementation. That service is retained and was not inspected or deployed here. It must validate the calling user's permission before assigning privileged roles or changing profiles. The updated super-admin user creation flow explicitly applies the selected role after an invite, because privileged signup metadata is no longer trusted. Test that existing invite/approval workflow on your project.

## Permissions

| User / grant | Read, search and download | Financial changes | Business settings / access grants |
| --- | --- | --- | --- |
| Active, approved, confirmed super admin | Yes | Yes | Yes |
| View only — Union's default | Yes | No | No |
| View & edit — explicitly granted | Yes | Yes | No |
| No access / inactive / unapproved / unconfirmed | No | No | No |

Super admins assign **No access**, **View only**, or **View & edit** to any existing portal user through the Access tab. Permissions are independent of the user's sales/admin role. Every database request rechecks permission; the open Accounts page also checks for permission changes every 30 seconds. Previously downloaded files cannot be recalled.

## What is included

- Overview with booked income, expenses, profit/loss, cash/bank balances and current unpaid/overdue totals.
- Client and supplier records, archived contacts, and downloadable client/supplier statements.
- Draft invoices and supplier bills with line items, quantities, rates, percentage discounts before tax, manually entered tax percentages, due dates, references, terms and payment instructions.
- Server-generated invoice/bill numbers, frozen issued business/contact details, and local PDF downloads. Long documents use multiple pages with repeated table headers and page numbers.
- Partial/full payments, settlement accounts, receipts, paid/unpaid/partially-paid/overdue status, payment reversals and document cancellation.
- Paid expenses with custom categories, dates, receipt references, notes and optional contacts. Filtering by date, category, account and status; corrections reverse and replace atomically.
- Custom chart of accounts, cash/bank accounts, internal transfers, capital, drawings, loans, assets, opening balances and balanced manual journals.
- General ledger with account/date/search filters and opening/closing account balances.
- Profit & loss, balance sheet, trial balance, expenses by category, cash/bank movements, current receivables/payables and aging. Reports download as PDF or CSV.
- CSV exports of all matching records across pages, with spreadsheet formula-injection protection.
- Append-only posting history, audit log, request retry protection, locked periods and protections against stale draft edits.

## Workflows

**Invoice:** add a Client contact → Invoices → New invoice → Save draft or Save & issue → View invoice → Download PDF. Issuing posts revenue, any entered tax, and receivables. No invoice is emailed or messaged automatically.

**Mark paid:** View the issued invoice → Mark paid / record payment → choose bank/cash, payment date, amount and settlement rate. A full payment marks it Paid; a smaller payment marks it Partially paid.

**Paid back to unpaid:** use **Set unpaid** and enter a reason/reversal date. All active receipts reverse together. The original receipts stay in history and the bank/cash balance changes accordingly. Use this when correcting a receipt or recording an actual refund. A past-due unpaid invoice shows Overdue. No status field can silently change the ledger.

**Supplier bill:** add a Supplier contact → Supplier bills → New bill → enter expense or fixed-asset lines → issue → record payment when paid. Entered purchase tax posts separately to Recoverable tax; tax treatment and rates are your manual choice.

**Expense:** Expenses → Add expense → category, paid-from account, amount and date. For a mistake, use **Correct** to reverse and replace together, or **Void** to reverse it. Posted records are preserved; unissued drafts may be deleted with an audit record.

**Opening balances:** record bank/cash/equipment/loans/capital using a balanced journal. Use an invoice or supplier bill with **Opening receivable / payable** checked for balances carried from previous books; it posts to Opening balance equity instead of new income/expense. Manual journals cannot bypass the receivable/payable control accounts. Reconcile opening equity with your accountant.

**Currencies:** PKR and USD transactions are supported. All ledger, bank/cash and financial reports use the configured base currency. An invoice/bill records its issue exchange rate; each payment records its actual settlement rate. The difference posts to exchange gain/loss, and the final payment clears the original carrying balance exactly. Cash/bank accounts are maintained in base currency. Exchange rates are entered manually; foreign-currency bank revaluation and automatic rates are not included.

**Periods:** Business settings → Lock books through date. Entries and reversals on/before that date are rejected. Use an open date for a correction, or have a super admin reopen the period deliberately.

## Reporting details and boundaries

Profit/loss uses **accrual postings**, rather than cash receipts. Balance sheet and trial balance are **as of the selected end date**. Receivables/payables and aging explicitly show **current outstanding balances**, independent of the report date filter. Cash/bank movement reports include transfers and reversals; they are account movement summaries, not a statutory cash-flow statement. Category reports include paid expenses, issued supplier bills and ledger adjustments. Opening invoices/bills do not inflate income or expenses.

This is one firm's set of books, not separate ledgers for each existing partner company. Invoice/bill taxes are manually entered, and the module does not generate jurisdiction-specific tax filings. Payroll calculation, inventory accounting, bank feeds/reconciliation automation, automatic recurring invoices, public invoice links, direct email/WhatsApp delivery and dedicated credit-note workflows are not included in this release.

Use Supabase's database backup/export process for full recoverable backups; CSV/PDF downloads are reports rather than database backups. Newly posted financial records are not sample/demo data: the installer seeds only settings and account categories, and grants the existing Union identity read access.

## Tests

The included tests use **PGlite (PostgreSQL)** with a small Auth fixture, not a substitute database engine. They verify real SQL calculations, posting balance, invoice/payment lifecycle, permissions, direct-write denial, signup/profile safeguards, retries, reversals and locked periods. They do not connect to your production project or verify its existing Edge Functions.

```sh
npm ci
npm test
```

The website itself does not need Node or npm. `vendor` contains pinned Supabase JS 2.117.2, jsPDF 4.2.1 and embedded DejaVu PDF fonts, with licenses. PDF downloads run locally in the browser. English PDF layouts, desktop/mobile views, form creation, read-only/denied views, pagination and downloads were also checked in a local headless browser against the accounting SQL. Test your live deployment and invoice details before sending financial documents.
