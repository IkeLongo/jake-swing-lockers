import { createHash } from "crypto";
import type { ContactDiscovery } from "./discoverStagedContacts";

// A stable fingerprint of everything staff reviewed in a discovery result.
// Candidate names/emails/phones only feed the hash (they are never stored), so
// an edit to a GHL contact between review and approval changes the signature.
export function computeDiscoverySignature(discovery: ContactDiscovery): string {
  const payload = JSON.stringify({
    v: 1,
    saved: [discovery.savedLink.id, discovery.savedLink.status],
    searched: [discovery.searched.email, discovery.searched.phone],
    unsearchable: [...discovery.unsearchable].sort(),
    flags: Object.entries(discovery.flags).sort(([a], [b]) => a.localeCompare(b)),
    candidates: [...discovery.candidates]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((c) => [
        c.id,
        c.reasons,
        [...c.discrepancies].sort(),
        c.wrongLocation,
        c.locationVerified,
        c.linkedClients.map((l) => l.id).sort((a, b) => a - b),
        [c.firstName, c.lastName, c.email, c.phone],
      ]),
  });
  return createHash("sha256").update(payload).digest("hex");
}
