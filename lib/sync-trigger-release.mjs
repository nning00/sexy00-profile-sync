// Production adapter is injected. Tests use synthetic responses only.
export function cronRelease({ account, token, fetchImpl = fetch }) {
  if (account !== "f9f173ed7748397ad18c0df63220fc3f" || !token) throw new Error("WRONG_CRON_ACCOUNT");
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/sexy00-site/schedules`;
  let attempted = false;
  async function read() {
    const r = await fetchImpl(endpoint, { headers: { Authorization: `Bearer ${token}` }, redirect: "error", signal: AbortSignal.timeout(20000) });
    const d = await r.json();
    if (!r.ok || d.success !== true || !Array.isArray(d.result?.schedules)) throw new Error("CRON_READ_UNVERIFIED");
    return d.result.schedules.map(s => s.cron).sort();
  }
  async function replace(crons) {
    const r = await fetchImpl(endpoint, { method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(crons.map(cron => ({ cron }))), redirect: "error", signal: AbortSignal.timeout(20000) });
    const d = await r.json();
    if (!r.ok || d.success !== true) throw new Error("CRON_WRITE_UNVERIFIED");
    const actual = await read();
    if (JSON.stringify(actual) !== JSON.stringify([...crons].sort())) throw new Error("CRON_STATE_MISMATCH");
  }
  return {
    async assertExisting() {
      if (JSON.stringify(await read()) !== JSON.stringify(["37 * * * *"])) throw new Error("EXISTING_CRON_DRIFT");
    },
    async assertEmpty() { if ((await read()).length) throw new Error("UNEXPECTED_EXISTING_CRON"); },
    async enable() {
      if ((await read()).length) throw new Error("CRON_DRIFT_BEFORE_ENABLE");
      attempted = true;
      await replace(["37 * * * *"]);
    },
    async restore() {
      if (!attempted) return;
      const actual = await read();
      if (actual.some(c => c !== "37 * * * *")) throw new Error("CRON_EXTERNAL_DRIFT_NO_OVERWRITE");
      await replace([]);
    },
  };
}

export function assertTriggerSecret(version) {
  const bindings = version?.resources?.bindings;
  if (!Array.isArray(bindings) || !bindings.some(b => b.name === "SEXY00_GITHUB_ACTIONS_TOKEN" && b.type === "secret_text")) {
    throw new Error("TRIGGER_SECRET_NOT_IN_UPLOADED_VERSION");
  }
}
