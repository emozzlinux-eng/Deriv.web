# DERIV CLIENT

Create a dedicated Deriv client.

Example:

```text
DerivClient

connect()
disconnect()
authenticate()
getAccount()
getBalance()
getActiveSymbols()
getContracts()
getTickHistory()
subscribeTicks()
unsubscribeTicks()
getProposal()
buy()
sell()
getOpenContract()
getPortfolio()
```

Do not allow random application components to call raw Deriv WebSocket commands.

---
