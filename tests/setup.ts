// Test environment setup — runs before any test file imports the app code.
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://seneschal:seneschal@localhost:5432/seneschal_test";
process.env.APP_SECRET = process.env.APP_SECRET ?? "test-secret";
process.env.APP_BASE_URL = "http://localhost:3000";
process.env.EMAIL_PROVIDER = "console";
process.env.STORAGE_DRIVER = "local";
process.env.STORAGE_LOCAL_DIR = ".storage-test";
process.env.EXTRACTION_PROVIDER = "mock";
