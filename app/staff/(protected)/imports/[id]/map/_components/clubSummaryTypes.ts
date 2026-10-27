export interface SerializedClubSummary {
  id: number;
  importBatchId: number;
  originalClubName: string | null;
  clubName: string;
  /** Tags for this Club+Tags group. Empty array when no tags. */
  tags: string[];
  shotCount: number;
  avgClubSpeed: number | null;
  avgBallSpeed: number | null;
  avgSpinRate: number | null;
  avgMaxHeight: number | null;
  avgCarry: number | null;
  avgTotal: number | null;
  validClubSpeedCount: number;
  validBallSpeedCount: number;
  validSpinRateCount: number;
  validMaxHeightCount: number;
  validCarryCount: number;
  validTotalCount: number;
  isManuallyEdited: boolean;
  includeInReport: boolean;
  /** Optional price entered during review; copied into DemoClubTest on finalization. */
  estimatedPrice: number | null;
  /** Current summary ID when this summary is a Test in a comparison group. */
  currentSummaryId: number | null;
}
