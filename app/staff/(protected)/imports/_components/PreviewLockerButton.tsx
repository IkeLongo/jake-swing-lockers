import Link from "next/link";
import { IconEye } from "@tabler/icons-react";

type Props = { sessionId: number; returnHref: string };

export default function PreviewLockerButton({ sessionId, returnHref }: Props) {
  return (
    <Link
      href={`/staff/demo-sessions/${sessionId}/preview-locker?from=${encodeURIComponent(returnHref)}`}
      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-semibold text-foreground shadow-xs hover:bg-muted transition-colors font-body focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      <IconEye className="h-3.5 w-3.5 shrink-0" />
      Preview Locker
    </Link>
  );
}
