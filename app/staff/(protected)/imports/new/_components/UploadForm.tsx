"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  IconFileSpreadsheet,
  IconUpload,
  IconX,
} from "@tabler/icons-react";

const ACCEPTED = ".csv,.xlsx,.xls";

type UploadState =
  | { phase: "idle" }
  | { phase: "uploading" }
  | { phase: "error"; message: string };

interface Props {
  trackManOnly?: boolean;
}

export default function UploadForm({ trackManOnly = false }: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [state, setState] = useState<UploadState>({ phase: "idle" });
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);

  function selectFile(file: File | null) {
    setState({ phase: "idle" });
    setSelectedFile(file);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    selectFile(e.target.files?.[0] ?? null);
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragActive(false);
    if (isUploading) return;
    selectFile(e.dataTransfer.files?.[0] ?? null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!selectedFile) {
      setState({ phase: "error", message: "Please select a file to upload." });
      return;
    }

    setState({ phase: "uploading" });

    const formData = new FormData();
    formData.append("file", selectedFile);

    try {
      const res = await fetch("/api/staff/imports/upload", {
        method: "POST",
        body: formData,
      });

      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        batchId?: number;
        parserMode?: string;
        message?: string;
      };

      if (res.ok && data.success && data.batchId != null) {
        // TrackMan imports begin at customer resolution before fitting review.
        const redirectPath =
          data.parserMode === "trackman-result"
            ? `/staff/imports/${data.batchId}/customer`
            : `/staff/imports/${data.batchId}`;
        router.push(redirectPath);
        return;
      }

      setState({
        phase: "error",
        message: data.message ?? "Upload failed. Please try again.",
      });
    } catch {
      setState({
        phase: "error",
        message: "Network error. Please check your connection and try again.",
      });
    }
  }

  const isUploading = state.phase === "uploading";
  const acceptedTypes = trackManOnly ? ".xlsx,.xls" : ACCEPTED;
  const uploadLabel = trackManOnly ? "Upload TrackMan Session" : "Upload and parse";

  return (
    <form onSubmit={handleSubmit} noValidate className="rounded-xl border border-border bg-card p-4 shadow-xs sm:p-6">
      {/* ── Drop zone / file input ───────────────────────────────────────── */}
      <div
        onDragEnter={(e) => {
          e.preventDefault();
          if (!isUploading) setIsDragActive(true);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={(e) => {
          e.preventDefault();
          if (e.currentTarget.contains(e.relatedTarget as Node)) return;
          setIsDragActive(false);
        }}
        onDrop={handleDrop}
        className={`flex min-h-80 flex-col items-center justify-center rounded-lg border-2 border-dashed px-5 py-10 text-center transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary sm:px-10 ${
          isDragActive
            ? "border-primary bg-primary/5"
            : selectedFile
              ? "border-primary/40 bg-primary/5"
              : "border-border bg-background hover:border-primary/50 hover:bg-muted/40"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          id="trackman-upload"
          accept={acceptedTypes}
          className="sr-only"
          onChange={handleFileChange}
          disabled={isUploading}
          aria-label={trackManOnly ? "Select TrackMan XLSX file" : "Select CSV or XLSX file"}
        />

        <div className="flex max-w-sm flex-col items-center">
          <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary">
            {selectedFile ? (
              <IconFileSpreadsheet className="h-6 w-6" aria-hidden />
            ) : (
              <IconUpload className="h-6 w-6" aria-hidden />
            )}
          </div>

          {selectedFile ? (
            <>
              <p className="break-all text-sm font-semibold text-foreground font-heading">
                {selectedFile.name}
              </p>
              <p className="mt-1 text-xs text-muted-foreground font-body">
                {(selectedFile.size / 1024).toFixed(1)} KB selected
              </p>
              <label
                htmlFor="trackman-upload"
                className="mt-5 inline-flex cursor-pointer items-center rounded-lg border border-border bg-card px-3 py-2 text-sm font-semibold text-foreground shadow-xs transition-colors hover:bg-muted focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary font-body"
              >
                Choose a different file
              </label>
            </>
          ) : (
            <>
              <h2 className="text-base font-semibold text-foreground font-heading">
                Upload TrackMan Session
              </h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground font-body">
                Drag and drop your TrackMan file here, or browse files.
              </p>
              <label
                htmlFor="trackman-upload"
                className="mt-5 inline-flex cursor-pointer items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-xs transition-colors hover:bg-primary-hover focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary font-body"
              >
                <IconUpload className="h-4 w-4" aria-hidden />
                Browse files
              </label>
            </>
          )}

          <p className="mt-5 text-xs text-muted-foreground font-body">
            {trackManOnly ? "XLSX / XLS" : "CSV / XLSX / XLS"} · Max 10 MB
          </p>
        </div>
      </div>

      {/* ── Error message ────────────────────────────────────────────────── */}
      {state.phase === "error" && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400 font-body" role="alert">
          <IconX className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {state.message}
        </div>
      )}

      {/* ── Actions ──────────────────────────────────────────────────────── */}
      <div className={`mt-5 flex items-center gap-4 ${trackManOnly ? "justify-end" : "justify-between"}`}>
        {!trackManOnly && (
          <button
            type="button"
            onClick={() => router.push("/staff/imports")}
            disabled={isUploading}
            className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground hover:underline disabled:cursor-not-allowed disabled:opacity-40 font-body"
          >
            Cancel
          </button>
        )}

        <button
          type="submit"
          disabled={isUploading || !selectedFile}
          className="inline-flex min-w-48 items-center justify-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-xs transition-colors hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50 font-body"
        >
          <IconUpload className="h-4 w-4" aria-hidden />
          {isUploading ? "Uploading TrackMan Session…" : uploadLabel}
        </button>
      </div>
    </form>
  );
}
