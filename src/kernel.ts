import { Kernel } from "@onkernel/sdk";

const kernel = new Kernel();

export class NeedsReconnectError extends Error {}

// Opens a stealth browser on a saved profile, optionally writes files into the VM,
// runs Playwright code inside the VM, and always deletes the session.
// `code` runs with `page` in scope and receives `params` as a JSON literal.
export async function runInBrowser<T>(opts: {
  profile: string;
  code: string;
  params?: unknown;
  files?: { path: string; contents: Uint8Array }[];
  timeoutSec?: number;
}): Promise<T> {
  const session = await kernel.browsers.create({
    profile: { name: opts.profile },
    stealth: true,
    timeout_seconds: 600,
  });
  try {
    for (const f of opts.files ?? []) {
      await kernel.browsers.fs.writeFile(session.session_id, f.contents, { path: f.path });
    }
    const timeoutSec = opts.timeoutSec ?? 180;
    const res = await kernel.browsers.playwright.execute(
      session.session_id,
      { code: `const params = ${JSON.stringify(opts.params ?? {})};\n${opts.code}`, timeout_sec: timeoutSec },
      // SDK default HTTP timeout (1 min) is shorter than a listing run; never retry — a retry could post twice
      { timeout: (timeoutSec + 30) * 1000, maxRetries: 0 },
    );
    if (!res.success) {
      const msg = String(res.error ?? res.stderr ?? "playwright failed");
      if (msg.includes("NEEDS_RECONNECT")) throw new NeedsReconnectError(msg);
      throw new Error(msg);
    }
    return res.result as T;
  } finally {
    await kernel.browsers.deleteByID(session.session_id);
  }
}
