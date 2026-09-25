# PAPER TRADING

Implement realistic paper execution.

Architecture:

```text
TradeEngine
    │
    ├── PaperExecutionAdapter
    ├── DemoExecutionAdapter
    └── RealExecutionAdapter
```

This lets the entire system be tested without real money.

---
