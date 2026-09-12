# The City Around You

Karachi civic intelligence hackathon MVP.

## Run locally or on Replit

```bash
npm run dev
```

The server listens on `0.0.0.0:5000`. The app uses only Node's built-in modules, so no package installation is required.

## Product scope

This prototype demonstrates the priority end-to-end flow:

1. Citizen describes an issue in natural language.
2. A deterministic Civic AI mock produces structured classification, authority routing, priority, sensitive-location and authenticity signals.
3. The citizen reviews and submits a generated complaint.
4. An authority can view, update and resolve the case.
5. A citizen can confirm or dispute resolution.
6. Admins can review seeded platform metrics, configurable authorities/rules and an audit history.

Seeded data is explicitly labeled as demo data. Authority handoff is simulated and does not contact a government system. The in-memory store resets when the server restarts.

## Demo roles

Use the role switcher in the top-right:

- Citizen: submit the compelling sewage-overflow scenario, inspect an incident cluster, and confirm/dispute a resolution.
- Authority: open the KW&SC command center, review the critical queue, update a case, and mark it resolved.
- Admin: inspect cross-authority metrics, routing/priority rules, people and the audit history.