// Multi-tenancy: which tenant this API deployment serves. Identification is
// static per deployment (resolved from env). Admin routes (agents, knowledge)
// scope to ACTIVE_TENANT_ID; the /chat route scopes to the tenantId the chat
// service sends (which, in a single-tenant deployment, is the same value). The
// Tenant registry is duplicated in this service's DB so no cross-service lookup
// is needed.
export const ACTIVE_TENANT_ID = process.env.TENANT_ID?.trim() || "default";
