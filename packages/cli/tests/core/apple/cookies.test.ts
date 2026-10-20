import assert from "node:assert/strict";
import { test } from "node:test";
import { createCookieJar } from "@/core/apple/cookies";

const idmsa = new URL("https://idmsa.apple.com/appleauth/auth/signin");
const connect = new URL("https://appstoreconnect.apple.com/olympus/v1/session");

test("domain cookies are shared across Apple hosts; host cookies are not", () => {
  const jar = createCookieJar();
  jar.store(idmsa, [
    "myacinfo=abc; Domain=.apple.com; Path=/; Secure; HttpOnly",
    "aasp=local; Path=/",
    "broken",
  ]);
  assert.equal(jar.header(idmsa), "myacinfo=abc; aasp=local");
  assert.equal(jar.header(connect), "myacinfo=abc");
  assert.equal(jar.header(new URL("https://example.com/")), undefined);
});

test("a path-scoped cookie only goes to that path", () => {
  const jar = createCookieJar();
  jar.store(connect, ["itctx=1; Path=/olympus"]);
  assert.equal(jar.header(connect), "itctx=1");
  assert.equal(jar.header(new URL("https://appstoreconnect.apple.com/olympus")), "itctx=1");
  assert.equal(jar.header(new URL("https://appstoreconnect.apple.com/iris/v1/apps")), undefined);
});

test("a cookie is replaced by name and removed when expired", () => {
  const jar = createCookieJar();
  jar.store(idmsa, ["a=1; Path=/", "b=1; Path=/", "c=1; Path=/"]);
  jar.store(idmsa, [
    "a=2; Path=/",
    "b=gone; Path=/; Max-Age=0",
    "c=gone; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT",
  ]);
  assert.equal(jar.header(idmsa), "a=2");
});

test("a snapshot restores into a new jar", () => {
  const jar = createCookieJar();
  jar.store(idmsa, ['DES123="quoted"; Domain=apple.com; Path=/']);
  const restored = createCookieJar(jar.snapshot());
  assert.equal(restored.header(connect), 'DES123="quoted"');
});
