export type PipelineStage = "demo" | "locker-sent" | "engaged" | "considering";

export type PipelineStatusVariant = "default" | "info" | "success" | "warning";

export interface PipelineCustomer {
  id: string;
  clientId?: number | string;
  name: string;
  stage: PipelineStage;
  fittingType: string;
  product?: string;
  status: string;
  timeInStage?: string;
  statusVariant?: PipelineStatusVariant;

  contact?: {
    email?: string;
    phone?: string;
  };

  demo?: {
    id?: string | number;
    type: string;
    date: string;
    product?: string;
    status?: string;
    needsRefinalization?: boolean;
    viewUrl?: string;
  };

  swingLocker?: {
    id?: string | number;
    inviteStatus?: string;
    sentAt?: string;
    openedAt?: string;
    previewUrl?: string;
  };

  purchaseRequest?: {
    id: string | number;
    status: string;
    createdAt: string;
    viewUrl?: string;
  };
}

export interface PipelineStageConfig {
  id: PipelineStage;
  label: string;
}

export const ACTIVE_PIPELINE_STAGES: PipelineStageConfig[] = [
  { id: "demo", label: "Demo" },
  { id: "locker-sent", label: "Locker Sent" },
  { id: "engaged", label: "Engaged" },
  { id: "considering", label: "Considering" },
];
