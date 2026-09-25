# ENVIRONMENT VARIABLES

Use:

```text
.env.local
.env.example
```

Never commit real secrets.

Example:

```text
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=

SUPABASE_SERVICE_ROLE_KEY=

DERIV_APP_ID=
DERIV_API_URL=

ENCRYPTION_KEY=
```

Only variables genuinely safe for public exposure may use:

NEXT_PUBLIC_

Never expose:

SUPABASE_SERVICE_ROLE_KEY

or encryption keys.

---
