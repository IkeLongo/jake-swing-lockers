"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

const ACCEPTED = ".csv,.xlsx,.xls";

type UploadState =
  | { phase: "idle" }
  | { phase: "uploading" }
  | { phase: "error"; message: string };

export default function UploadForm() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [state, setState] = useState<UploadState>({ phase: "idle" });
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    setState({ phase: "idle" });
    setSelectedFile(e.target.files?.[0] ?? null);
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
        // TrackMan imports have club summaries generated during upload —
        // redirect directly to the club averages review page.
        const redirectPath =
          data.parserMode === "trackman-result"
            ? `/staff/imports/${data.batchId}/map`
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

  return (
    <form onSubmit={handleSubmit} noValidate>
      {/* ── Drop zone / file input ───────────────────────────────────────── */}
      <div
        className={`relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-8 py-12 text-center transition-colors ${
          selectedFile
            ? "border-emerald-400 bg-emerald-50"
            : "border-slate-300 bg-white hover:border-slate-400"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED}
          className="absolute inset-0 cursor-pointer opacity-0"
          onChange={handleFileChange}
          disabled={isUploading}
          aria-label="Select CSV or XLSX file"
        />

        <div className="pointer-events-none">
          <div className="mb-3 text-4xl">{selectedFile ? "📄" : "📂"}</div>

          {selectedFile ? (
            <>
              <p className="text-sm font-semibold text-emerald-800 font-body break-all">
                {selectedFile.name}
              </p>
              <p className="mt-1 text-xs text-emerald-600 font-body">
                {(selectedFile.size / 1024).toFixed(1)} KB — click to change
              </p>
            </>
          ) : (
            <>
              <p className="text-sm font-semibold text-slate-700 font-body">
                Click to select a file
              </p>
              <p className="mt-1 text-xs text-slate-400 font-body">
                Accepts .csv and .xlsx — up to 10 MB
              </p>
            </>
          )}
        </div>
      </div>

      {/* ── Error message ────────────────────────────────────────────────── */}
      {state.phase === "error" && (
        <div className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 font-body">
          {state.message}
        </div>
      )}

      {/* ── Actions ──────────────────────────────────────────────────────── */}
      <div className="mt-6 flex items-center justify-between gap-4">
        <button
          type="button"
          onClick={() => router.push("/staff/imports")}
          disabled={isUploading}
          className="text-sm font-medium text-slate-500 hover:text-slate-700 hover:underline disabled:cursor-not-allowed disabled:opacity-40 font-body"
        >
          Cancel
        </button>

        <button
          type="submit"
          disabled={isUploading || !selectedFile}
          className="rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-xs hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-emerald-400 transition-colors font-body"
        >
          {isUploading ? "Uploading…" : "Upload and parse"}
        </button>
      </div>
    </form>
  );
}
