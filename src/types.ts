export type Operator = { id: string; displayName: string; isActive: boolean };
export type Me = Operator & { roles: string[]; permissions: string[] };
export type RequestStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
export type QueueItem = {
  id: string;
  referenceNumber: string;
  category: string;
  subject: string;
  status: RequestStatus;
  priority: 'HIGH' | 'NORMAL';
  waitingOn: 'CUSTOMER' | 'CENTER' | 'INTERNAL' | null;
  version: number;
  needsReply: boolean;
  customer: { displayName: string | null; phone: string | null } | null;
  assignee: Operator | null;
  createdAt: string;
  lastActivityAt: string;
  firstResponseAt: string | null;
  lastCustomerMessageAt: string;
  lastPublicReplyAt: string | null;
};
export type Detail = QueueItem & {
  message: string;
  preferredChannel: string | null;
  resolutionCode: string | null;
  resolutionSummary: string | null;
  closureSummary: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  legacyResolutionUnknown: boolean;
  customer:
    | (NonNullable<QueueItem['customer']> & {
        email: string | null;
        preferredChannel: string;
        whatsappConsent: boolean;
        emailConsent: boolean;
      })
    | null;
  linkedContext: {
    state: 'AVAILABLE' | 'NONE' | 'NEEDS_REVIEW';
    booking: {
      reference: string;
      status: string;
      centerName: string;
      vehicleLabel: string;
      registration: string;
      slotStart: string;
      estimateInr: string;
    } | null;
    job: {
      reference: string | null;
      status: string;
      centerName: string;
      vehicleLabel: string | null;
      registration: string;
      currentAmountInr: string;
      finalAmountInr: string | null;
      invoice: { reference: string; totalInr: string; paidInr: string; status: string } | null;
    } | null;
  };
};
export type SupportEvent = {
  id: string;
  version: number;
  type: string;
  visibility: 'PUBLIC' | 'INTERNAL';
  body: string | null;
  author: string;
  changes: Record<string, { before: unknown; after: unknown }> | null;
  createdAt: string;
};
export type Page<T> = { items: T[]; nextCursor: string | null };
export type History = { items: SupportEvent[]; nextBeforeVersion: number | null };
export type Summary = {
  active: number;
  unassigned: number;
  mine: number;
  needsReply: number;
  resolved: number;
  closed: number;
  inactiveAssignee: number;
};
export type Command =
  | 'claim'
  | 'assign'
  | 'release'
  | 'notes'
  | 'replies'
  | 'wait'
  | 'priority'
  | 'resolve'
  | 'close'
  | 'reopen';
export type CommandBody = Record<string, string | boolean | null>;
export type Receipt = {
  requestId: string;
  version: number;
  status: RequestStatus;
  eventId: string;
};
