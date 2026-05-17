// packages/cli/src/autopilot/auth/supabase-temp-user.ts
import { randomBytes, randomUUID } from 'node:crypto';

export interface SupabaseAdminClient {
  auth: {
    admin: {
      createUser(args: { email: string; password: string; email_confirm?: boolean }): Promise<{ data: { user?: { id: string; email: string } } | null; error: unknown | null }>;
      deleteUser(uid: string): Promise<{ data: unknown | null; error: unknown | null }>;
    };
  };
}

export interface TempUserHandle {
  email: string;
  password: string;
  uid: string;
  dispose(): Promise<void>;
}

export interface CreateOpts {
  adminClient: SupabaseAdminClient;
  emailPrefix?: string;
  emailDomain?: string;
}

export async function createSupabaseTempUser(opts: CreateOpts): Promise<TempUserHandle> {
  const prefix = opts.emailPrefix ?? 'autopilot';
  const domain = opts.emailDomain ?? 'contractqa.local';
  const email = `${prefix}-${randomUUID()}@${domain}`;
  const password = randomBytes(16).toString('base64url');

  const res = await opts.adminClient.auth.admin.createUser({ email, password, email_confirm: true });
  if (res.error) throw new Error(`Supabase createUser failed: ${(res.error as Error).message}`);
  const user = res.data?.user;
  if (!user) throw new Error('Supabase createUser returned no user');

  let disposed = false;
  return {
    email,
    password,
    uid: user.id,
    async dispose() {
      if (disposed) return;
      disposed = true;
      const dr = await opts.adminClient.auth.admin.deleteUser(user.id);
      if (dr.error) throw new Error(`Supabase deleteUser failed: ${(dr.error as Error).message}`);
    },
  };
}

/** Build an admin client from service_role key (real usage; tests inject a mock). */
export async function buildSupabaseAdminClient(url: string, serviceRoleKey: string): Promise<SupabaseAdminClient> {
  const mod = await import('@supabase/supabase-js' as string).catch(() => {
    throw new Error('@supabase/supabase-js not installed — required for autopilot Supabase temp-user creation');
  });
  const { createClient } = mod as { createClient: (url: string, key: string, opts?: unknown) => SupabaseAdminClient };
  return createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
}
