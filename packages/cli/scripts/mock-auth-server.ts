/**
 * Mock of the `/api/cli/login/authorize` endpoint, for exercising the CLI
 * loopback flow locally. Redirects straight back to the loopback with a
 * fake `sk_` token. Run: `PORT=9876 tsx scripts/mock-auth-server.ts`.
 */
import { createServer } from "node:http";

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/api/cli/login/authorize") {
    const redirect = url.searchParams.get("redirect_uri")!;
    const state = url.searchParams.get("state")!;
    const token = `sk_mock_${Math.random().toString(16).slice(2, 18)}`;
    const target =
      `${redirect}?token=${token}&state=${encodeURIComponent(state)}` +
      `&email=you@superwall.com&organization_name=${encodeURIComponent("Acme Inc")}`;
    res.statusCode = 302;
    res.setHeader("Location", target);
    res.end();
    return;
  }
  res.statusCode = 404;
  res.end("not found");
});

const port = Number(process.env.PORT ?? 9876);
server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`mock auth on http://localhost:${port}`);
});
