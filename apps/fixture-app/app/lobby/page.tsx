'use client';
import { useRouter } from 'next/navigation';

export default function LobbyPage() {
  const router = useRouter();
  return (
    <div>
      <h1>Lobby</h1>
      <p>You are signed in. Buggy logout below — it doesn&apos;t clear the sb-* token.</p>
      <button
        onClick={() => {
          // BUG: deletes only the "auth-state" surface flag, NOT the actual sb-* session.
          localStorage.setItem('auth-state', 'logged_out');
          // Intentionally missing: localStorage.removeItem('sb-fixture-auth-token');
          // Intentionally missing: router.replace('/login');
          router.push('/login-stub'); // soft-route to a different page; protected route still works
        }}
      >
        Logout
      </button>
    </div>
  );
}
