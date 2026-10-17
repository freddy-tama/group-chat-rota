export default function Home() {
  return (
    <main style={{ maxWidth: 640, margin: "15vh auto", padding: "0 16px", fontFamily: "system-ui, sans-serif", lineHeight: 1.5 }}>
      <h1 style={{ fontSize: 40, margin: 0 }}>Group Chat Rota</h1>
      <p style={{ fontSize: 20 }}>
        Your staff already posted their availability in the group chat. Paste it: each &ldquo;can&rsquo;t do tues after 4&rdquo;
        becomes a quoted constraint you confirm, and a deterministic solver builds the week&rsquo;s rota within your rest and hours rules.
      </p>
      <p>The demo is being built right now. Check back shortly.</p>
    </main>
  );
}
