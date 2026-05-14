'use client';
import { useEffect, useState } from 'react';

export default function AgentsPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    // BUG: only checks the surface "auth-state" key, not the actual sb-* session.
    // The contract should catch this: after logout, sb-* still exists, so this page
    // continues to render content despite the user "logging out".
    const surface = localStorage.getItem('auth-state');
    setAuthed(surface !== 'logged_out' || !!localStorage.getItem('sb-fixture-auth-token'));
  }, []);

  if (authed === false) {
    return <div>Please log in.</div>;
  }
  return (
    <div>
      <h1>Agents</h1>
      <p>Protected content. The user must be logged in to see this.</p>
    </div>
  );
}
