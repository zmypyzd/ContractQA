export default function Login() {
  return (
    <form action="/api/login" method="post">
      <input name="email" type="email" />
      <button type="submit">Sign in</button>
    </form>
  );
}
