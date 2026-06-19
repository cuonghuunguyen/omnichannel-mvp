// Multi-tenancy: which tenant this chat deployment serves. Identification is
// static per deployment (one tenant per chat instance), resolved from env. Every
// conversation/user this service creates is scoped to ACTIVE_TENANT_ID, and it
// is sent to the AI Config API so agents/knowledge are resolved within the same
// tenant. The Tenant registry is duplicated in this service's DB (see
// prisma/schema.prisma) so no cross-service lookup is needed to validate it.
export const ACTIVE_TENANT_ID = process.env.TENANT_ID?.trim() || "default";
