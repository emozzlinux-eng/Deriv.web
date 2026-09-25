# CORE ARCHITECTURAL SEPARATION

This is mandatory.

Separate:

```text
MARKET DATA
     ↓
ANALYSIS
     ↓
SIGNAL
     ↓
RISK
     ↓
EXECUTION
```

These must be independent modules.

Never allow:

Frontend → Deriv

Instead:

Frontend
↓
Authenticated backend request
↓
Authorization
↓
Validation
↓
Risk Engine
↓
Execution Engine
↓
Deriv

---
