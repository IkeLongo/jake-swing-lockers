import type { Prisma } from "@/app/generated/prisma/client";
import type { ClientIdentity } from "./new-customer-review";

type GolfClientReader = Pick<Prisma.TransactionClient, "golfClient">;

// Customer volume is small and GolfClient email/phone are not normalized at
// rest, so candidates are compared in application code (see customer-match).
export function loadClientsForDuplicateCheck(
  client: GolfClientReader,
): Promise<ClientIdentity[]> {
  return client.golfClient.findMany({
    where: { OR: [{ email: { not: null } }, { phone: { not: null } }] },
    select: { id: true, firstName: true, lastName: true, email: true, phone: true },
    orderBy: { id: "asc" },
  });
}
