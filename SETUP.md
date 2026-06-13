# Haulxify Partner Portal — Setup Guide

A first-timer's step-by-step walkthrough from zero to live at `partnership.haulxify.com`.

---

## OVERVIEW OF WHAT YOU'RE BUILDING

| File          | Purpose                                      |
|---------------|----------------------------------------------|
| `index.html`  | Login page (all users land here first)       |
| `leads.html`  | Leads list — sales agents & status updaters  |
| `admin.html`  | Stats + user management — super admin only   |
| `app.js`      | Shared Supabase client + helper functions    |
| `style.css`   | Shared dark luxury styles                    |
| `config.js`   | Your Supabase credentials (YOU fill this in) |
| `setup.sql`   | Database setup — run once in Supabase        |

---

## STEP 1 — CREATE A FREE SUPABASE PROJECT

1. Go to **https://supabase.com** and sign up (free).
2. Click **"New Project"**.
3. Choose a name: `haulxify-partner-portal`
4. Set a **Database Password** (save it somewhere safe).
5. Pick the region closest to you (e.g., US East).
6. Click **"Create new project"** and wait ~2 minutes for it to spin up.

---

## STEP 2 — RUN THE DATABASE SETUP SQL

1. In your Supabase dashboard, go to **SQL Editor** (left sidebar).
2. Click **"New query"**.
3. Open your `setup.sql` file, copy the **entire contents**, paste it in.
4. Click **"Run"** (Ctrl+Enter).
5. You should see "Success. No rows returned." — that's correct.

This creates:
- `profiles` table (user accounts with roles)
- `leads` table (all lead data)
- `lead_activities` table (status changes, comments)
- Security rules (Row Level Security)
- A trigger that auto-creates a profile when someone signs up
- A database function for safe status-only updates

---

## STEP 3 — DISABLE EMAIL CONFIRMATION (SIMPLEST SETUP)

1. In Supabase, go to **Authentication → Settings** (left sidebar).
2. Scroll to **"Email Auth"** section.
3. Toggle **"Enable email confirmations"** → **OFF**.
4. Click **Save**.

> **Why?** With confirmations off, users can log in immediately after being created.
> You can re-enable this later if you want email verification — just also set up SMTP under Authentication → Settings → SMTP Settings.

---

## STEP 4 — GET YOUR API CREDENTIALS

1. In Supabase, go to **Settings → API** (gear icon in left sidebar).
2. Copy your **Project URL** (looks like `https://abcdefgh.supabase.co`)
3. Copy your **anon/public** key (the long string under "Project API keys")

---

## STEP 5 — FILL IN config.js

Open `config.js` and replace the placeholders:

```javascript
const SUPABASE_URL      = 'https://YOUR_PROJECT_ID.supabase.co';  // ← paste URL here
const SUPABASE_ANON_KEY = 'YOUR_ANON_PUBLIC_KEY_HERE';             // ← paste key here
```

Save the file.

---

## STEP 6 — CREATE YOUR FIRST SUPER ADMIN USER

### 6a. Create the account
1. In Supabase, go to **Authentication → Users**.
2. Click **"Add user"** → **"Create new user"**.
3. Enter your admin **email** and a **password**.
4. Click **"Create User"**.

### 6b. Assign Super Admin role
1. Go to **SQL Editor** → **New query**.
2. Run this (replace with YOUR email):

```sql
UPDATE public.profiles
SET role = 'super_admin', full_name = 'Your Name Here'
WHERE email = 'your-admin@email.com';
```

3. Click Run. You should see "1 row affected."

---

## STEP 7 — DEPLOY TO GITHUB PAGES

### 7a. Create a GitHub repository
1. Go to **https://github.com** → **New repository**.
2. Name it: `haulxify-partner-portal`
3. Set to **Public** (required for free GitHub Pages).
4. Click **Create repository**.

### 7b. Upload your files
Option A — GitHub web interface:
1. Click **"uploading an existing file"**.
2. Drag and drop ALL your project files.
3. Click **"Commit changes"**.

Option B — Git command line:
```bash
cd haulxify-partner-portal
git init
git add .
git commit -m "Initial deploy"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/haulxify-partner-portal.git
git push -u origin main
```

### 7c. Enable GitHub Pages
1. Go to your repo → **Settings** → **Pages** (left sidebar).
2. Under **"Source"**, select **"Deploy from a branch"**.
3. Select **main** branch, **/ (root)** folder.
4. Click **Save**.
5. Wait ~2 minutes. Your site is now live at:
   `https://YOUR_USERNAME.github.io/haulxify-partner-portal`

---

## STEP 8 — CONNECT YOUR CUSTOM DOMAIN

### 8a. Add subdomain DNS record
Log in to wherever `haulxify.com` DNS is managed (GoDaddy, Cloudflare, Namecheap, etc.).
Add a **CNAME record**:

| Type  | Name        | Value                                    |
|-------|-------------|------------------------------------------|
| CNAME | partnership | YOUR_USERNAME.github.io                  |

Save and wait 5–30 minutes for DNS to propagate.

### 8b. Configure in GitHub Pages
1. Repo → **Settings → Pages**.
2. Under **"Custom domain"**, type: `partnership.haulxify.com`
3. Click **Save**.
4. Check **"Enforce HTTPS"** (available once DNS propagates).

The `CNAME` file in your repo handles this automatically.

---

## STEP 9 — TEST THE PORTAL

1. Go to `https://partnership.haulxify.com`
2. Log in with the super admin email + password you created.
3. You should land on the **Admin Dashboard**.
4. Try creating a test lead from the **Leads** page.

---

## STEP 10 — ADD MORE USERS

### From the Admin Panel (recommended):
1. Log in as super admin → go to **Admin Dashboard**.
2. Click **"+ Add User"**.
3. Fill in name, email, password, and role:
   - **Sales Agent**: can create & edit their own leads
   - **Status Updater**: can only update status and add comments
   - **Super Admin**: full access + user management
4. Click **Create User**.
5. Share the password with the user and tell them to log in at `partnership.haulxify.com`.

### Role summary:
| Role            | Create Leads | Edit Leads | Update Status | Manage Users |
|-----------------|:---:|:---:|:---:|:---:|
| Super Admin     | ✓   | ✓ (all)  | ✓   | ✓   |
| Sales Agent     | ✓   | ✓ (own)  | ✓   | ✗   |
| Status Updater  | ✗   | ✗        | ✓   | ✗   |

---

## TROUBLESHOOTING

**"Failed to load profile" on login**
→ The profile wasn't created by the trigger. Run in SQL Editor:
```sql
INSERT INTO public.profiles (id, email, full_name, role)
SELECT id, email, 'Admin', 'super_admin'
FROM auth.users
WHERE email = 'your-admin@email.com'
ON CONFLICT (id) DO UPDATE SET role = 'super_admin';
```

**White screen / console errors**
→ Check `config.js` — the URL and anon key must be correct, no trailing spaces.

**"new row violates row-level security policy"**
→ The logged-in user's role doesn't have permission. Check their role in `profiles` table via Supabase Table Editor.

**Domain not working after DNS changes**
→ DNS can take up to 24h. Check propagation at https://dnschecker.org

**User logs in but gets stuck / wrong page**
→ Check their `is_active` column in `profiles` table is `true`.

---

## SUPABASE FREE PLAN LIMITS (as of 2025)

| Resource        | Limit                      |
|-----------------|----------------------------|
| Database        | 500 MB                     |
| Auth users      | Unlimited                  |
| API calls       | 5 million / month          |
| Storage         | Not used in this project   |
| Edge Functions  | Not used in this project   |

This portal will comfortably run on the free plan for years at normal usage volumes.

---

## QUICK REFERENCE — SUPABASE DASHBOARD LOCATIONS

| Task                        | Where to go                              |
|-----------------------------|------------------------------------------|
| Run SQL                     | SQL Editor → New query                   |
| View/edit table data        | Table Editor                             |
| Manage users                | Authentication → Users                   |
| Turn off email confirmation | Authentication → Settings → Email Auth   |
| Get API keys                | Settings → API                           |
| Check logs                  | Logs → API / Auth / Postgres             |
