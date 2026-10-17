import Link from "next/link";
import { TryDemoButton } from "@/components/TryDemoButton";
import { Footer } from "@/components/Footer";

export default function Landing() {
  return (
    <div className="cork flex min-h-screen flex-col">
      <main className="mx-auto flex w-full max-w-[1200px] flex-col gap-12 px-4 pt-14 pb-10 sm:px-8">
        <div className="flex flex-wrap items-center gap-10">
          <div className="on-cork flex flex-[1_1_460px] flex-col gap-5">
            <h1 className="m-0 font-display text-5xl leading-none font-extrabold tracking-tight text-balance sm:text-[64px]">
              Your staff already told you. In the group chat.
            </h1>
            <p className="m-0 max-w-[560px] text-xl leading-snug">
              Paste it. Each &ldquo;can&rsquo;t do tues after 4&rdquo; becomes a quoted constraint you confirm, and a solver builds the
              week&rsquo;s rota within your rest and hours rules, showing exactly which message blocks each gap.
            </p>
            <div className="flex flex-wrap items-start gap-3 [text-shadow:none]">
              <TryDemoButton />
              <Link href="/login" className="min-h-11 rounded-[10px] border-2 border-paper px-5 py-3 text-lg font-bold text-paper no-underline">
                Sign in
              </Link>
            </div>
          </div>
          <div aria-hidden="true" className="relative min-h-[360px] flex-[1_1_420px]">
            <div className="absolute top-2.5 left-0 flex w-[270px] -rotate-2 flex-col gap-1.5 rounded-md bg-paper px-3.5 py-3 shadow-[0_8px_18px_rgba(40,20,5,.4)]">
              <span className="text-[13px] text-muted"><strong className="text-ink">Sam</strong> · Wed 14 · 12:03</span>
              <span className="text-[17px]">can&rsquo;t do tues after 4, also need sat off</span>
            </div>
            <div className="absolute top-32 left-[70px] flex w-[300px] rotate-1 flex-col gap-1 rounded-lg border-2 border-confirmed bg-confirmed-bg px-3 py-2.5 text-[#163a6b] shadow-[0_8px_18px_rgba(40,20,5,.35)]">
              <strong className="text-[15px]">Unavailable · Tue 20 Oct from 16:00</strong>
              <span className="text-sm">&ldquo;can&rsquo;t do tues after 4&rdquo; · quote checked · confirmed</span>
            </div>
            <div className="ruled absolute top-[214px] right-0 flex w-[200px] -rotate-[1.5deg] flex-col gap-0.5 rounded-sm border-[2.5px] border-problem px-3 py-2.5 shadow-[0_8px_18px_rgba(40,20,5,.4)]">
              <span className="text-[13px] font-bold">Sat Close · 14–22</span>
              <span className="font-hand text-[28px] font-bold text-problem">Not covered</span>
              <span className="text-xs">needs a key holder</span>
            </div>
            <svg width="100%" height="100%" className="pointer-events-none absolute inset-0 overflow-visible">
              <path d="M 300 240 C 250 200, 200 120, 170 70" fill="none" stroke="#c0262d" strokeWidth="2.5" />
            </svg>
          </div>
        </div>

        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))] gap-5">
          {[
            ["Will the AI make things up?", "Every chip quotes the message it came from, and code checks the quote is really there. Nothing changes the rota until you confirm it. Vague messages (“might be busy weekend idk”) wait for your answer instead."],
            ["Does it follow our rules?", "A deterministic solver, not the AI, places people: roles, rest between shifts and weekly hours, across midnight and clock changes. Same chat, same rota, every time. Every rota says which version of your house rules it used."],
            ["Do staff install anything?", "No. They keep using the group chat. You paste it here, and the rota shows which message blocks each gap."],
          ].map(([title, body]) => (
            <section key={title} className="ruled pinned-shadow flex flex-col gap-2 rounded-md px-5 py-4">
              <h2 className="m-0 font-display text-[22px] font-extrabold">{title}</h2>
              <p className="m-0 text-base leading-snug">{body}</p>
            </section>
          ))}
        </div>
      </main>
      <Footer demo={false} />
    </div>
  );
}
