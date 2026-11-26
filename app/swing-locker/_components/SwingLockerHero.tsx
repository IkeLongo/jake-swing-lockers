import Image from "next/image";

const ISO_DATE_PREFIX = /^(\d{4})-(\d{2})-(\d{2})/;

function formatSessionDateOnly(date: string): string {
  const match = ISO_DATE_PREFIX.exec(date);

  if (!match) {
    return new Date(date).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: "UTC",
    });
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  // Parse explicit Y/M/D parts so calendar dates don't shift across browser timezones.
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

export function SwingLockerHero({
  customerName,
  fittingDate,
}: {
  customerName: string;
  fittingDate: string;
}) {
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
      <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-r from-forest/95 via-forest/80 to-forest/45 sm:via-forest/60 sm:to-forest/5" />
      <div className="relative min-w-0 px-6 py-8 text-white sm:px-10 sm:py-12">
        <p className="font-body text-xs font-bold uppercase tracking-[0.18em] text-accent">
          Your Personal Fitting Experience
        </p>
        <h1 className="mt-4 font-heading text-3xl font-bold tracking-tight sm:text-5xl">
          Your Swing Locker
        </h1>
        <p className="mt-4 break-words font-body text-base sm:text-lg">
          Prepared for {customerName}
        </p>
        <time dateTime={fittingDate} className="mt-1 block font-body text-sm text-white/80">
          {formatSessionDateOnly(fittingDate)}
        </time>
      </div>
    </header>
  );
}
