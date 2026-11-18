# Tenant Database Isolation & Firestore Architecture

## 1. Physical Firestore Partitioning

Tenant operational records are partitioned using subcollections scoped by `tenantId`:

```
/platform/{platformCollection}
/tenants/{tenantId}
   ├── users/{userId}               (Membership records)
   ├── staff/{staffId}              (Agency staff profiles)
   ├── leads/{leadId}               (Agency real estate leads)
   ├── contacts/{contactId}         (Agency client contacts)
   ├── properties/{propertyId}      (Agency property listings)
   ├── activities/{activityId}      (Scheduled viewings, calls, tasks)
   └── documents/{documentId}       (Contracts, deeds, attachments)
```

---

## 2. Zero-Trust Isolation Mechanisms

Multi-tenancy isolation is enforced at two independent layers:

### Layer A: Backend Repository & Middleware (`TenantScopedRepository`)
1. The repository constructs collection references exclusively via:
   `collection(firestore, "tenants", tenantId, collectionName)`
2. The `tenantId` parameter MUST originate from trusted backend `TenantContext`, never directly from client request bodies or URL parameters.
3. On create and update operations, `id`, `tenantId`, and `createdAt` fields are enforced as immutable. Any client payload attempting to inject a foreign `tenantId` or legacy `tenant_id` is overwritten or stripped.
4. When querying by ID (`findById`), queries targeting document IDs from other tenants return `null` rather than cross-tenant data.

### Layer B: Firestore Security Rules (`firestore.rules`)
1. Default-deny catch-all rule:
   `match /{document=**} { allow read, write: if false; }`
2. Subcollection rules check active membership:
   `isTenantMember(tenantId) && isTenantActive(tenantId) && getTenantMembership(tenantId).status == 'active'`
3. Prevention of self-escalation in rules:
   Users cannot modify their own member document `request.auth.uid != userId`.
4. Tenant status, ID, and plan ID cannot be modified by tenant admins.

---

## 3. Migration & Backward Compatibility Strategy

- **Legacy Collections Preserved**: Root collections (`/leads`, `/contacts`, `/personal`, `/documents`, `/activities`, `/tours`, `/viewings`) remain defined in `firestore.rules` and backend endpoints during the architectural transition.
- **Data Safety**: No existing data was deleted or altered destructively during Phase 3.
- **Future Tenant Migration Plan**: An administrative migration utility will duplicate legacy root records into the default agency tenant path (`/tenants/ten_brokr_default/...`) during Phase 4 without causing downtime.
