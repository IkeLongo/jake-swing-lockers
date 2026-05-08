import { z } from "zod";

/** Coerces empty/null/undefined to undefined for optional decimals. */
const optionalDecimal = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? undefined : Number(v)),
  z.number().nonnegative().optional()
);

/** Required decimal > 0; coerces empty/null/undefined to undefined first. */
const requiredPositiveDecimal = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? undefined : Number(v)),
  z.number().positive("Must be greater than 0")
);

/** Coerces empty/null/undefined to undefined for optional integers. */
const optionalInt = z.preprocess(
  (v) =>
    v === "" || v === null || v === undefined
      ? undefined
      : parseInt(String(v), 10),
  z.number().int().nonnegative().optional()
);

/** Coerces empty/blank strings to undefined for optional string fields. */
const optionalStr = z.preprocess(
  (v) =>
    v === "" || v === null || v === undefined
      ? undefined
      : String(v).trim() || undefined,
  z.string().optional()
);

// ── Demo club tab (required core fields) ──────────────────────────────────────

const demoTabSchema = z.object({
  clubType:       z.string().trim().min(1, "Required"),
  brand:          z.string().trim().min(1, "Required"),
  model:          z.string().trim().min(1, "Required"),
  shaft:          z.string().trim().min(1, "Required"),
  loft:           z.string().trim().min(1, "Required"),
  estimatedPrice: requiredPositiveDecimal,
  notes:          optionalStr,
  // Metrics — all optional
  clubSpeed:      optionalDecimal,
  ballSpeed:      optionalDecimal,
  smashFactor:    optionalDecimal,
  carryDistance:  optionalDecimal,
  totalDistance:  optionalDecimal,
  launchAngle:    optionalDecimal,
  spinRate:       optionalInt,
  dispersion:     optionalDecimal,
});

// ── Current club tab (fully optional; if any field filled, core 5 required) ───

const CURRENT_CORE = ["clubType", "brand", "model", "shaft", "loft"] as const;

const currentTabSchema = z
  .object({
    clubType:       optionalStr,
    brand:          optionalStr,
    model:          optionalStr,
    shaft:          optionalStr,
    loft:           optionalStr,
    estimatedPrice: optionalDecimal,
    notes:          optionalStr,
    // Metrics — all optional
    clubSpeed:      optionalDecimal,
    ballSpeed:      optionalDecimal,
    smashFactor:    optionalDecimal,
    carryDistance:  optionalDecimal,
    totalDistance:  optionalDecimal,
    launchAngle:    optionalDecimal,
    spinRate:       optionalInt,
    dispersion:     optionalDecimal,
  })
  .superRefine((data, ctx) => {
    // If any field has a value, the 5 core fields become required
    const hasAnyData = Object.values(data).some((v) => v !== undefined);
    if (!hasAnyData) return;
    for (const field of CURRENT_CORE) {
      if (!data[field]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Required when entering current club data",
          path: [field],
        });
      }
    }
  });

// ── Kept for server action compatibility ──────────────────────────────────────

export const clubTabSchema = z.object({
  clubType:       z.string().trim().optional(),
  brand:          z.string().trim().optional(),
  model:          z.string().trim().optional(),
  shaft:          z.string().trim().optional(),
  loft:           z.string().trim().optional(),
  estimatedPrice: optionalDecimal,
  notes:          z.string().trim().optional(),
  clubSpeed:      optionalDecimal,
  ballSpeed:      optionalDecimal,
  smashFactor:    optionalDecimal,
  carryDistance:  optionalDecimal,
  totalDistance:  optionalDecimal,
  launchAngle:    optionalDecimal,
  spinRate:       optionalInt,
  dispersion:     optionalDecimal,
});

export type ClubTabValues = z.infer<typeof clubTabSchema>;

// ── Demo club pair (one comparison = demo club + current club) ────────────────

export const demoPairSchema = z.object({
  isRecommended: z.preprocess(
    (v) => v === true || v === "true",
    z.boolean()
  ).optional(),
  demo:    demoTabSchema,
  current: currentTabSchema,
});

export type DemoPairValues = z.infer<typeof demoPairSchema>;

// ── Demo Session ──────────────────────────────────────────────────────────────

export const demoFormSchema = z
  .object({
    // Client — first/last required; at least one contact method required
    firstName: z.string().trim().min(1, "First name is required"),
    lastName:  z.string().trim().min(1, "Last name is required"),
    email: z.preprocess(
      (v) => (v === "" || v === null || v === undefined ? undefined : String(v).trim()),
      z.string().email("Invalid email address").optional()
    ),
    phone: z.preprocess(
      (v) => {
        if (v === "" || v === null || v === undefined) return undefined;
        const digits = String(v).replace(/\D/g, "");
        return digits || undefined;
      },
      z
        .string()
        .regex(/^\d{10}$/, "Must be a valid 10-digit US phone number")
        .optional()
    ),

    // Session — sales rep and date required
    salesRep: z.string().trim().min(1, "Sales rep is required"),
    demoDate: z.preprocess(
      (v) => (v === "" || v === null || v === undefined ? undefined : new Date(String(v))),
      z.date()
    ),
    clientGoal: z.string().trim().optional(),
    notes:      z.string().trim().optional(),

    // Demo club comparisons (1 – 10 pairs)
    demoClubs: z.array(demoPairSchema).min(1, "Add at least one demo club"),
  })
  .superRefine((data, ctx) => {
    // At least one contact method required
    if (!data.email && !data.phone) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide an email address or phone number",
        path: ["email"],
      });
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide an email address or phone number",
        path: ["phone"],
      });
    }
  });

export type DemoFormValues = z.infer<typeof demoFormSchema>;

export type ActionResult =
  | { success: true; lockerToken: string; demoSessionId: number }
  | { success: false; message: string; errors?: Record<string, string[]> };
