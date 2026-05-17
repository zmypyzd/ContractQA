// packages/cli/tests/autopilot/auth/supabase-temp-user.test.ts
import { describe, it, expect, vi } from 'vitest';
import { createSupabaseTempUser } from '../../../src/autopilot/auth/supabase-temp-user.js';

describe('createSupabaseTempUser', () => {
  it('creates temp user and returns lifecycle handle', async () => {
    let createdUid = '';
    const adminClient = {
      auth: {
        admin: {
          createUser: vi.fn().mockImplementation(async (args: { email: string; password: string }) => {
            createdUid = 'uid-123';
            return { data: { user: { id: createdUid, email: args.email } }, error: null };
          }),
          deleteUser: vi.fn().mockResolvedValue({ data: null, error: null }),
        },
      },
    };
    const handle = await createSupabaseTempUser({
      adminClient: adminClient as any,
      emailPrefix: 'autopilot',
    });
    expect(handle.email).toMatch(/^autopilot-/);
    expect(handle.password).toMatch(/.{16,}/);
    expect(adminClient.auth.admin.createUser).toHaveBeenCalledOnce();

    await handle.dispose();
    expect(adminClient.auth.admin.deleteUser).toHaveBeenCalledWith(createdUid);
  });

  it('throws when createUser returns error', async () => {
    const adminClient = {
      auth: { admin: {
        createUser: vi.fn().mockResolvedValue({ data: null, error: new Error('rate limit') }),
        deleteUser: vi.fn(),
      }},
    };
    await expect(createSupabaseTempUser({ adminClient: adminClient as any })).rejects.toThrow(/rate limit/);
  });

  it('dispose is idempotent (safe to call twice)', async () => {
    const adminClient = {
      auth: { admin: {
        createUser: vi.fn().mockResolvedValue({ data: { user: { id: 'uid-1', email: 'x@x' } }, error: null }),
        deleteUser: vi.fn().mockResolvedValue({ data: null, error: null }),
      }},
    };
    const handle = await createSupabaseTempUser({ adminClient: adminClient as any });
    await handle.dispose();
    await handle.dispose();
    expect(adminClient.auth.admin.deleteUser).toHaveBeenCalledOnce();
  });
});
