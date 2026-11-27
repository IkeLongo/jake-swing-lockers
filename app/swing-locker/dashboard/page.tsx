import Image from "next/image";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import {
  SWING_LOCKER_SESSION_COOKIE,
  verifySwingLockerSessionToken,
} from "@/lib/auth/swing-locker-session";
import { getCustomerSessions } from "@/lib/queries/customer-sessions";
import { FittingHistory } from "./_components/FittingHistory";

function WelcomeHero({ firstName }: { firstName: string }) {
  return (
    <header className="relative mb-8 flex min-h-[280px] items-end overflow-hidden rounded-2xl bg-gradient-to-br from-forest to-fairway sm:min-h-[360px]">
      <Image
        src="/headers/golden-sunset.webp"
        alt=""
        fill
        sizes="(max-width: 639px) calc(100vw - 32px), (max-width: 1023px) calc(100vw - 48px), (max-width: 1343px) calc(100vw - 64px), 1280px"
        loading="eager"
        fetchPriority="high"
        className="object-cover object-[85%_center] sm:object-[center_35%]"
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-gradient-to-r from-forest/95 via-forest/80 to-forest/45 sm:via-forest/60 sm:to-forest/5"
      />
      <div className="relative min-w-0 px-6 py-8 text-white sm:px-10 sm:py-12">
        <p className="font-body text-xs font-bold uppercase tracking-[0.18em] text-accent">
          Your Personal Fitting Experience
        </p>
        <h1 className="mt-4 break-words font-heading text-3xl font-bold tracking-tight sm:text-5xl">
          Welcome, {firstName}
        </h1>
        <p className="mt-4 font-body text-base sm:text-lg">
          Your fitting history and results, all in one place.
        </p>
      </div>
    </header>
  );
}

export default async function SwingLockerDashboardPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SWING_LOCKER_SESSION_COOKIE)?.value;

  if (!token) redirect("/swing-locker/login");

  const result = verifySwingLockerSessionToken(token);
  if (!result.valid) redirect("/swing-locker/login");

  const { golfClientId } = result.payload;
  const [client, sessions] = await Promise.all([
    db.golfClient.findUnique({
      where: { id: golfClientId },
      select: { firstName: true },
    }),
    getCustomerSessions(golfClientId),
  ]);

  if (!client) redirect("/swing-locker/login");

  return (
    <main className="min-h-screen bg-background px-4 py-6 text-foreground sm:px-6 sm:py-10 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <WelcomeHero firstName={client.firstName?.trim() || "Golfer"} />
        <FittingHistory sessions={sessions} />
      </div>
    </main>
  );
}
