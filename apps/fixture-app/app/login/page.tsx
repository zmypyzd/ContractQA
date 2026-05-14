'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (email && password) {
          // Simulate Supabase-style session: writes sb-* keys to localStorage.
          localStorage.setItem(
            'sb-fixture-auth-token',
            JSON.stringify({ access_token: 'fake', user: { email } }),
          );
          router.push('/lobby');
        }
      }}
      style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 320 }}
    >
      <h1>Login</h1>
      <label>
        Email
        <input
          aria-label="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </label>
      <label>
        Password
        <input
          aria-label="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </label>
      <button type="submit">Sign in</button>
    </form>
  );
}
