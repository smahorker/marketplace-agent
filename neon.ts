import { defineConfig } from "@neon/config/v1";

export default defineConfig({
  auth: true,
  aiGateway: true,
  buckets: {
    photos: { access: "private" },
  },
  functions: {
    api: {
      name: "api",
      source: "./src/index.ts",
      env: {
        KERNEL_API_KEY: process.env.KERNEL_API_KEY!,
        AGENTMAIL_API_KEY: process.env.AGENTMAIL_API_KEY!,
        AGENTMAIL_INBOX_ID: process.env.AGENTMAIL_INBOX_ID!,
        AGENTMAIL_WEBHOOK_SECRET: process.env.AGENTMAIL_WEBHOOK_SECRET!,
        SELLER_GMAIL: process.env.SELLER_GMAIL!,
        GMAIL_APP_PASSWORD: process.env.GMAIL_APP_PASSWORD!,
        APP_API_KEY: process.env.APP_API_KEY!,
      },
    },
  },
  // Branch policy: per-branch tuning
  branch: (branch) => {
    if (branch.isDefault) {
      // Default branch: no overrides, uses project defaults
      return {};
    }
    if (!branch.exists) {
      // New non-default branches: auto-expire
      // Run `neon checkout <name>` to create a new branch with these settings
      return { ttl: "7d" };
    }
    // Existing branch: no changes
    return {};
  },
});
