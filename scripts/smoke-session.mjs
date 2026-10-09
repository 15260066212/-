const baseUrl = (process.env.SMOKE_BASE_URL ?? 'http://localhost:5174/api').replace(/\/$/, '');

async function main() {
  const res = await fetch(`${baseUrl}/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });

  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    throw new Error(`Expected JSON from ${baseUrl}/session, got ${res.status} ${contentType}`);
  }

  const json = await res.json();
  if (!res.ok || !json.success || !json.data?.sessionId) {
    throw new Error(`Session smoke test failed: ${JSON.stringify(json)}`);
  }

  console.log(`Session smoke test passed: ${json.data.sessionId}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
