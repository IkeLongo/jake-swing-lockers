import { db } from "@/lib/db";
import { getOpportunityById } from "@/lib/ghl/opportunities";
import { mapGhlStageToJlStage } from "@/lib/pipeline/stages";
import type { PipelineCustomer, PipelineStatusVariant } from "@/lib/pipeline/types";

function formatDate(date: Date | string | null | undefined): string | undefined {
  if (!date) return undefined;
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return undefined;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(d);
}

/**
 * Loads active pipeline customers by querying DemoSessions grouped by GHL opportunity ID.
 *
 * Rules:
 * - One PipelineCard = One active GHL Opportunity.
 * - Multiple DemoSessions with the same ghlOpportunityId are grouped into one record.
 * - GHL is the source of truth for opportunity stage.
 * - If an opportunity stage maps to null (non-active or unknown), it is excluded.
 * - If an opportunity fails to fetch, it is excluded safely without breaking the whole board.
 */
export async function getPipelineCustomers(): Promise<PipelineCustomer[]> {
  // 1. Query DemoSessions that have an associated GHL opportunity
  const sessions = await db.demoSession.findMany({
    where: {
      ghlOpportunityId: { not: null },
    },
    select: {
      id: true,
      clientId: true,
      ghlOpportunityId: true,
      demoDate: true,
      status: true,
      salesRep: true,
      notes: true,
      currentClub: true,
      clientGoal: true,
      accessInviteStatus: true,
      accessInviteSentAt: true,
      lockerToken: true,
      lockerUrl: true,
      createdAt: true,
      client: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
        },
      },
      clubTests: {
        orderBy: [{ isRecommended: "desc" }, { sortOrder: "asc" }, { id: "asc" }],
        select: {
          id: true,
          clubType: true,
          brand: true,
          model: true,
          shaft: true,
          loft: true,
          isRecommended: true,
          clubRole: true,
          estimatedPrice: true,
        },
      },
      purchaseRequests: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          status: true,
          createdAt: true,
        },
      },
    },
    orderBy: {
      demoDate: "desc",
    },
  });

  if (sessions.length === 0) {
    return [];
  }

  // 2. Group DemoSessions by ghlOpportunityId
  const sessionsByOpportunityId = new Map<string, typeof sessions>();
  for (const session of sessions) {
    const oppId = session.ghlOpportunityId;
    if (!oppId) continue;
    const list = sessionsByOpportunityId.get(oppId);
    if (list) {
      list.push(session);
    } else {
      sessionsByOpportunityId.set(oppId, [session]);
    }
  }

  // 3. For each unique opportunity ID, fetch the GHL opportunity safely
  const oppEntries = Array.from(sessionsByOpportunityId.entries());
  const oppResults = await Promise.allSettled(
    oppEntries.map(async ([oppId, oppSessions]) => {
      try {
        const opp = await getOpportunityById(oppId);
        return { oppId, oppSessions, opp };
      } catch (err) {
        console.warn("[getPipelineCustomers] Failed to fetch GHL opportunity", {
          opportunityId: oppId,
          error: err instanceof Error ? err.message : String(err),
        });
        return { oppId, oppSessions, opp: null };
      }
    })
  );

  const lockerOpenedStageId = process.env.GHL_SWINGLOCKER_STAGE_LOCKER_OPENED_ID;
  const customers: PipelineCustomer[] = [];

  for (const res of oppResults) {
    if (res.status !== "fulfilled") continue;
    const { oppId, oppSessions, opp } = res.value;

    if (!opp) {
      continue;
    }

    // 4. Map GHL stage to active JL stage
    const jlStage = mapGhlStageToJlStage(opp.pipelineStageId);
    if (!jlStage) {
      // Excluded (closed/nurture/unmapped/unknown)
      continue;
    }

    // 5. Select most recent session as primary display session
    const sortedSessions = [...oppSessions].sort((a, b) => {
      const dateA = a.demoDate ? new Date(a.demoDate).getTime() : 0;
      const dateB = b.demoDate ? new Date(b.demoDate).getTime() : 0;
      if (dateB !== dateA) return dateB - dateA;
      const createdA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const createdB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      if (createdB !== createdA) return createdB - createdA;
      return b.id - a.id;
    });
    const primarySession = sortedSessions[0]!;

    // Client details
    const clientName =
      [primarySession.client.firstName, primarySession.client.lastName]
        .filter(Boolean)
        .join(" ") ||
      opp.name ||
      `Client #${primarySession.client.id}`;

    // Club & Fitting details
    const demoClubs = primarySession.clubTests.filter((c) => c.clubRole === "demo");
    const activeClub = demoClubs.find((c) => c.isRecommended) ?? demoClubs[0];

    const fittingType = activeClub?.clubType
      ? `${activeClub.clubType} Fitting`
      : primarySession.currentClub
      ? `${primarySession.currentClub} Fitting`
      : "Golf Fitting";

    const productParts = [activeClub?.brand, activeClub?.model].filter(Boolean);
    const product =
      productParts.length > 0 ? productParts.join(" ") : activeClub?.clubType ?? undefined;

    // Swing Locker sent information
    const sentSession =
      sortedSessions.find(
        (s) => s.accessInviteStatus === "sent" && s.accessInviteSentAt
      ) ?? primarySession;
    const sentAtFormatted = formatDate(sentSession?.accessInviteSentAt);

    const previewUrl = primarySession.id
      ? `/staff/demo-sessions/${primarySession.id}/preview-locker`
      : undefined;

    // Status derivation
    let status = "Demo submitted";
    let statusVariant: PipelineStatusVariant = "default";

    if (jlStage === "demo") {
      status = primarySession.status === "reviewing" ? "Demo in review" : "Demo submitted";
      statusVariant = "info";
    } else if (jlStage === "locker-sent") {
      if (lockerOpenedStageId && opp.pipelineStageId === lockerOpenedStageId) {
        status = "Locker opened";
        statusVariant = "success";
      } else {
        status = "Locker sent";
        statusVariant = "default";
      }
    } else if (jlStage === "engaged") {
      status = "In conversation";
      statusVariant = "info";
    } else if (jlStage === "considering") {
      status = "Considering purchase";
      statusVariant = "success";
    }

    customers.push({
      id: oppId,
      clientId: primarySession.client.id,
      name: clientName,
      stage: jlStage,
      fittingType,
      product,
      status,
      statusVariant,
      // timeInStage is omitted because GHL does not provide a reliable stage-entry timestamp
      contact: {
        email: primarySession.client.email ?? undefined,
        phone: primarySession.client.phone ?? undefined,
      },
      demo: {
        id: primarySession.id,
        type: fittingType,
        date: formatDate(primarySession.demoDate) ?? "",
        product,
      },
      swingLocker: {
        id: primarySession.id,
        sentAt: sentAtFormatted,
        previewUrl,
      },
    });
  }

  return customers;
}
