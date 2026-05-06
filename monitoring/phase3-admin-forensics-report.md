# Phase 3 Incident Forensics Report

## Scope
This report reconstructs the most likely path that produced the unauthorized admin account observed in the backend history and runtime artifacts.

## Evidence Collected

### Runtime auth log
Current backend auth logs show one admin login event and no preserved structured admin-creation event:
- [Backend/logs/auth.log](../logs/auth.log)

Observed events:
- `2026-05-04T18:56:29.826Z` admin login success for `azam@gmail.com` with user id `69f72699fb196d80e44fb2e2`
- `2026-05-04T18:58:29.526Z` customer login success for `9060557296` with user id `69f72721870c6683cdd0aa7b`

There is no accompanying runtime audit entry showing a canonical role-change event for the admin account in the preserved logs.

### Historical script-based admin creation paths
Two historical backend scripts explicitly created or upgraded admin users outside normal request flow:
- [Backend/scripts/create_admin.js](../scripts/create_admin.js) in history, showing a one-off upsert that sets `role: 'admin'` and can create or update an admin user directly
- [Backend/scripts/update-admin-role.js](../scripts/update-admin-role.js) in history, showing a direct `findOneAndUpdate` that sets `role: 'admin'`, `roles: ['admin']`, and `isActive: true`

These scripts have no request context, no actor identity, and no canonical audit trail. They are operator tools, not application routes.

### Historical multi-role app logic
The repository history also contained a multi-role era where users could hold multiple roles and delivery registration could add a role to an existing account:
- [Backend/src/models/User.js](../src/models/User.js)
- [Backend/src/controllers/delivery.controller.js](../src/controllers/delivery.controller.js)
- [Backend/src/controllers/user.controller.js](../src/controllers/user.controller.js)
- [Backend/src/middlewares/auth.js](../src/middlewares/auth.js)

The historical state allowed:
- `roles` arrays in the user model
- `addRole('delivery')` style mutation
- public registration / admin CRUD paths that were not structurally fail-closed

A later commit explicitly documents an earlier delivery-registration compromise and references the phone number `9060557296`:
- commit `f701ec0` states that an admin account was compromised when delivery registration used the admin's phone number with a different email

### Historical admin CRUD behavior
The admin user-create route historically used raw payload creation:
- `User.create(req.body)` in [Backend/src/controllers/user.controller.js](../src/controllers/user.controller.js)

That path could create users with whatever role was present in the payload during the multi-role era and before the later hardening.

### Public registration behavior
Public registration was later forced server-side to customer-only, and the historical diff shows that it originally accepted a role parameter before being forced closed:
- commit `7d34a27` changed registration to ignore client-supplied role and force `customer`

## Forensic Conclusion

### Most likely root cause class
The unauthorized admin was created through **manual/operator script-based admin creation or update**, not through the current hardened app routes.

### Why this conclusion fits the evidence
- The historical backend contains explicit one-off admin creation scripts that directly write `role: 'admin'` outside the request lifecycle.
- Those scripts lack audit context, actor attribution, and route metadata.
- Current logs preserve an admin login but do not preserve a corresponding audited creation event.
- The multi-role historical period also exposed raw privilege mutation paths, but the clearest direct creation mechanism in the evidence is the operator script path.

### Confidence
- Confidence: **medium-high**
- Remaining uncertainty: the repo does not include the original database record for the unauthorized admin, so the exact execution timestamp of the script cannot be recovered from workspace artifacts alone.

## Final Classification

**Classification:** manual DB/script insertion via operator tooling

**Evidence-backed answer:**
The unauthorized admin was created via the historical backend operator script path (`scripts/create_admin.js` / `scripts/update-admin-role.js`) or an equivalent manual database write, at an unknown exact time not preserved in the repo logs, caused by direct privileged writes outside the request lifecycle, and this is no longer possible through the hardened backend paths because Phase 2 now blocks and audits privilege-bearing writes.

## Current Status
This is a forensic attribution report only. No additional behavioral patching was performed in Phase 3.
