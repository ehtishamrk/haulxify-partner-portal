# Union Enterprises Pakistan logo update

This update adds `images/Union.webp` alongside Haulxify and AIMS on the login
partnership row and the shared top navigation used throughout the portal.
The original responsive layout is retained: partner logos and the login
partnership panel are hidden on small screens, just as they were before.

Union Enterprises Pakistan is also available under **Accounts → Business
settings → PDF logo**. Choose it and save settings if you want new invoices
and supplier bills to use that logo. The firm's name and other issuer details
remain the values you enter in Business settings. Previously issued documents
retain their original issuer snapshot and logo.

## Update an existing portal

1. Upload the updated website files, including `nav.html`, `index.html`,
   `style.css`, `finance.js`, `finance-pdf.js`, and `images/Union.webp`.
   Keep the complete existing vendor folder and your existing `config.js`.
2. If Accounts is already installed, run **union_logo_update.sql** in the
   Supabase SQL Editor as the database owner. This updates only the allowed
   PDF logo paths. It is safe to run more than once and does not alter financial
   records, user permissions, or existing issued documents. If the installed
   function differs from the supplied code, the script stops without changes.
3. Refresh the portal. Check the login page and navigation, then select the
   Union PDF logo in Business settings if desired.

For a new Accounts installation, `accounts_setup.sql` already contains the new
logo option; follow `ACCOUNTS_README.md`. Do not rerun the legacy `setup.sql`
on a live installation.

Only the requested branding has been changed. The separately supplied deep
audit report lists outstanding problems; its proposed fixes have not been
applied. No production database or website was changed during this work.
