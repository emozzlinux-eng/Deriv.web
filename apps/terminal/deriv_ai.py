#!/usr/bin/env python3
"""
DERIV INTELLIGENCE — Terminal (spec §57)

Optional CLI using Rich. Commands:
    deriv-ai markets
    deriv-ai scan
    deriv-ai analyze VOL100 5m
    deriv-ai backtest
    deriv-ai risk
    deriv-ai emergency-stop

Data source: Deriv public WebSocket API (app_id based, market data only).
This terminal NEVER executes real trades (§92 — development is PAPER ONLY).
Requires: pip install rich websockets
"""
from __future__ import annotations

import argparse
import asyncio
import json
import math
import statistics
import sys
import urllib.request
import urllib.error
from datetime import datetime, timezone

try:
    from rich.console import Console
    from rich.table import Table
    from rich.panel import Panel
except ImportError:  # pragma: no cover
    print("rich is required: pip install rich", file=sys.stderr)
    raise SystemExit(2)

console = Console()

DERIV_APP_ID = "1089"  # public demo app id for market data only
TICKS_URL = f"https://ws.derivws.com/websockets/v3?app_id={DERIV_APP_ID}"
SYMBOLS_HISTORY_URL = "https://api.deriv.com/api/v1/timeseries"  # fallback not used; WS below


def ws_request(payload: dict, timeout: float = 10.0):
    """Single request/response over the Deriv v3 WebSocket (read-only calls)."""
    try:
        import websockets.sync.client as wsc
    except ImportError:
        console.print("[red]websockets is required: pip install websockets[/red]")
        raise SystemExit(2)

    with wsc.connect(TICKS_URL) as ws:
        ws.send(json.dumps({**payload, "req_id": 1}))
        deadline = timeout
        while True:
            try:
                msg = json.loads(ws.recv(timeout=deadline))
            except TimeoutError:
                raise RuntimeError("Deriv request timed out")
            if msg.get("req_id") == 1:
                if msg.get("error"):
                    raise RuntimeError(msg["error"]["message"])
                return msg


def cmd_markets(_args):
    msg = ws_request({"active_symbols": "brief", "product_type": "basic"})
    table = Table(title="Active Markets (Deriv)")
    table.add_column("Symbol"); table.add_column("Display name"); table.add_column("Type")
    for s in sorted(msg.get("active_symbols", []), key=lambda x: x["symbol"])[:60]:
        table.add_row(s["symbol"], s["display_name"], s.get("market_type", "-"))
    console.print(table)


def get_history(symbol: str, count: int, granularity: int) -> list[dict]:
    msg = ws_request({
        "ticks_history": symbol, "end": "latest", "count": count,
        "style": "candles", "granularity": granularity, "adjust_start_time": 1,
    })
    return msg.get("candles", [])


def ema(values, period):
    k = 2 / (period + 1)
    out, prev = [], None
    for i, v in enumerate(values):
        if i < period - 1:
            out.append(None); continue
        if prev is None:
            prev = sum(values[:period]) / period
        else:
            prev = v * k + prev * (1 - k)
        out.append(prev)
    return out


def rsi(values, period=14):
    gains = losses = 0.0
    for i in range(1, period + 1):
        d = values[i] - values[i - 1]
        gains += max(d, 0) / period
        losses += max(-d, 0) / period
    for i in range(period + 1, len(values)):
        d = values[i] - values[i - 1]
        gains = (gains * (period - 1) + max(d, 0)) / period
        losses = (losses * (period - 1) + max(-d, 0)) / period
    return 100.0 if losses == 0 else 100 - 100 / (1 + gains / losses)


GRANULARITY = {"1m": 60, "5m": 300, "15m": 900, "30m": 1800, "1h": 3600, "4h": 14400, "1D": 86400}


def analyze(symbol: str, tf: str) -> dict:
    candles = get_history(symbol, 120, GRANULARITY[tf])
    closes = [float(c["close"]) for c in candles]
    e9, e21, e50 = ema(closes, 9), ema(closes, 21), ema(closes, 50)
    r = rsi(closes)
    atrs = [abs(closes[i] - closes[i - 1]) for i in range(1, len(closes))]
    atr = statistics.mean(atrs[-14:])
    bull = bear = 0
    ev = []
    if e9[-1] > e21[-1] > e50[-1]:
        bull += 15; ev.append(("EMA alignment", "+15"))
    elif e9[-1] < e21[-1] < e50[-1]:
        bear += 15; ev.append(("EMA alignment", "-15"))
    if r > 55:
        bull += 10; ev.append((f"RSI {r:.0f} bullish", "+10"))
    elif r < 45:
        bear += 10; ev.append((f"RSI {r:.0f} bearish", "-10"))
    strength = max(bull, bear)
    direction = "BUY" if bull >= bear else "SELL"
    state = ("NO TRADE" if strength < 25 else "WAIT" if strength < 60 else f"{direction} SETUP")
    return {"price": closes[-1], "atr": atr, "rsi": r, "strength": strength,
            "direction": direction, "state": state, "evidence": ev}


def cmd_analyze(args):
    a = analyze(args.symbol, args.timeframe)
    panel = Panel(
        f"[bold]{args.symbol}[/bold] {args.timeframe}  price={a['price']:.2f}  ATR={a['atr']:.2f}  RSI={a['rsi']:.1f}\n"
        + "\n".join(f"  ✓ {f} ({w})" for f, w in a["evidence"])
        + f"\nStrength: {a['strength']}/100  →  [bold]{a['state']}[/bold]",
        title="Explainable analysis (setup strength, NOT win probability)",
    )
    console.print(panel)


def cmd_scan(args):
    symbols = args.symbols.split(",") if args.symbols else ["R_10", "R_25", "R_50", "R_100", "1HZ10V", "VOL100", "STPR100"]
    table = Table(title=f"Auto Scanner — {datetime.now(timezone.utc):%Y-%m-%d %H:%M} UTC")
    for col in ("Market", "Price", "Trend", "RSI", "Setup", "Strength", "State"):
        table.add_column(col)
    for s in symbols:
        try:
            a = analyze(s, args.timeframe)
            trend = "↑" if a["direction"] == "BUY" and a["strength"] >= 25 else "↓" if a["strength"] >= 25 else "→"
            color = "green" if a["state"].startswith("BUY") else "red" if a["state"].startswith("SELL") else "yellow"
            table.add_row(s, f"{a['price']:.2f}", trend, f"{a['rsi']:.0f}",
                          a["direction"], f"{a['strength']}/100", f"[{color}]{a['state']}[/{color}]")
        except Exception as e:  # fail-safe: never crash the whole scan (§64)
            table.add_row(s, "-", "-", "-", "-", "-", f"[red]unavailable: {e}[/red]")
    console.print(table)


def cmd_backtest(args):
    """Simple EMA-cross backtest on real historical candles (never synthetic — §95 #8)."""
    candles = get_history(args.symbol, 500, GRANULARITY[args.timeframe])
    closes = [float(c["close"]) for c in candles]
    fast, slow = ema(closes, 9), ema(closes, 21)
    balance, pos, entry = float(args.balance), 0, 0.0
    wins = losses = 0
    equity = []
    for i in range(1, len(closes)):
        if fast[i] is None or slow[i] is None or fast[i - 1] is None or slow[i - 1] is None:
            continue
        cross_up = fast[i - 1] <= slow[i - 1] and fast[i] > slow[i]
        cross_dn = fast[i - 1] >= slow[i - 1] and fast[i] < slow[i]
        if pos == 0 and cross_up:
            pos, entry = 1, closes[i]
        elif pos == 1 and cross_dn:
            pnl = (closes[i] - entry) / entry * args.stake
            balance += pnl
            wins, losses = wins + (pnl > 0), losses + (pnl <= 0)
            pos = 0
        equity.append(balance)
    peak, mdd = equity[0] if equity else balance, 0.0
    for e in equity:
        peak = max(peak, e); mdd = max(mdd, peak - e)
    total = wins + losses
    console.print(Panel(
        f"Strategy: EMA9/21 cross on {args.symbol} {args.timeframe} (real Deriv history)\n"
        f"Trades: {total} | Net P/L: {balance - float(args.balance):+.2f} | Balance: {balance:.2f}\n"
        f"Win rate: {(wins / total * 100) if total else 0:.1f}% (not the optimization target)\n"
        f"Max drawdown: {mdd:.2f}",
        title="Backtest"))


def cmd_risk(_args):
    table = Table(title="Risk Engine status (PAPER mode — real trading disabled)")
    for col in ("Setting", "Value"):
        table.add_column(col)
    rows = [("Mode", "CONSERVATIVE"), ("REAL_TRADING", "false (default — never auto-enabled)"),
            ("AUTOMATION", "OFF (default)"), ("Max stake", "10"), ("Max daily loss", "50"),
            ("Max open positions", "1"), ("Cooldown", "30 min"), ("Emergency stop", "READY")]
    for k, v in rows:
        table.add_row(k, v)
    console.print(table)


def cmd_emergency_stop(_args):
    console.print(Panel.fit(
        "[bold red]🛑 EMERGENCY STOP ENGAGED[/bold red]\n"
        "Automation stopped · new trades blocked · queued executions cancelled.\n"
        "(No live session connected — nothing to cancel.)",
        border_style="red"))


def main():
    p = argparse.ArgumentParser(prog="deriv-ai", description="DERIV INTELLIGENCE terminal (market data & paper analysis only)")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("markets").set_defaults(func=cmd_markets)
    sp = sub.add_parser("scan"); sp.add_argument("--timeframe", default="15m"); sp.add_argument("--symbols", default=None); sp.set_defaults(func=cmd_scan)
    ap = sub.add_parser("analyze"); ap.add_argument("symbol"); ap.add_argument("timeframe", nargs="?", default="5m"); ap.set_defaults(func=cmd_analyze)
    bp = sub.add_parser("backtest"); bp.add_argument("--symbol", default="R_100"); bp.add_argument("--timeframe", default="1h")
    bp.add_argument("--balance", default=1000.0, type=float); bp.add_argument("--stake", default=10.0, type=float); bp.set_defaults(func=cmd_backtest)
    sub.add_parser("risk").set_defaults(func=cmd_risk)
    sub.add_parser("emergency-stop").set_defaults(func=cmd_emergency_stop)
    args = p.parse_args()
    try:
        args.func(args)
    except (RuntimeError, urllib.error.URLError) as e:
        # Fail-safe rule (§65): if data unavailable, report and exit — do not guess.
        console.print(f"[bold red]TRADE BLOCKED / DATA UNAVAILABLE:[/bold red] {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
