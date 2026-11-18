# Brokr. Multi-Tenant Real-Estate SaaS CRM (`Miner.AI`)

A professional, modular multi-tenant CRM platform built for real-estate agencies.

## Architecture

The project follows a consolidated modular monolith structure documented in `docs/design/doc_naming-conventions.md` and `docs/architecture/doc_architecture-overview.md`:

```text
├── design/      # Design tokens (single source of truth) & Atomic Design specifications (spec_*.md)
├── src/         # Frontend application: Atomic UI (src/ui/), multi-tenant core (src/core/), pages, and preserved CRM modules
├── server/      # Modular Express routers (rtr_*), middleware (mw_*), security guards (sec_*), AI voice & Gemini pipelines
├── ai/          # AI governance, domain prompt policies, and quota tracking
├── lib/         # Static reference data (geography, property taxonomy, formatting)
├── packages/    # Shared types, schemas, and contracts (pkg_*)
├── config/      # Platform and module dependency configurations
├── tests/       # Automated security, multi-tenancy, and cutover test suites (tst_*)
└── docs/        # Consolidated architectural, database, design, AI, tenancy, and production documentation
```

### Key Technical Foundations
- **Multi-Tenancy**: Hostname/subdomain-based tenant resolution, verified server-side claims, and isolated Firestore subcollections (`/tenants/{tenantId}/...`).
- **Design System**: Atomic Design hierarchy (`atm_`, `mol_`, `org_`, `tpl_`, `cmp_`, `pg_`) in `src/ui/` driven by a centralized token set (`design/tokens/`).
- **AI Engine**: Server-side Google Gemini via official `@google/genai` SDK (`gemini-4-hydrogen`, `gemini-3.1-flash-lite`, `gemini-3.8-live`) with strict tenant isolation, quota governance, and token usage accounting.
- **Image Processing**: Algorithmic watermark removal (inpainting with biharmonic illumination and texture transfer) supporting JPEG, PNG, and WebP via ImageMagick.
- **Modular Monolith**: Clean boundaries between platform administration (`/platform/*`), agency administration (`/agency/admin/*`), and agency CRM (`/`) without microservice overhead.

## Development

```bash
# Start development server
npm run dev

# Build for production
npm run build

# Type check
npm run lint

# Run security & architecture test suites
npm test
```
