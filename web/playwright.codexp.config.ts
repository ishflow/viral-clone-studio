import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir:'./e2e/codexp', outputDir:'./test-results-codexp', workers:1, timeout:180_000,
 reporter:[['list']], use:{channel:'chrome', baseURL:'http://127.0.0.1:3203', actionTimeout:15_000, navigationTimeout:30_000} });
