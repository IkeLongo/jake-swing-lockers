import Link from "next/link";
import { IconEye } from "@tabler/icons-react";

type Props = { sessionId: number; returnHref: string; primary?: boolean };

export default function PreviewLockerButton({ sessionId, returnHref, primary = false }: Props) {
  return (
    <Link
      href={`/staff/demo-sessions/${sessionId}/preview-locker?from=${encodeURIComponent(returnHref)}`}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-semibold shadow-xs transition-colors font-body focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
        primary
          ? "border-transparent bg-primary text-primary-foreground hover:bg-primary-hover"
          : "border-border bg-card text-foreground hover:bg-muted"
      }`}
    >
      <IconEye className="h-3.5 w-3.5 shrink-0" />
      Preview Locker
    </Link>
  );
}
