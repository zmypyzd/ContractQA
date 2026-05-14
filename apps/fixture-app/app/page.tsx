import Link from 'next/link';
export default function Home() {
  return (
    <div>
      <h1>ContractQA fixture app</h1>
      <p>Reproduces the §24 Logout Bug for end-to-end loop testing.</p>
      <ul>
        <li><Link href="/login">/login</Link></li>
        <li><Link href="/lobby">/lobby</Link></li>
        <li><Link href="/agents">/agents</Link></li>
      </ul>
    </div>
  );
}
