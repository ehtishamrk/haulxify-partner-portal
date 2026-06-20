-- ============================================================
-- HAULXIFY PARTNER PORTAL — DATABASE SETUP
-- Paste this entire file into Supabase → SQL Editor → Run
-- ============================================================

-- 1. PROFILES TABLE (extends auth.users with roles)
CREATE TABLE IF NOT EXISTS public.profiles (
    id          UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
    email       TEXT NOT NULL,
    full_name   TEXT NOT NULL DEFAULT 'New User',
role        TEXT NOT NULL DEFAULT 'sales_agent'
                CHECK (role IN ('super_admin', 'admin', 'sales_agent', 'status_updater')),
approved_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
is_approved BOOLEAN NOT NULL DEFAULT true,
    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    -- In the profiles CREATE TABLE block, add:
session_token TEXT
);

-- 2. LEADS TABLE
CREATE TABLE IF NOT EXISTS public.leads (
    id                          UUID DEFAULT gen_random_uuid() PRIMARY KEY,

    -- Contact Information
    owner_name                  TEXT NOT NULL,
    company_name                TEXT NOT NULL,
    phone                       TEXT,
    email                       TEXT,
    company_address             TEXT,

    -- Driver Requirements
    drivers_required            INTEGER,
    license_type                TEXT CHECK (license_type IN ('CDL', 'Non-CDL')),
    cdl_class                   TEXT CHECK (cdl_class IN ('A', 'B', 'C')),
    experience_years            INTEGER,
    route_type                  TEXT CHECK (route_type IN ('OTR', 'Regional')),
    specific_requirements       TEXT,

    -- Truck Details
    truck_year                  TEXT,
    truck_make                  TEXT,
    truck_model                 TEXT,
    transmission                TEXT CHECK (transmission IN ('Automatic', 'Manual')),
    eld_installed               BOOLEAN,
    pictures_requested          BOOLEAN DEFAULT false,

    -- Compensation
    compensation_type           TEXT CHECK (compensation_type IN (
                                    'Mileage Rate', 'Hourly Rate', 'Gross Revenue Percentage'
                                )),
    compensation_value          TEXT,

    -- Employment Terms
    employment_classification   TEXT CHECK (employment_classification IN (
                                    '1099 Independent Contractor', 'W-2 Employee'
                                )),
    commission_per_hire         TEXT,

    -- Pipeline
    status      TEXT NOT NULL DEFAULT 'New'
                    CHECK (status IN ('New','Contacted','Qualified','In Progress','Hired','Closed','Lost')),
    created_by  UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    assigned_to UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. LEAD ACTIVITY LOG
CREATE TABLE IF NOT EXISTS public.lead_activities (
    id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    lead_id       UUID REFERENCES public.leads(id) ON DELETE CASCADE NOT NULL,
    user_id       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    action_type   TEXT NOT NULL,   -- 'created' | 'edited' | 'status_changed' | 'commented'
    old_status    TEXT,
    new_status    TEXT,
    comment       TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE public.profiles        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_activities ENABLE ROW LEVEL SECURITY;

-- PROFILES policies
CREATE POLICY "profiles_select" ON public.profiles
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "profiles_insert_admin" ON public.profiles
    FOR INSERT TO authenticated
    WITH CHECK (
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('super_admin', 'admin'))
    );

CREATE POLICY "profiles_update" ON public.profiles
    FOR UPDATE TO authenticated
    USING (
        id = auth.uid()
        OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin')
    );

CREATE POLICY "profiles_delete_admin" ON public.profiles
    FOR DELETE TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin'));

-- LEADS policies
CREATE POLICY "leads_select" ON public.leads
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "leads_insert" ON public.leads
    FOR INSERT TO authenticated
    WITH CHECK (
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('super_admin','sales_agent'))
    );

CREATE POLICY "leads_update" ON public.leads
    FOR UPDATE TO authenticated
    USING (
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin')
        OR (
            EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'sales_agent')
            AND created_by = auth.uid()
        )
        OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
    );

CREATE POLICY "leads_delete_admin" ON public.leads
    FOR DELETE TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin'));

-- ACTIVITIES policies
CREATE POLICY "activities_select" ON public.lead_activities
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "activities_insert" ON public.lead_activities
    FOR INSERT TO authenticated
    WITH CHECK (user_id = auth.uid());

-- ============================================================
-- TRIGGER: Auto-create profile on signup
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.profiles (id, email, full_name, role)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'full_name', 'New User'),
        COALESCE(NEW.raw_user_meta_data->>'role', 'sales_agent')
    )
    ON CONFLICT (id) DO UPDATE SET
        email       = EXCLUDED.email,
        full_name   = EXCLUDED.full_name,
        role        = EXCLUDED.role,
        updated_at  = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- FUNCTION: Status-only update (safe for status_updater role)
-- ============================================================

CREATE OR REPLACE FUNCTION public.update_lead_status_only(
    p_lead_id   UUID,
    p_status    TEXT,
    p_comment   TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid       UUID := auth.uid();
    v_old_status TEXT;
BEGIN
    IF v_uid IS NULL THEN
        RETURN json_build_object('error', 'Not authenticated');
    END IF;

    IF p_status NOT IN ('New','Contacted','Qualified','In Progress','Hired','Closed','Lost') THEN
        RETURN json_build_object('error', 'Invalid status');
    END IF;

    SELECT status INTO v_old_status FROM public.leads WHERE id = p_lead_id;

    UPDATE public.leads
    SET status = p_status, updated_at = NOW()
    WHERE id = p_lead_id;

    IF v_old_status IS DISTINCT FROM p_status THEN
        INSERT INTO public.lead_activities (lead_id, user_id, action_type, old_status, new_status, comment)
        VALUES (p_lead_id, v_uid, 'status_changed', v_old_status, p_status, p_comment);
    ELSIF p_comment IS NOT NULL AND trim(p_comment) <> '' THEN
        INSERT INTO public.lead_activities (lead_id, user_id, action_type, comment)
        VALUES (p_lead_id, v_uid, 'commented', p_comment);
    END IF;

    RETURN json_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_lead_status_only TO authenticated;

-- ============================================================
-- AFTER RUNNING THE ABOVE:
-- 
-- 1. Go to Supabase Dashboard → Authentication → Settings
--    → Turn OFF "Enable email confirmations"
--    (So users can log in right away without confirming email)
--
-- 2. Create your first Super Admin account:
--    → Authentication → Users → Add User
--    Enter email + password, click "Create User"
--
-- 3. Then run this query to make them Super Admin
--    (replace the email with YOUR admin email):
--
--    UPDATE public.profiles
--    SET role = 'super_admin', full_name = 'Your Name'
--    WHERE email = 'your-admin@email.com';
--
-- ============================================================
-- ============================================================
-- FUNCTION: Admin assigns a lead to one of their employees
-- ============================================================
CREATE OR REPLACE FUNCTION public.assign_lead_to_employee(
    p_lead_id   UUID,
    p_assignee  UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid       UUID := auth.uid();
    v_role      TEXT;
    v_approved  BOOLEAN;
BEGIN
    SELECT role INTO v_role FROM public.profiles WHERE id = v_uid;

    IF v_role NOT IN ('super_admin', 'admin') THEN
        RETURN json_build_object('error', 'Not authorized to assign leads.');
    END IF;

    -- Verify the assignee is approved
    SELECT is_approved INTO v_approved FROM public.profiles WHERE id = p_assignee;
    IF NOT v_approved THEN
        RETURN json_build_object('error', 'Employee is not yet approved by super admin.');
    END IF;

    UPDATE public.leads
    SET assigned_to = p_assignee, updated_at = NOW()
    WHERE id = p_lead_id;

    INSERT INTO public.lead_activities (lead_id, user_id, action_type, comment)
    VALUES (p_lead_id, v_uid, 'assigned', (
        SELECT 'Assigned to ' || full_name FROM public.profiles WHERE id = p_assignee
    ));

    RETURN json_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.assign_lead_to_employee TO authenticated;
-- ============================================================
-- CHAT: RLS POLICIES FOR messages / conversations / conversation_participants
-- ============================================================

ALTER TABLE public.conversations             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages                  ENABLE ROW LEVEL SECURITY;

-- CONVERSATIONS: any authenticated user can create one,
-- and can only see conversations they belong to
DROP POLICY IF EXISTS "conversations_select" ON public.conversations;
CREATE POLICY "conversations_select" ON public.conversations
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.conversation_participants
            WHERE conversation_id = id AND user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "conversations_insert" ON public.conversations;
CREATE POLICY "conversations_insert" ON public.conversations
    FOR INSERT TO authenticated
    WITH CHECK (true);

-- CONVERSATION_PARTICIPANTS: a user can see rows for conversations
-- they're part of, and can add participants when creating a conversation
DROP POLICY IF EXISTS "participants_select" ON public.conversation_participants;
CREATE POLICY "participants_select" ON public.conversation_participants
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.conversation_participants cp
            WHERE cp.conversation_id = conversation_participants.conversation_id
              AND cp.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "participants_insert" ON public.conversation_participants;
CREATE POLICY "participants_insert" ON public.conversation_participants
    FOR INSERT TO authenticated
    WITH CHECK (true);

DROP POLICY IF EXISTS "participants_update_own" ON public.conversation_participants;
CREATE POLICY "participants_update_own" ON public.conversation_participants
    FOR UPDATE TO authenticated
    USING (user_id = auth.uid());

-- MESSAGES: a user can read/send messages only in conversations
-- they are a participant of, and only as themselves
DROP POLICY IF EXISTS "messages_select" ON public.messages;
CREATE POLICY "messages_select" ON public.messages
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.conversation_participants
            WHERE conversation_id = messages.conversation_id
              AND user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "messages_insert" ON public.messages;
CREATE POLICY "messages_insert" ON public.messages
    FOR INSERT TO authenticated
    WITH CHECK (
        sender_id = auth.uid()
        AND EXISTS (
            SELECT 1 FROM public.conversation_participants
            WHERE conversation_id = messages.conversation_id
              AND user_id = auth.uid()
        )
    );
