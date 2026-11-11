import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getCustomerSyncTestDatabaseConfig,
  parseCustomerSyncTestDatabaseUrl,
} from "./helpers/customerSyncTestDatabase";

const validUrl =
  "mysql://jl_golf_sync_test:test-only-password@127.0.0.1:3306/jl_golf_sync_test";

test("accepts only the dedicated local customer sync database target", () => {
  assert.deepEqual(parseCustomerSyncTestDatabaseUrl(validUrl), {
    host: "127.0.0.1",
    port: 3306,
    database: "jl_golf_sync_test",
    user: "jl_golf_sync_test",
    password: "test-only-password",
  });
});

test("requires DATABASE_URL_TEST and never falls back to DATABASE_URL", () => {
  const ordinaryDatabaseOnly = {
    DATABASE_URL: "mysql://ordinary.invalid/production",
    DATABASE_URL_TEST: undefined,
  };
  assert.throws(
    () => getCustomerSyncTestDatabaseConfig(ordinaryDatabaseOnly),
    /DATABASE_URL_TEST is required/,
  );
});

test("rejects remote hosts, wrong ports or databases, and non-test users", () => {
  const unsafeUrls = [
    "mysql://jl_golf_sync_test:test-only-password@example.com:3306/jl_golf_sync_test",
    "mysql://jl_golf_sync_test:test-only-password@127.0.0.1:33306/jl_golf_sync_test",
    "mysql://jl_golf_sync_test:test-only-password@127.0.0.1:3306/production",
    "mysql://root:test-only-password@127.0.0.1:3306/jl_golf_sync_test",
  ];

  for (const url of unsafeUrls) {
    assert.throws(() => parseCustomerSyncTestDatabaseUrl(url));
  }
});

test("rejects query options and missing test credentials", () => {
  assert.throws(() =>
    parseCustomerSyncTestDatabaseUrl(
      "mysql://jl_golf_sync_test:test-only-password@127.0.0.1:3306/jl_golf_sync_test?sslaccept=accept_invalid_certs",
    ),
  );
  assert.throws(() =>
    parseCustomerSyncTestDatabaseUrl(
      "mysql://jl_golf_sync_test@127.0.0.1:3306/jl_golf_sync_test",
    ),
  );
});
