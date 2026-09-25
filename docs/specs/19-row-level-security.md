# ROW LEVEL SECURITY

Enable RLS on all user-owned tables.

A user must only access their own data.

Example principle:

```text
auth.uid() = user_id
```

Never rely on frontend filtering.

Test RLS explicitly.

---
