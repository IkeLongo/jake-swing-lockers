/**
 * Focused validation test pass for demoFormSchema.
 * Run with:  node --experimental-vm-modules scripts/test-validation.mjs
 * (or via the npm script below)
 *
 * We re-implement the schema inline using the same logic as
 * lib/validations/demo.ts so we can run it with plain Node (no tsx needed).
 */

import { z } from "zod";

// ── Helpers (mirrors lib/validations/demo.ts) ─────────────────────────────────

const optionalDecimal = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? undefined : Number(v)),
  z.number().nonnegative().optional()
);

const requiredPositiveDecimal = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? undefined : Number(v)),
  z.number().positive("Must be greater than 0")
);

const optionalInt = z.preprocess(
  (v) =>
    v === "" || v === null || v === undefined
      ? undefined
      : parseInt(String(v), 10),
  z.number().int().nonnegative().optional()
);

const optionalStr = z.preprocess(
  (v) =>
    v === "" || v === null || v === undefined
      ? undefined
      : String(v).trim() || undefined,
  z.string().optional()
);

const demoTabSchema = z.object({
  clubType:       z.string().trim().min(1, "Required"),
  brand:          z.string().trim().min(1, "Required"),
  model:          z.string().trim().min(1, "Required"),
  shaft:          z.string().trim().min(1, "Required"),
  loft:           z.string().trim().min(1, "Required"),
  estimatedPrice: requiredPositiveDecimal,
  notes:          optionalStr,
  clubSpeed:      optionalDecimal,
  ballSpeed:      optionalDecimal,
  smashFactor:    optionalDecimal,
  carryDistance:  optionalDecimal,
  totalDistance:  optionalDecimal,
  launchAngle:    optionalDecimal,
  spinRate:       optionalInt,
  dispersion:     optionalDecimal,
});

const CURRENT_CORE = ["clubType", "brand", "model", "shaft", "loft"];

const currentTabSchema = z
  .object({
    clubType:       optionalStr,
    brand:          optionalStr,
    model:          optionalStr,
    shaft:          optionalStr,
    loft:           optionalStr,
    estimatedPrice: optionalDecimal,
    notes:          optionalStr,
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

const demoFormSchema = z
  .object({
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
      z.string().regex(/^\d{10}$/, "Must be a valid 10-digit US phone number").optional()
    ),
    salesRep: z.string().trim().min(1, "Sales rep is required"),
    demoDate: z.preprocess(
      (v) => (v === "" || v === null || v === undefined ? undefined : new Date(String(v))),
      z.date()
    ),
    clientGoal: z.string().trim().optional(),
    notes:      z.string().trim().optional(),
    demoClubs: z.array(
      z.object({
        isRecommended: z.preprocess((v) => v === true || v === "true", z.boolean()).optional(),
        demo:    demoTabSchema,
        current: currentTabSchema,
      })
    ).min(1, "Add at least one demo club"),
  })
  .superRefine((data, ctx) => {
    if (!data.email && !data.phone) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Provide an email address or phone number", path: ["email"] });
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Provide an email address or phone number", path: ["phone"] });
    }
  });

// ── Test harness ──────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function flatErrors(result) {
  if (result.success) return {};
  return result.error.flatten().fieldErrors;
}

function assert(label, result, expectSuccess, checks = []) {
  const ok = result.success === expectSuccess;
  const errors = flatErrors(result);
  let checksPassed = true;

  for (const { path, contains } of checks) {
    // path is like "phone" or "demoClubs.0.demo.estimatedPrice"
    const parts = path.split(".");
    // flatten gives top-level keys only; for nested we look at fieldErrors
    let msgs;
    if (parts.length === 1) {
      msgs = errors[parts[0]] ?? [];
    } else {
      // nested errors come through as flat keys like "demoClubs" with sub-errors
      // use flatten().fieldErrors which only flattens one level; for nested paths
      // we have to inspect the raw issues
      msgs = result.success
        ? []
        : result.error.issues
            .filter((i) => i.path.join(".") === path)
            .map((i) => i.message);
    }

    if (!msgs.some((m) => m.includes(contains))) {
      console.error(`  ✗ CHECK FAILED [${path}]: expected message containing "${contains}", got: ${JSON.stringify(msgs)}`);
      checksPassed = false;
    }
  }

  if (ok && checksPassed) {
    console.log(`  ✓ PASS  ${label}`);
    passed++;
  } else {
    if (!ok) {
      console.error(`  ✗ FAIL  ${label}`);
      console.error(`         Expected success=${expectSuccess}, got success=${result.success}`);
      if (!result.success) {
        const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
        console.error(`         Issues: ${issues.join(" | ")}`);
      }
    }
    failed++;
  }
}

// ── Shared fixtures ───────────────────────────────────────────────────────────

const goodDemo = {
  clubType: "Driver", brand: "TaylorMade", model: "Qi10", shaft: "Ventus 6S",
  loft: "9", estimatedPrice: "599",
};

const blankCurrent = {
  clubType: "", brand: "", model: "", shaft: "", loft: "", estimatedPrice: "",
  notes: "", clubSpeed: "", ballSpeed: "", smashFactor: "", carryDistance: "",
  totalDistance: "", launchAngle: "", spinRate: "", dispersion: "",
};

function basePayload(overrides = {}) {
  return {
    firstName: "Jake",
    lastName:  "Swing",
    email:     "jake@example.com",
    phone:     "",
    salesRep:  "Bob",
    demoDate:  "2026-05-08",
    clientGoal: "",
    notes: "",
    demoClubs: [{ isRecommended: false, demo: { ...goodDemo }, current: { ...blankCurrent } }],
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

console.log("\n── Running validation tests ──────────────────────────────────\n");

// 1. Empty form fails
// Note: Zod 4 emits "Invalid input: expected string, received undefined" (not
// the .min(1) message) when a string field is wholly absent. The form always
// submits "" so the user sees "First name is required"; both are correct rejects.
assert(
  "1. Empty form fails",
  demoFormSchema.safeParse({}),
  false
  // no message check — any error on firstName is acceptable
);

// 2. First + last + phone only passes (no email)
assert(
  "2. First + last + phone only (no email) passes",
  demoFormSchema.safeParse(basePayload({ email: "", phone: "(210) 730-6232" })),
  true
);

// 3. First + last + email only passes (no phone)
assert(
  "3. First + last + email only (no phone) passes",
  demoFormSchema.safeParse(basePayload({ email: "jake@example.com", phone: "" })),
  true
);

// 4. Missing sales rep fails
assert(
  "4. Missing sales rep fails",
  demoFormSchema.safeParse(basePayload({ salesRep: "" })),
  false,
  [{ path: "salesRep", contains: "required" }]
);

// 5. Missing demo date fails
assert(
  "5. Missing demo date fails",
  demoFormSchema.safeParse(basePayload({ demoDate: "" })),
  false
);

// 6. Demo club missing required fields fails (blank club type)
assert(
  "6. Demo club missing required fields fails",
  demoFormSchema.safeParse(basePayload({
    demoClubs: [{ isRecommended: false,
      demo: { ...goodDemo, clubType: "" },
      current: { ...blankCurrent }
    }]
  })),
  false,
  [{ path: "demoClubs.0.demo.clubType", contains: "Required" }]
);

// 7. Demo club estimatedPrice = 0 fails
assert(
  "7. Demo club estimatedPrice 0 fails",
  demoFormSchema.safeParse(basePayload({
    demoClubs: [{ isRecommended: false,
      demo: { ...goodDemo, estimatedPrice: "0" },
      current: { ...blankCurrent }
    }]
  })),
  false,
  [{ path: "demoClubs.0.demo.estimatedPrice", contains: "greater than 0" }]
);

// 8. Blank current club tab passes
assert(
  "8. Blank current club tab passes",
  demoFormSchema.safeParse(basePayload()),
  true
);

// 9. Partially filled current club tab fails (has model, missing clubType/brand/shaft/loft)
assert(
  "9. Partially filled current club tab fails",
  demoFormSchema.safeParse(basePayload({
    demoClubs: [{ isRecommended: false,
      demo: { ...goodDemo },
      current: { ...blankCurrent, model: "Old Ping G425" }
    }]
  })),
  false,
  [{ path: "demoClubs.0.current.clubType", contains: "Required when entering" }]
);

// 10. Phone saves as digits only (preprocess strips formatting)
{
  const result = demoFormSchema.safeParse(basePayload({ email: "", phone: "(210) 730-6232" }));
  const phoneVal = result.success ? result.data.phone : undefined;
  const digitsOnly = phoneVal === "2107306232";
  if (digitsOnly) {
    console.log(`  ✓ PASS  10. Phone normalized to digits: "${phoneVal}"`);
    passed++;
  } else {
    console.error(`  ✗ FAIL  10. Phone normalization — expected "2107306232", got "${phoneVal}"`);
    failed++;
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n── Results: ${passed} passed, ${failed} failed ────────────────────────\n`);
if (failed > 0) process.exit(1);
