"use client";

import { useState, useTransition } from "react";
import { useForm, useFieldArray, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createDemoSession } from "@/app/actions/demo";
import { demoFormSchema } from "@/lib/validations/demo";
import type { ActionResult } from "@/lib/validations/demo";

function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 10);
  if (digits.length === 0) return "";
  if (digits.length <= 3) return `(${digits}`;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function autoExpand(e: React.FormEvent<HTMLTextAreaElement>) {
  const el = e.currentTarget;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

// ── Types ──────────────────────────────────────────────────────────────────────
type ClubTabFields = {
  clubType: string;
  brand: string;
  model: string;
  shaft: string;
  loft: string;
  estimatedPrice: string;
  notes: string;
  clubSpeed: string;
  ballSpeed: string;
  smashFactor: string;
  carryDistance: string;
  totalDistance: string;
  launchAngle: string;
  spinRate: string;
  dispersion: string;
};

type DemoClubFields = {
  isRecommended: boolean;
  demo: ClubTabFields;
  current: ClubTabFields;
};

type FormFields = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  salesRep: string;
  demoDate: string;
  clientGoal: string;
  notes: string;
  demoClubs: DemoClubFields[];
};

type FieldErr = { message?: string };
type ClubFieldErrors = Partial<Record<keyof ClubTabFields, FieldErr>>;

// ── Helpers ────────────────────────────────────────────────────────────────────
function today(): string {
  return new Date().toISOString().split("T")[0];
}

function emptyClubTab(): ClubTabFields {
  return {
    clubType: "",
    brand: "",
    model: "",
    shaft: "",
    loft: "",
    estimatedPrice: "",
    notes: "",
    clubSpeed: "",
    ballSpeed: "",
    smashFactor: "",
    carryDistance: "",
    totalDistance: "",
    launchAngle: "",
    spinRate: "",
    dispersion: "",
  };
}

function emptyDemoClub(): DemoClubFields {
  return { isRecommended: false, demo: emptyClubTab(), current: emptyClubTab() };
}

// ── Sub-components ─────────────────────────────────────────────────────────────
function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 mb-5 pb-3 border-b border-slate-100">
      <span className="h-4 w-1 shrink-0 rounded-full bg-emerald-500" />
      <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-500 font-subheading">
        {children}
      </h2>
    </div>
  );
}

function Field({
  label,
  error,
  children,
  className,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col gap-1.5 ${className ?? ""}`}>
      <label className="text-sm font-medium text-slate-700 font-body">{label}</label>
      {children}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

const inputClass =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-colors duration-150 disabled:opacity-50 disabled:bg-slate-50 disabled:cursor-not-allowed font-body";

const sectionClass =
  "rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6";

// ── Success State ──────────────────────────────────────────────────────────────
function SuccessCard({
  lockerToken,
  demoSessionId,
  onReset,
}: {
  lockerToken: string;
  demoSessionId: number;
  onReset: () => void;
}) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(lockerToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex flex-col items-center gap-6 py-16 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50 ring-8 ring-emerald-50">
        <svg
          className="h-8 w-8 text-emerald-600"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M5 13l4 4L19 7"
          />
        </svg>
      </div>

      <div>
        <h2 className="text-2xl font-semibold text-slate-900 font-heading">
          Demo session saved!
        </h2>
        <p className="mt-1 text-sm text-slate-500 font-body">
          Session #{demoSessionId} has been created successfully.
        </p>
      </div>

      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-slate-50 p-5">
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3 font-subheading">
          Locker Token
        </p>
        <div className="flex items-center gap-2">
          <code className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-mono text-slate-800 break-all shadow-sm">
            {lockerToken}
          </code>
          <button
            type="button"
            onClick={handleCopy}
            className="shrink-0 rounded-lg bg-emerald-700 px-3 py-2.5 text-xs font-semibold text-white hover:bg-emerald-800 active:bg-emerald-900 transition-colors"
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
        <p className="mt-3 text-xs text-slate-400 font-body">
          Share this token with the client to access their swing locker.
        </p>
      </div>

      <button
        type="button"
        onClick={onReset}
        className="text-sm font-medium text-slate-500 underline underline-offset-4 hover:text-slate-900 transition-colors font-body"
      >
        Submit another session
      </button>
    </div>
  );
}

// ── Club Tab Panel ─────────────────────────────────────────────────────────────
function ClubTabPanel({
  hidden,
  reg,
  errors,
  isPending,
}: {
  hidden: boolean;
  reg: (sub: keyof ClubTabFields) => ReturnType<ReturnType<typeof useForm<FormFields>>["register"]>;
  errors?: ClubFieldErrors;
  isPending: boolean;
}) {
  return (
    <div className={hidden ? "hidden" : "p-5 sm:p-6 flex flex-col gap-5"}>
      {/* Club info */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Field label="Club Type" error={errors?.clubType?.message}>
          <input {...reg("clubType")} type="text" placeholder="Driver, Iron, Wedge…" className={inputClass} disabled={isPending} />
        </Field>
        <Field label="Brand" error={errors?.brand?.message}>
          <input {...reg("brand")} type="text" placeholder="TaylorMade" className={inputClass} disabled={isPending} />
        </Field>
        <Field label="Model" className="col-span-2 sm:col-span-1" error={errors?.model?.message}>
          <input {...reg("model")} type="text" placeholder="Qi10 Max" className={inputClass} disabled={isPending} />
        </Field>
        <Field label="Shaft" error={errors?.shaft?.message}>
          <input {...reg("shaft")} type="text" placeholder="Fujikura Ventus 6S" className={inputClass} disabled={isPending} />
        </Field>
        <Field label="Loft" error={errors?.loft?.message}>
          <input {...reg("loft")} type="text" placeholder="9°" className={inputClass} disabled={isPending} />
        </Field>
        <Field label="Est. Price ($)" error={errors?.estimatedPrice?.message}>
          <input {...reg("estimatedPrice")} type="number" step="0.01" min="0" placeholder="599.00" className={inputClass} disabled={isPending} />
        </Field>
      </div>

      {/* Swing Metrics */}
      <div>
        <div className="flex items-center gap-3 mb-4 pb-2 border-b border-slate-100">
          <span className="h-3 w-1 shrink-0 rounded-full bg-emerald-400" />
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 font-subheading">Swing Metrics</p>
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Field label="Club Speed (mph)"><input {...reg("clubSpeed")} type="number" step="0.1" min="0" placeholder="105.0" className={inputClass} disabled={isPending} /></Field>
          <Field label="Ball Speed (mph)"><input {...reg("ballSpeed")} type="number" step="0.1" min="0" placeholder="155.0" className={inputClass} disabled={isPending} /></Field>
          <Field label="Smash Factor"><input {...reg("smashFactor")} type="number" step="0.01" min="0" placeholder="1.47" className={inputClass} disabled={isPending} /></Field>
          <Field label="Carry (yds)"><input {...reg("carryDistance")} type="number" step="0.1" min="0" placeholder="265.0" className={inputClass} disabled={isPending} /></Field>
          <Field label="Total (yds)"><input {...reg("totalDistance")} type="number" step="0.1" min="0" placeholder="285.0" className={inputClass} disabled={isPending} /></Field>
          <Field label="Launch Angle (°)"><input {...reg("launchAngle")} type="number" step="0.1" min="0" placeholder="12.5" className={inputClass} disabled={isPending} /></Field>
          <Field label="Spin Rate (rpm)"><input {...reg("spinRate")} type="number" step="1" min="0" placeholder="2500" className={inputClass} disabled={isPending} /></Field>
          <Field label="Dispersion (yds)"><input {...reg("dispersion")} type="number" step="0.1" min="0" placeholder="18.0" className={inputClass} disabled={isPending} /></Field>
        </div>
      </div>

      {/* Club Notes */}
      <Field label="Club Notes">
        <textarea
          {...reg("notes")}
          rows={2}
          placeholder="Observations for this club…"
          onInput={autoExpand}
          style={{ resize: "none" }}
          className={`${inputClass} overflow-hidden`}
          disabled={isPending}
        />
      </Field>
    </div>
  );
}

// ── Demo Club Card ─────────────────────────────────────────────────────────────
function DemoClubCard({
  index,
  total,
  register,
  pairErrors,
  onRemove,
  isPending,
}: {
  index: number;
  total: number;
  register: ReturnType<typeof useForm<FormFields>>["register"];
  pairErrors?: { demo?: ClubFieldErrors; current?: ClubFieldErrors };
  onRemove: () => void;
  isPending: boolean;
}) {
  const [activeTab, setActiveTab] = useState<"demo" | "current">("demo");

  const hasDemoErrors = pairErrors?.demo
    ? Object.values(pairErrors.demo).some(Boolean)
    : false;
  const hasCurrentErrors = pairErrors?.current
    ? Object.values(pairErrors.current).some(Boolean)
    : false;

  // Shorthand register helpers — both panels stay in the DOM (CSS hidden)
  const dr = (sub: keyof ClubTabFields) =>
    register(`demoClubs.${index}.demo.${sub}` as any);
  const cr = (sub: keyof ClubTabFields) =>
    register(`demoClubs.${index}.current.${sub}` as any);

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      {/* Card header */}
      <div className="flex items-center justify-between px-5 py-3 bg-slate-50 border-b border-slate-200">
        {/* Segmented tab control */}
        <div className="flex rounded-lg overflow-hidden border border-slate-200 text-xs font-semibold">
          <button
            type="button"
            onClick={() => setActiveTab("demo")}
            className={`px-3 py-1.5 transition-colors ${
              activeTab === "demo"
                ? "bg-emerald-700 text-white"
                : "bg-white text-slate-600 hover:bg-slate-100"
            }`}
          >
            Demo Club
            {hasDemoErrors && activeTab !== "demo" && (
              <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-red-500 align-middle" />
            )}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("current")}
            className={`px-3 py-1.5 border-l border-slate-200 transition-colors ${
              activeTab === "current"
                ? "bg-slate-600 text-white"
                : "bg-white text-slate-600 hover:bg-slate-100"
            }`}
          >
            Current Club
            {hasCurrentErrors && activeTab !== "current" && (
              <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-red-500 align-middle" />
            )}
          </button>
        </div>

        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              {...register(`demoClubs.${index}.isRecommended` as any)}
              type="checkbox"
              disabled={isPending}
              className="h-4 w-4 rounded border-slate-300 accent-emerald-600 focus:ring-emerald-500 cursor-pointer"
            />
            <span className="text-xs font-semibold text-emerald-700 font-body">Recommended</span>
          </label>
          {total > 1 && (
            <button
              type="button"
              onClick={onRemove}
              disabled={isPending}
              title="Remove this club"
              className="flex h-7 w-7 items-center justify-center rounded-full text-slate-400 hover:bg-red-50 hover:text-red-500 disabled:opacity-40 transition-colors"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Both tab panels always in DOM — CSS hidden preserves form values */}
      <ClubTabPanel hidden={activeTab !== "demo"}    reg={dr} errors={pairErrors?.demo}    isPending={isPending} />
      <ClubTabPanel hidden={activeTab !== "current"} reg={cr} errors={pairErrors?.current} isPending={isPending} />
    </div>
  );
}

// ── Main Form ──────────────────────────────────────────────────────────────────
export function DemoForm() {
  const [result, setResult] = useState<ActionResult | null>(null);
  const [isPending, startTransition] = useTransition();

  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors },
  } = useForm<FormFields>({
    resolver: zodResolver(demoFormSchema) as any,
    defaultValues: {
      demoDate: today(),
      demoClubs: [emptyDemoClub()],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: "demoClubs",
  });

  function onReset() {
    setResult(null);
    reset({ demoDate: today(), demoClubs: [emptyDemoClub()] });
  }

  const onSubmit = handleSubmit((data) => {
    startTransition(async () => {
      const res = await createDemoSession(data);
      setResult(res);
    });
  });

  if (result?.success) {
    return (
      <SuccessCard
        lockerToken={result.lockerToken}
        demoSessionId={result.demoSessionId}
        onReset={onReset}
      />
    );
  }

  const serverErrors = result && !result.success ? result.errors ?? {} : {};

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      {/* Global error */}
      {result && !result.success && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 font-body">
          {result.message}
        </div>
      )}

      {/* ── Section 1: Client ─────────────────────────────────────────────── */}
      <section className={sectionClass}>
        <SectionHeading>Client Information</SectionHeading>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="First Name" error={errors.firstName?.message ?? serverErrors.firstName?.[0]}>
            <input
              {...register("firstName")}
              type="text"
              placeholder="Jake"
              className={inputClass}
              disabled={isPending}
            />
          </Field>
          <Field label="Last Name" error={errors.lastName?.message ?? serverErrors.lastName?.[0]}>
            <input
              {...register("lastName")}
              type="text"
              placeholder="Smith"
              className={inputClass}
              disabled={isPending}
            />
          </Field>
          <Field label="Email" error={errors.email?.message ?? serverErrors.email?.[0]}>
            <input
              {...register("email")}
              type="email"
              placeholder="jake@example.com"
              className={inputClass}
              disabled={isPending}
            />
          </Field>
          <Field label="Phone" error={errors.phone?.message ?? serverErrors.phone?.[0]}>
            <Controller
              name="phone"
              control={control}
              defaultValue=""
              render={({ field }) => (
                <input
                  {...field}
                  type="tel"
                  inputMode="numeric"
                  placeholder="(555) 000-0000"
                  className={inputClass}
                  disabled={isPending}
                  onChange={(e) => field.onChange(formatPhone(e.target.value))}
                />
              )}
            />
          </Field>
        </div>
      </section>

      {/* ── Section 2: Demo Session ───────────────────────────────────────── */}
      <section className={sectionClass}>
        <SectionHeading>Demo Session Details</SectionHeading>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Sales Rep" error={errors.salesRep?.message ?? serverErrors.salesRep?.[0]}>
            <input
              {...register("salesRep")}
              type="text"
              placeholder="Rep name"
              className={inputClass}
              disabled={isPending}
            />
          </Field>
          <Field label="Demo Date" error={errors.demoDate?.message ?? serverErrors.demoDate?.[0]}>
            <input
              {...register("demoDate")}
              type="date"
              className={inputClass}
              disabled={isPending}
            />
          </Field>
          <Field label="Client Goal" error={serverErrors.clientGoal?.[0]}>
            <input
              {...register("clientGoal")}
              type="text"
              placeholder="e.g. More distance, better accuracy"
              className={inputClass}
              disabled={isPending}
            />
          </Field>
        </div>
      </section>

      {/* ── Section 3: Demo Clubs ──────────────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-3 px-1">
          <span className="h-4 w-1 shrink-0 rounded-full bg-emerald-500" />
          <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-500 font-subheading">
            Demo Clubs
          </h2>
          <span className="ml-auto text-xs text-slate-400 font-body">
            {fields.length} club{fields.length !== 1 ? "s" : ""}
          </span>
        </div>

        {fields.map((field, index) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const clubErrs = (errors.demoClubs as any)?.[index];
          return (
            <DemoClubCard
              key={field.id}
              index={index}
              total={fields.length}
              register={register}
              pairErrors={{
                demo:    clubErrs?.demo    as ClubFieldErrors | undefined,
                current: clubErrs?.current as ClubFieldErrors | undefined,
              }}
              onRemove={() => remove(index)}
              isPending={isPending}
            />
          );
        })}

        <button
          type="button"
          disabled={isPending || fields.length >= 10}
          onClick={() => append(emptyDemoClub())}
          className="flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-200 px-5 py-4 text-sm font-medium text-slate-500 hover:border-emerald-400 hover:text-emerald-700 hover:bg-emerald-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Add Another Demo Club
        </button>
      </section>

      {/* ── Section 4: Session Notes ──────────────────────────────────────── */}
      <section className={sectionClass}>
        <SectionHeading>Session Notes</SectionHeading>
        <Field label="Notes" error={serverErrors.notes?.[0]}>
          <textarea
            {...register("notes")}
            rows={3}
            placeholder="Any additional observations, follow-up items, or client feedback…"
            onInput={autoExpand}
            style={{ resize: "none" }}
            className={`${inputClass} overflow-hidden`}
            disabled={isPending}
          />
        </Field>
      </section>

      {/* ── Submit ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-end gap-3 pt-2">
        <button
          type="button"
          onClick={onReset}
          disabled={isPending}
          className="rounded-lg px-4 py-2.5 text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 disabled:opacity-50 transition-colors"
        >
          Clear form
        </button>
        <button
          type="submit"
          disabled={isPending}
          className="rounded-lg bg-emerald-700 px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-800 active:bg-emerald-900 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isPending ? "Saving…" : "Save Demo Session"}
        </button>
      </div>
    </form>
  );
}