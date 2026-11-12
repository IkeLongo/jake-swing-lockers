import type { GolfClient, Prisma, PrismaClient } from "@/app/generated/prisma/client";
import {
  findDuplicateCandidates,
  type DuplicateCandidate,
} from "./new-customer-review";
import {
  emailMatchKey,
  parseEmailStrict,
  parsePhoneStrict,
  phoneMatchKey,
} from "./customer-identifiers";
import type { ClientIdentity } from "./new-customer-review";
import { enqueueCustomerSync } from "@/lib/ghl/customerSyncOutbox";
import { attemptCustomerSync, type CustomerSyncAttempt } from "@/lib/ghl/attemptCustomerSync";

type GolfClientReader = Pick<Prisma.TransactionClient, "golfClient">;

// Customer volume is small and GolfClient email/phone are not normalized at
// rest, so candidates are compared in application code.
export function loadClientsForDuplicateCheck(
  client: GolfClientReader,
): Promise<ClientIdentity[]> {
  return client.golfClient.findMany({
    where: { OR: [{ email: { not: null } }, { phone: { not: null } }] },
    select: { id: true, firstName: true, lastName: true, email: true, phone: true },
    orderBy: { id: "asc" },
  });
}

export type CreateGolfClientResult =
  | { status: "created"; client: GolfClient; customerSync: CustomerSyncAttempt }
  | { status: "duplicate"; candidates: DuplicateCandidate[] }
  | { status: "invalid"; error: string };

export async function createGolfClientIfUnique(
  db: PrismaClient,
  input: {
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    phone: string | null;
  },
  attemptSync: (id: number) => Promise<CustomerSyncAttempt> = attemptCustomerSync,
): Promise<CreateGolfClientResult> {
  const email = parseEmailStrict(input.email);
  if (!email.ok) return { status: "invalid", error: email.error };
  const phone = parsePhoneStrict(input.phone);
  if (!phone.ok) return { status: "invalid", error: phone.error };
  if (!email.value && !phone.value) {
    return {
      status: "invalid",
      error: "Enter a valid email address or phone number.",
    };
  }

  const result = await db.$transaction<
    { status: "created"; client: GolfClient } | { status: "duplicate"; candidates: DuplicateCandidate[] }
  >(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM StagedCustomerCreationMutex WHERE id = 1 FOR UPDATE`;
      const candidates = findDuplicateCandidates(
        await loadClientsForDuplicateCheck(tx),
        { email: email.value, phone: phone.value },
      );
      if (candidates.length > 0) {
        return { status: "duplicate", candidates };
      }

      const client = await tx.golfClient.create({
        data: {
          ...input,
          email: email.value,
          phone: phone.value,
        },
      });
      await enqueueCustomerSync(tx, {
        golfClientId: client.id,
        reason: "created",
      });
      return { status: "created", client };
    },
    { maxWait: 10_000, timeout: 30_000 },
  );
  if (result.status !== "created") return result;
  return { ...result, customerSync: await attemptSync(result.client.id) };
}

export type UpdateGolfClientResult =
  | { status: "updated"; client: GolfClient; customerSync: CustomerSyncAttempt | null }
  | { status: "duplicate"; candidates: DuplicateCandidate[] }
  | { status: "invalid"; error: string }
  | { status: "missing" };

export async function updateGolfClientIfUnique(
  db: PrismaClient,
  id: number,
  patch: {
    firstName?: string;
    lastName?: string;
    email?: string | null;
    phone?: string | null;
  },
  attemptSync: (id: number) => Promise<CustomerSyncAttempt> = attemptCustomerSync,
): Promise<UpdateGolfClientResult> {
  const parsedEmail =
    patch.email === undefined ? null : parseEmailStrict(patch.email);
  if (parsedEmail && !parsedEmail.ok) {
    return { status: "invalid", error: parsedEmail.error };
  }
  const parsedPhone =
    patch.phone === undefined ? null : parsePhoneStrict(patch.phone);
  if (parsedPhone && !parsedPhone.ok) {
    return { status: "invalid", error: parsedPhone.error };
  }

  const result = await db.$transaction<
    | { status: "updated"; client: GolfClient; syncProfileChanged: boolean }
    | { status: "missing" }
    | { status: "invalid"; error: string }
    | { status: "duplicate"; candidates: DuplicateCandidate[] }
  >(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM StagedCustomerCreationMutex WHERE id = 1 FOR UPDATE`;
      const current = await tx.golfClient.findUnique({
        where: { id },
      });
      if (!current) return { status: "missing" };

      const email =
        parsedEmail?.ok === true
          ? parsedEmail.value
          : current.email;
      const phone =
        parsedPhone?.ok === true
          ? parsedPhone.value
          : current.phone;
      const emailChanged =
        parsedEmail?.ok === true &&
        emailMatchKey(parsedEmail.value) !== emailMatchKey(current.email);
      const phoneChanged =
        parsedPhone?.ok === true &&
        phoneMatchKey(parsedPhone.value) !== phoneMatchKey(current.phone);
      const firstNameChanged =
        patch.firstName !== undefined && patch.firstName !== current.firstName;
      const lastNameChanged =
        patch.lastName !== undefined && patch.lastName !== current.lastName;
      const syncProfileChanged =
        firstNameChanged || lastNameChanged || emailChanged || phoneChanged;
      const identityChanged = emailChanged || phoneChanged;
      const validEmail = parseEmailStrict(email);
      const validPhone = parsePhoneStrict(phone);
      if (
        current.ghlContactId &&
        !(
          (validEmail.ok && validEmail.value) ||
          (validPhone.ok && validPhone.value)
        )
      ) {
        return {
          status: "invalid",
          error: "A customer linked to GHL must keep a valid email address or phone number.",
        };
      }

      const candidates = identityChanged
        ? findDuplicateCandidates(
            await loadClientsForDuplicateCheck(tx),
            {
              email: emailChanged ? email : null,
              phone: phoneChanged ? phone : null,
            },
          ).filter((candidate) => candidate.id !== id)
        : [];
      if (candidates.length > 0) {
        return { status: "duplicate", candidates };
      }

      const data = {
        ...patch,
        ...(parsedEmail?.ok === true ? { email: parsedEmail.value } : {}),
        ...(parsedPhone?.ok === true ? { phone: parsedPhone.value } : {}),
      };
      const persistedProfileChanged =
        (data.firstName !== undefined && data.firstName !== current.firstName) ||
        (data.lastName !== undefined && data.lastName !== current.lastName) ||
        (data.email !== undefined && data.email !== current.email) ||
        (data.phone !== undefined && data.phone !== current.phone);
      const client = persistedProfileChanged
        ? await tx.golfClient.update({ where: { id }, data })
        : current;

      if (syncProfileChanged) {
        await enqueueCustomerSync(tx, {
          golfClientId: id,
          reason: "profile_changed",
        });
      }
      return { status: "updated", client, syncProfileChanged };
    },
    { maxWait: 10_000, timeout: 30_000 },
  );
  if (result.status !== "updated") return result;
  return {
    status: "updated",
    client: result.client,
    customerSync: result.syncProfileChanged ? await attemptSync(id) : null,
  };
}
