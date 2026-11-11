import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../../app/generated/prisma/client";

export const CUSTOMER_SYNC_TEST_DATABASE = "jl_golf_sync_test";
export const CUSTOMER_SYNC_TEST_USER = "jl_golf_sync_test";
export const CUSTOMER_SYNC_TEST_HOST = "127.0.0.1";
export const CUSTOMER_SYNC_TEST_PORT = 3306;

export interface CustomerSyncTestDatabaseConfig {
  host: typeof CUSTOMER_SYNC_TEST_HOST;
  port: typeof CUSTOMER_SYNC_TEST_PORT;
  database: typeof CUSTOMER_SYNC_TEST_DATABASE;
  user: typeof CUSTOMER_SYNC_TEST_USER;
  password: string;
}

export interface CustomerSyncTestEnvironment {
  DATABASE_URL_TEST?: string;
  [key: string]: string | undefined;
}

export function parseCustomerSyncTestDatabaseUrl(
  rawUrl: string | undefined,
): CustomerSyncTestDatabaseConfig {
  if (!rawUrl) {
    throw new Error("DATABASE_URL_TEST is required for customer sync database tests.");
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("DATABASE_URL_TEST must be a valid MySQL URL.");
  }

  const database = decodeURIComponent(url.pathname.slice(1));
  const user = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  const port = url.port ? Number(url.port) : null;

  if (
    url.protocol !== "mysql:" ||
    url.hostname !== CUSTOMER_SYNC_TEST_HOST ||
    port !== CUSTOMER_SYNC_TEST_PORT ||
    database !== CUSTOMER_SYNC_TEST_DATABASE ||
    user !== CUSTOMER_SYNC_TEST_USER ||
    password.length === 0 ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    throw new Error(
      "DATABASE_URL_TEST must target 127.0.0.1:3306/jl_golf_sync_test with the dedicated test user and no query options.",
    );
  }

  return {
    host: CUSTOMER_SYNC_TEST_HOST,
    port: CUSTOMER_SYNC_TEST_PORT,
    database: CUSTOMER_SYNC_TEST_DATABASE,
    user: CUSTOMER_SYNC_TEST_USER,
    password,
  };
}

export function getCustomerSyncTestDatabaseConfig(
  env: CustomerSyncTestEnvironment = process.env,
): CustomerSyncTestDatabaseConfig {
  return parseCustomerSyncTestDatabaseUrl(env.DATABASE_URL_TEST);
}

export function createCustomerSyncTestClient(
  config: CustomerSyncTestDatabaseConfig,
): PrismaClient {
  const adapter = new PrismaMariaDb({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    connectionLimit: 5,
    connectTimeout: 30_000,
    acquireTimeout: 45_000,
  });

  return new PrismaClient({ adapter });
}

export async function assertCustomerSyncTestDatabaseIdentity(
  client: PrismaClient,
  config: CustomerSyncTestDatabaseConfig,
): Promise<void> {
  const rows = await client.$queryRaw<
    Array<{ databaseName: string | null; serverPort: number; userName: string }>
  >`
    SELECT
      DATABASE() AS databaseName,
      @@port AS serverPort,
      SUBSTRING_INDEX(CURRENT_USER(), '@', 1) AS userName
  `;
  const identity = rows[0];

  if (
    !identity ||
    identity.databaseName !== config.database ||
    Number(identity.serverPort) !== config.port ||
    identity.userName !== config.user
  ) {
    throw new Error("Connected database identity did not match the test-only target.");
  }
}
