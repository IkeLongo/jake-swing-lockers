import Link from "next/link";
import { LandingBrand } from "./LandingBrand";

const modules = [
  "Swing Data",
  "Swing Locker Access",
  "Purchase Requests",
  "Performance Insights",
];

const badges = [
  "Swing Insights",
  "Personalized Recommendations",
  "Secure Access",
];

export function LandingHero() {
  return (
    <section className="relative isolate min-h-screen overflow-hidden bg-[#f6f3e8] text-[#1f2a24]">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(60%_70%_at_15%_20%,rgba(78,115,88,0.18),transparent_70%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(50%_65%_at_85%_15%,rgba(35,57,47,0.2),transparent_70%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(145deg,#faf8ef_15%,#edf1e6_45%,#dde8d8_100%)]" />
      </div>

      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-6 pb-12 pt-8 sm:px-10 lg:px-12">
        <header className="flex items-center justify-between">
          <LandingBrand />
        </header>

        <div className="grid flex-1 items-center gap-12 py-12 lg:grid-cols-[1.05fr_0.95fr] lg:py-16">
          <div className="max-w-2xl animate-[fade-up_700ms_ease-out]">
            <p className="mb-4 inline-flex items-center rounded-full border border-[#53755e]/35 bg-white/60 px-4 py-1.5 text-xs font-semibold tracking-[0.11em] text-[#365041] backdrop-blur">
              Golf Demo Platform
            </p>
            <h1 className="font-heading text-4xl font-bold leading-tight tracking-tight text-[#16261f] sm:text-5xl lg:text-6xl">
              Your Golf Demo, Organized in One Place.
            </h1>
            <p className="mt-5 max-w-xl text-base leading-8 text-[#31483d] sm:text-lg">
              Review your golf demo, explore your swing insights, and access personalized recommendations — all in one place.
            </p>

            <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-center">
              <Link
                href="/swing-locker/login"
                className="inline-flex h-12 items-center justify-center rounded-full bg-[#20382d] px-7 text-sm font-bold tracking-wide text-[#f8f6ef] transition-transform duration-200 hover:-translate-y-0.5 hover:bg-[#182c23]"
              >
                Open Swing Locker
              </Link>
              <Link
                href="/staff/login"
                className="inline-flex h-12 items-center justify-center rounded-full border border-[#355443]/30 bg-white/70 px-7 text-sm font-bold tracking-wide text-[#1d3128] backdrop-blur transition-colors duration-200 hover:bg-white"
              >
                Staff Sign In
              </Link>
            </div>

            <div className="mt-7 flex flex-wrap gap-2.5">
              {badges.map((badge) => (
                <span
                  key={badge}
                  className="rounded-full border border-[#63856e]/30 bg-[#f7fbf5]/75 px-3 py-1 text-xs font-semibold text-[#2d4a3b] backdrop-blur"
                >
                  {badge}
                </span>
              ))}
            </div>
          </div>

          <div className="relative mx-auto w-full max-w-xl animate-[fade-up_850ms_ease-out] lg:ml-auto">
            <div className="rounded-3xl border border-white/45 bg-white/45 p-6 shadow-[0_25px_80px_rgba(21,42,33,0.18)] backdrop-blur-xl sm:p-7">
              <div className="mb-5 flex items-center justify-between">
                <h2 className="font-subheading text-xl font-semibold text-[#1a2d24]">
                  Platform Overview
                </h2>
                <span className="rounded-full bg-[#2a4738] px-3 py-1 text-xs font-semibold text-[#f2f6f0]">
                  Live
                </span>
              </div>

              <div className="space-y-3">
                {modules.map((moduleName) => (
                  <div
                    key={moduleName}
                    className="flex items-center justify-between rounded-2xl border border-[#6b8a77]/20 bg-[#fbfcf8]/85 px-4 py-3"
                  >
                    <p className="font-medium text-[#1f342a]">{moduleName}</p>
                    <span className="h-2.5 w-2.5 rounded-full bg-[#4f7f63]" />
                  </div>
                ))}
              </div>
            </div>

            <div className="pointer-events-none absolute -right-4 -top-4 hidden rounded-2xl border border-white/45 bg-white/55 px-4 py-3 text-xs font-semibold text-[#2f4b3e] shadow-[0_12px_34px_rgba(20,45,35,0.18)] backdrop-blur-md sm:block">
              Staff follow-ups active
            </div>
            <div className="pointer-events-none absolute -bottom-5 left-4 hidden rounded-2xl border border-white/45 bg-white/55 px-4 py-3 text-xs font-semibold text-[#2f4b3e] shadow-[0_12px_34px_rgba(20,45,35,0.18)] backdrop-blur-md sm:block">
              Customer access ready
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
