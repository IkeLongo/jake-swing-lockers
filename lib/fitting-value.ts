import { Prisma } from "@/app/generated/prisma/client";

type Price = Prisma.Decimal | string | number | null;

export function sumPrices(prices: readonly Price[]): number {
  const total = prices.reduce<Prisma.Decimal>(
    (sum, price) => price === null ? sum : sum.plus(price),
    new Prisma.Decimal(0),
  );
  const cents = total.times(100);
  if (!cents.isInteger() || !Number.isSafeInteger(cents.toNumber())) {
    throw new Error("The calculated price cannot be represented safely.");
  }
  return cents.toNumber() / 100;
}

export function calculateFittingValue(
  clubs: readonly { includeInReport: boolean | null; estimatedPrice: Price }[],
) {
  const included = clubs.filter((club) => club.includeInReport !== false);
  const prices = included.map((club) => club.estimatedPrice);
  const pricedCount = prices.filter((price) => price !== null).length;
  const hasAnyPrice = pricedCount > 0;
  const hasMissingPrices = pricedCount < included.length;

  return {
    includedClubCount: included.length,
    totalClubCount: clubs.length,
    total: sumPrices(prices),
    hasAnyPrice,
    hasPartialPrice: hasAnyPrice && hasMissingPrices,
    hasMissingPrices,
  };
}
