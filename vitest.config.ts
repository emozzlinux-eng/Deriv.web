import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: { include: ['packages/**/test/**/*.test.ts', 'tests/**/*.test.ts'] },
  resolve: {
    alias: {
      '@di/shared': path.resolve(__dirname, 'packages/shared/src/index.ts'),
      '@di/candle-engine': path.resolve(__dirname, 'packages/candle-engine/src/index.ts'),
      '@di/indicator-engine': path.resolve(__dirname, 'packages/indicator-engine/src/index.ts'),
      '@di/analysis-engine': path.resolve(__dirname, 'packages/analysis-engine/src/index.ts'),
      '@di/signal-engine': path.resolve(__dirname, 'packages/signal-engine/src/index.ts'),
      '@di/risk-engine': path.resolve(__dirname, 'packages/risk-engine/src/index.ts'),
      '@di/execution-engine': path.resolve(__dirname, 'packages/execution-engine/src/index.ts'),
      '@di/backtest-engine': path.resolve(__dirname, 'packages/backtest-engine/src/index.ts'),
      '@di/strategy-engine': path.resolve(__dirname, 'packages/strategy-engine/src/index.ts'),
      '@di/deriv-client': path.resolve(__dirname, 'packages/deriv-client/src/DerivClient.ts'),
      '@di/market-engine': path.resolve(__dirname, 'packages/market-engine/src/index.ts'),
      '@di/paper-engine': path.resolve(__dirname, 'packages/paper-engine/src/index.ts'),
    },
  },
});
