export function Footer({ demo = true }: { demo?: boolean }) {
  return (
    <footer className="mt-auto flex flex-wrap gap-x-6 gap-y-2 bg-ink/90 px-8 py-3 text-[13px] text-[#e8dcc8]">
      {demo && <span>Synthetic demo data: every name and message is made up.</span>}
      <span>Rest and hours are checked against your house rules; legal compliance is the manager&rsquo;s call.</span>
      <a className="ml-auto text-[#e8dcc8] underline" href="https://github.com/freddy-tama/group-chat-rota">Source and test suite on GitHub</a>
    </footer>
  );
}
