-- CreateEnum
CREATE TYPE "WorkspaceType" AS ENUM ('OWNER', 'FIDUCIARY', 'OPERATOR', 'INTERNAL');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('WORKSPACE_ADMIN', 'MANAGER', 'FIDUCIARY', 'CLIENT_VIEWER', 'AGENT', 'LICENSED_PARTNER', 'VENDOR', 'AUDITOR');

-- CreateEnum
CREATE TYPE "ContactKind" AS ENUM ('OWNER', 'TENANT', 'AGENT', 'VENDOR', 'CONTRACTOR', 'CLIENT', 'PARTNER', 'BUILDING_MANAGEMENT', 'ACCOUNTANT', 'LAWYER', 'OTHER');

-- CreateEnum
CREATE TYPE "TenancyStatus" AS ENUM ('ACTIVE', 'RENEWAL_DUE', 'NOTICE_SERVED', 'NEGOTIATING', 'RENEWED', 'ENDING', 'DISPUTED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "RecordSource" AS ENUM ('OCR', 'EXCEL', 'MANUAL');

-- CreateEnum
CREATE TYPE "DeadlineKind" AS ENUM ('NOTICE_GATE', 'CONTRACT_EXPIRY', 'RENEWAL_DATE', 'CHEQUE_DUE', 'CHEQUE_FOLLOWUP', 'SERVICE_CHARGE_DUE', 'INSURANCE_EXPIRY', 'DOCUMENT_EXPIRY', 'APPROVAL_DUE', 'TENANT_RESPONSE_DUE', 'EJARI_RENEWAL', 'CUSTOM');

-- CreateEnum
CREATE TYPE "DeadlineStatus" AS ENUM ('OPEN', 'DONE', 'MISSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "Instrument" AS ENUM ('CHEQUE', 'TRANSFER', 'DDS');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('SCHEDULED', 'REQUESTED', 'RECEIVED', 'DEPOSITED', 'CLEARED', 'LATE', 'BOUNCED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ScopeType" AS ENUM ('WORKSPACE', 'CLIENT', 'PROPERTY', 'TENANCY', 'PAYMENT_ITEM', 'PROOF_REQUEST', 'MAINTENANCE_CASE', 'IMPORT_BATCH', 'REPORT', 'TASK');

-- CreateEnum
CREATE TYPE "DocumentKind" AS ENUM ('TENANCY_CONTRACT', 'EJARI_CERTIFICATE', 'TITLE_DEED', 'ID_DOCUMENT', 'CHEQUE_IMAGE', 'RECEIPT', 'BANK_CONFIRMATION', 'INVOICE', 'QUOTATION', 'MAINTENANCE_PHOTO', 'HANDOVER_REPORT', 'NOTICE', 'ACKNOWLEDGEMENT', 'APPROVAL', 'SERVICE_CHARGE_STATEMENT', 'POA_NOC', 'OTHER');

-- CreateEnum
CREATE TYPE "DocAccessAction" AS ENUM ('VIEWED', 'DOWNLOADED', 'UPLOADED', 'DELETED', 'EXPORTED', 'SHARED');

-- CreateEnum
CREATE TYPE "ExtractionStatus" AS ENUM ('PENDING', 'EXTRACTED', 'REVIEWING', 'COMMITTED', 'REJECTED', 'FAILED');

-- CreateEnum
CREATE TYPE "ImportSource" AS ENUM ('EXCEL', 'DOCUMENTS');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('UPLOADED', 'MAPPED', 'REVIEWING', 'COMMITTED', 'ROLLED_BACK');

-- CreateEnum
CREATE TYPE "ImportRowStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'CONFLICT');

-- CreateEnum
CREATE TYPE "ProofStatus" AS ENUM ('OPEN', 'SENT', 'WAITING_PROOF', 'SUBMITTED', 'APPROVED', 'REJECTED', 'OVERDUE', 'CLOSED');

-- CreateEnum
CREATE TYPE "LinkPurpose" AS ENUM ('PROOF_UPLOAD', 'DOCUMENT_SHARE', 'APPROVAL', 'TENANT_OFFER');

-- CreateEnum
CREATE TYPE "ConsentPurpose" AS ENUM ('PROCESSING', 'MESSAGING', 'DOCUMENT_STORAGE', 'LINK_INTERACTION');

-- CreateEnum
CREATE TYPE "ConsentSource" AS ENUM ('SECURE_LINK', 'WHATSAPP_OPTIN', 'FORM', 'CONTRACT');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'WAITING_PROOF', 'SUBMITTED', 'APPROVED', 'REJECTED', 'OVERDUE', 'CLOSED');

-- CreateEnum
CREATE TYPE "ApprovalDecision" AS ENUM ('APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "Channel" AS ENUM ('EMAIL', 'WHATSAPP', 'SMS', 'INAPP');

-- CreateEnum
CREATE TYPE "Direction" AS ENUM ('OUTBOUND', 'INBOUND');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'RECEIVED');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('USER', 'STAFF', 'SYSTEM', 'PARTNER', 'TENANT_LINK', 'VENDOR_LINK');

-- CreateEnum
CREATE TYPE "EvidenceType" AS ENUM ('DOCUMENT_UPLOADED', 'DOCUMENT_VIEWED', 'FIELD_EXTRACTED', 'FIELD_CONFIRMED', 'FIELD_CORRECTED', 'IMPORT_COMMITTED', 'IMPORT_ROLLED_BACK', 'REMINDER_SENT', 'MESSAGE_RECEIVED', 'WHATSAPP_DELIVERY_STATUS', 'TASK_ASSIGNED', 'TASK_COMPLETED', 'PROOF_REQUESTED', 'PROOF_UPLOADED', 'PROOF_APPROVED', 'PROOF_REJECTED', 'CHEQUE_DUE', 'CHEQUE_RECEIVED', 'CHEQUE_DEPOSITED', 'CHEQUE_CLEARED', 'CHEQUE_BOUNCED', 'MAINTENANCE_REPORTED', 'MAINTENANCE_QUOTE_UPLOADED', 'MAINTENANCE_APPROVED', 'MAINTENANCE_COMPLETED', 'TENANT_CONFIRMED', 'APPROVAL_REQUESTED', 'APPROVAL_GRANTED', 'APPROVAL_REJECTED', 'REPORT_GENERATED', 'REPORT_EXPORTED', 'EVIDENCE_PACK_EXPORTED', 'RENEWAL_ASSESSMENT_CREATED', 'INDEX_CAPTURED', 'NOTICE_GENERATED', 'NOTICE_APPROVED', 'NOTICE_SERVED', 'OFFER_PROPOSED', 'OFFER_COUNTERED', 'OFFER_ACCEPTED', 'TENANT_ACKNOWLEDGED', 'PARTNER_CASE_ASSIGNED', 'PARTNER_TASK_COMPLETED', 'CONSENT_GRANTED', 'CONSENT_REVOKED', 'RISK_FLAG_RAISED', 'RISK_FLAG_CLEARED');

-- CreateEnum
CREATE TYPE "RiskCode" AS ENUM ('MISSING_EJARI', 'MISSING_END_DATE', 'CHEQUE_TOTAL_MISMATCH', 'NOTICE_GATE_WITHIN_30D', 'PROOF_OVERDUE', 'AGENT_UNRESPONSIVE', 'PAYMENT_LATE', 'INVOICE_WITHOUT_QUOTE', 'MAINTENANCE_DONE_WITHOUT_TENANT_CONFIRMATION', 'DOCUMENT_EXPIRED', 'APPROVAL_PENDING_TOO_LONG', 'TENANCY_OVERLAP');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('INFO', 'WARN', 'CRITICAL');

-- CreateEnum
CREATE TYPE "RaisedBy" AS ENUM ('RULE', 'AGENT_PROPOSED', 'STAFF');

-- CreateEnum
CREATE TYPE "FlagStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'CLEARED');

-- CreateEnum
CREATE TYPE "MaintStatus" AS ENUM ('REPORTED', 'ASSIGNED', 'QUOTE_REQUESTED', 'QUOTE_RECEIVED', 'AWAITING_APPROVAL', 'APPROVED', 'SCHEDULED', 'COMPLETED', 'TENANT_CONFIRMED', 'CLOSED', 'DISPUTED');

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "WorkspaceType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "name" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "isStaff" BOOLEAN NOT NULL DEFAULT false,
    "waOptInAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "clientPrincipalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientPrincipal" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "contactInfo" JSONB,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "ClientPrincipal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" "ContactKind" NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "company" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Property" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "clientPrincipalId" TEXT,
    "community" TEXT NOT NULL,
    "building" TEXT,
    "unitNo" TEXT,
    "emirate" TEXT NOT NULL DEFAULT 'Dubai',
    "propertyType" TEXT,
    "bedrooms" INTEGER,
    "sizeSqft" INTEGER,
    "assignedAgentId" TEXT,
    "serviceChargeInfo" JSONB,
    "riskStatus" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "Property_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tenancy" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "landlordContactId" TEXT,
    "tenantContactId" TEXT,
    "ejariNo" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "annualRent" DECIMAL(12,2) NOT NULL,
    "depositAmount" DECIMAL(12,2),
    "paymentTermsNote" TEXT,
    "noticePeriodDays" INTEGER NOT NULL DEFAULT 90,
    "noticeGateAt" TIMESTAMP(3),
    "status" "TenancyStatus" NOT NULL DEFAULT 'ACTIVE',
    "source" "RecordSource" NOT NULL DEFAULT 'MANUAL',
    "contractDocId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "Tenancy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deadline" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "tenancyId" TEXT,
    "propertyId" TEXT,
    "kind" "DeadlineKind" NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" "DeadlineStatus" NOT NULL DEFAULT 'OPEN',
    "computedFrom" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Deadline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentItem" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "tenancyId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "instrument" "Instrument" NOT NULL DEFAULT 'CHEQUE',
    "chequeNo" TEXT,
    "bank" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'SCHEDULED',
    "proofDocId" TEXT,
    "confirmedById" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "scopeType" "ScopeType" NOT NULL,
    "scopeId" TEXT,
    "kind" "DocumentKind" NOT NULL,
    "fileName" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "uploadedById" TEXT,
    "secureLinkId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentAccessLog" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "secureLinkId" TEXT,
    "partnerOrgId" TEXT,
    "action" "DocAccessAction" NOT NULL,
    "ip" TEXT,
    "device" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentAccessLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtractionJob" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "status" "ExtractionStatus" NOT NULL DEFAULT 'PENDING',
    "model" TEXT,
    "rawOutput" JSONB,
    "confidence" JSONB,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "importBatchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExtractionJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "source" "ImportSource" NOT NULL,
    "fileDocId" TEXT,
    "mappingJson" JSONB,
    "status" "ImportStatus" NOT NULL DEFAULT 'UPLOADED',
    "reviewerId" TEXT,
    "committedAt" TIMESTAMP(3),
    "rolledBackAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportRow" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "rawJson" JSONB NOT NULL,
    "mappedJson" JSONB,
    "status" "ImportRowStatus" NOT NULL DEFAULT 'PENDING',
    "conflictReason" TEXT,
    "createdRecordRefs" JSONB,

    CONSTRAINT "ImportRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProofRequest" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "scopeType" "ScopeType" NOT NULL,
    "scopeId" TEXT,
    "title" TEXT NOT NULL,
    "requiredEvidence" TEXT NOT NULL,
    "assignedContactId" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3),
    "status" "ProofStatus" NOT NULL DEFAULT 'OPEN',
    "decisionById" TEXT,
    "decisionAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProofRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecureLink" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "purpose" "LinkPurpose" NOT NULL,
    "scopeType" "ScopeType" NOT NULL,
    "scopeId" TEXT NOT NULL,
    "contactId" TEXT,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "maxUses" INTEGER,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "revokedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecureLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentRecord" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "purpose" "ConsentPurpose" NOT NULL,
    "source" "ConsentSource" NOT NULL,
    "noticeVersion" TEXT NOT NULL,
    "secureLinkId" TEXT,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "scopeType" "ScopeType" NOT NULL,
    "scopeId" TEXT,
    "title" TEXT NOT NULL,
    "assigneeUserId" TEXT,
    "assigneeContactId" TEXT,
    "dueAt" TIMESTAMP(3),
    "priority" INTEGER NOT NULL DEFAULT 0,
    "status" "TaskStatus" NOT NULL DEFAULT 'OPEN',
    "proofDocId" TEXT,
    "workflowInstanceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowInstance" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "templateCode" TEXT NOT NULL,
    "templateVersion" INTEGER NOT NULL,
    "scopeType" "ScopeType" NOT NULL,
    "scopeId" TEXT NOT NULL,
    "state" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Approval" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "requestedOfUserId" TEXT,
    "requestedOfContactId" TEXT,
    "payloadHash" TEXT NOT NULL,
    "channel" "Channel",
    "decision" "ApprovalDecision",
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Approval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationMessage" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "direction" "Direction" NOT NULL,
    "toUserId" TEXT,
    "toContactId" TEXT,
    "templateCode" TEXT,
    "subject" TEXT,
    "bodyRef" TEXT,
    "providerRef" TEXT,
    "status" "MessageStatus" NOT NULL DEFAULT 'QUEUED',
    "relatedType" "ScopeType",
    "relatedId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Outbox" (
    "id" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceEvent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "type" "EvidenceType" NOT NULL,
    "actorType" "ActorType" NOT NULL,
    "actorId" TEXT,
    "onBehalfOfId" TEXT,
    "scopeType" "ScopeType" NOT NULL,
    "scopeId" TEXT,
    "propertyId" TEXT,
    "tenancyId" TEXT,
    "payload" JSONB,
    "payloadHash" TEXT,
    "supersedesId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT,
    "actorType" "ActorType" NOT NULL,
    "actorId" TEXT,
    "onBehalfOfId" TEXT,
    "verb" TEXT NOT NULL,
    "objectType" TEXT NOT NULL,
    "objectId" TEXT,
    "payloadHash" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskFlag" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "scopeType" "ScopeType" NOT NULL,
    "scopeId" TEXT NOT NULL,
    "code" "RiskCode" NOT NULL,
    "severity" "Severity" NOT NULL,
    "raisedBy" "RaisedBy" NOT NULL,
    "ruleVersion" TEXT,
    "status" "FlagStatus" NOT NULL DEFAULT 'OPEN',
    "raisedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clearedAt" TIMESTAMP(3),
    "clearedById" TEXT,

    CONSTRAINT "RiskFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "features" JSONB NOT NULL,
    "limits" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "period" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3),

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceEntitlement" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "featureKey" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'plan',

    CONSTRAINT "WorkspaceEntitlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageCounter" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "UsageCounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingEvent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" DECIMAL(12,2),
    "currency" TEXT NOT NULL DEFAULT 'AED',
    "stripeRef" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintenanceCase" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "tenantContactId" TEXT,
    "category" TEXT,
    "description" TEXT,
    "status" "MaintStatus" NOT NULL DEFAULT 'REPORTED',
    "assignedContactId" TEXT,
    "approvalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "MaintenanceCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "vendorContactId" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "documentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "caseId" TEXT,
    "vendorContactId" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "quoteId" TEXT,
    "documentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "clientPrincipalId" TEXT,
    "params" JSONB,
    "documentId" TEXT,
    "generatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthOtp" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthOtp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "ip" TEXT,
    "device" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Workspace_type_idx" ON "Workspace"("type");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- CreateIndex
CREATE INDEX "Membership_workspaceId_idx" ON "Membership"("workspaceId");

-- CreateIndex
CREATE INDEX "Membership_userId_idx" ON "Membership"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_workspaceId_userId_role_key" ON "Membership"("workspaceId", "userId", "role");

-- CreateIndex
CREATE INDEX "ClientPrincipal_workspaceId_idx" ON "ClientPrincipal"("workspaceId");

-- CreateIndex
CREATE INDEX "Contact_workspaceId_kind_idx" ON "Contact"("workspaceId", "kind");

-- CreateIndex
CREATE INDEX "Property_workspaceId_clientPrincipalId_idx" ON "Property"("workspaceId", "clientPrincipalId");

-- CreateIndex
CREATE INDEX "Tenancy_workspaceId_propertyId_idx" ON "Tenancy"("workspaceId", "propertyId");

-- CreateIndex
CREATE INDEX "Tenancy_workspaceId_endDate_idx" ON "Tenancy"("workspaceId", "endDate");

-- CreateIndex
CREATE INDEX "Deadline_workspaceId_dueAt_idx" ON "Deadline"("workspaceId", "dueAt");

-- CreateIndex
CREATE INDEX "Deadline_workspaceId_status_kind_idx" ON "Deadline"("workspaceId", "status", "kind");

-- CreateIndex
CREATE INDEX "PaymentItem_workspaceId_dueDate_idx" ON "PaymentItem"("workspaceId", "dueDate");

-- CreateIndex
CREATE INDEX "PaymentItem_workspaceId_status_idx" ON "PaymentItem"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentItem_tenancyId_seq_key" ON "PaymentItem"("tenancyId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "Document_storageKey_key" ON "Document"("storageKey");

-- CreateIndex
CREATE INDEX "Document_workspaceId_scopeType_scopeId_idx" ON "Document"("workspaceId", "scopeType", "scopeId");

-- CreateIndex
CREATE INDEX "Document_sha256_idx" ON "Document"("sha256");

-- CreateIndex
CREATE INDEX "DocumentAccessLog_workspaceId_documentId_idx" ON "DocumentAccessLog"("workspaceId", "documentId");

-- CreateIndex
CREATE INDEX "DocumentAccessLog_documentId_createdAt_idx" ON "DocumentAccessLog"("documentId", "createdAt");

-- CreateIndex
CREATE INDEX "ExtractionJob_workspaceId_status_idx" ON "ExtractionJob"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "ImportBatch_workspaceId_status_idx" ON "ImportBatch"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "ImportRow_batchId_status_idx" ON "ImportRow"("batchId", "status");

-- CreateIndex
CREATE INDEX "ProofRequest_workspaceId_status_idx" ON "ProofRequest"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "ProofRequest_workspaceId_assignedContactId_idx" ON "ProofRequest"("workspaceId", "assignedContactId");

-- CreateIndex
CREATE UNIQUE INDEX "SecureLink_tokenHash_key" ON "SecureLink"("tokenHash");

-- CreateIndex
CREATE INDEX "SecureLink_workspaceId_purpose_idx" ON "SecureLink"("workspaceId", "purpose");

-- CreateIndex
CREATE INDEX "ConsentRecord_workspaceId_contactId_idx" ON "ConsentRecord"("workspaceId", "contactId");

-- CreateIndex
CREATE INDEX "Task_workspaceId_status_idx" ON "Task"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "WorkflowInstance_workspaceId_templateCode_idx" ON "WorkflowInstance"("workspaceId", "templateCode");

-- CreateIndex
CREATE INDEX "Approval_workspaceId_subjectType_subjectId_idx" ON "Approval"("workspaceId", "subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "NotificationMessage_workspaceId_channel_createdAt_idx" ON "NotificationMessage"("workspaceId", "channel", "createdAt");

-- CreateIndex
CREATE INDEX "Outbox_status_availableAt_idx" ON "Outbox"("status", "availableAt");

-- CreateIndex
CREATE INDEX "EvidenceEvent_workspaceId_createdAt_idx" ON "EvidenceEvent"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "EvidenceEvent_workspaceId_scopeType_scopeId_idx" ON "EvidenceEvent"("workspaceId", "scopeType", "scopeId");

-- CreateIndex
CREATE INDEX "EvidenceEvent_workspaceId_tenancyId_idx" ON "EvidenceEvent"("workspaceId", "tenancyId");

-- CreateIndex
CREATE INDEX "AuditEvent_workspaceId_createdAt_idx" ON "AuditEvent"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "RiskFlag_workspaceId_status_idx" ON "RiskFlag"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RiskFlag_workspaceId_scopeType_scopeId_code_status_key" ON "RiskFlag"("workspaceId", "scopeType", "scopeId", "code", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Plan_code_key" ON "Plan"("code");

-- CreateIndex
CREATE INDEX "Subscription_workspaceId_idx" ON "Subscription"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceEntitlement_workspaceId_featureKey_key" ON "WorkspaceEntitlement"("workspaceId", "featureKey");

-- CreateIndex
CREATE UNIQUE INDEX "UsageCounter_workspaceId_metric_period_key" ON "UsageCounter"("workspaceId", "metric", "period");

-- CreateIndex
CREATE INDEX "BillingEvent_workspaceId_idx" ON "BillingEvent"("workspaceId");

-- CreateIndex
CREATE INDEX "MaintenanceCase_workspaceId_status_idx" ON "MaintenanceCase"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "Quote_workspaceId_caseId_idx" ON "Quote"("workspaceId", "caseId");

-- CreateIndex
CREATE INDEX "Invoice_workspaceId_caseId_idx" ON "Invoice"("workspaceId", "caseId");

-- CreateIndex
CREATE INDEX "Report_workspaceId_clientPrincipalId_idx" ON "Report"("workspaceId", "clientPrincipalId");

-- CreateIndex
CREATE INDEX "AuthOtp_email_expiresAt_idx" ON "AuthOtp"("email", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tenancy" ADD CONSTRAINT "Tenancy_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deadline" ADD CONSTRAINT "Deadline_tenancyId_fkey" FOREIGN KEY ("tenancyId") REFERENCES "Tenancy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentItem" ADD CONSTRAINT "PaymentItem_tenancyId_fkey" FOREIGN KEY ("tenancyId") REFERENCES "Tenancy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRow" ADD CONSTRAINT "ImportRow_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImportBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
