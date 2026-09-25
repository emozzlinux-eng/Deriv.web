# DUPLICATE TRADE PROTECTION

Every execution request must contain:

```text
request_id
```

Before execution:

Check if request has already been processed.

If yes:

Do not execute again.

This protects against:

Double clicks
Network retries
WebSocket retries
Browser refreshes
Replay requests

---
