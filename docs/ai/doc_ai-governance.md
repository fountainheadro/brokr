# AI Governance & Quota Policy

## 1. Multi-Tenant AI Isolation
- Every AI operation is invoked through server-controlled workflows with an explicitly resolved `tenant_id`.
- Tenant-specific instructions (e.g. agency tone of voice, preferred contact wording) are merged with core domain rules (`AGENTS.md`) at runtime.
- AI operations have no direct database write permissions; they produce structured JSON conforming strictly to typed schemas.

## 2. Quota & Cost Tracking
- Prior to executing a Gemini API call, the `AiPolicyEngine` checks the tenant's current monthly token allowance against actual consumption.
- If quota is exceeded, a `QuotaExceededError` (HTTP 429) is returned, preventing unexpected billing overruns.
- Each invocation records:
  - `tenantId` & `userId`
  - `model` (e.g. `gemini-3.1-flash-lite`, `gemini-4-hydrogen`)
  - `inputTokens`, `outputTokens`, `totalTokens`
  - `estimatedCostEur`
  - `operationType`
