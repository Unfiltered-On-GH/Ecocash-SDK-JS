/**
 * Runs every SDK call against the EcoCash sandbox using the values in .env.
 *
 *   cp .env.example .env   # then fill it in
 *   npm run sandbox
 *
 * Sections whose credentials are missing are skipped. Secrets are never printed.
 */
import { EpgClient, OnlinePayments, Result } from "../src";

const env = (name: string): string => (process.env[name] ?? "").trim();
const has = (...names: string[]): boolean => names.every((n) => env(n) !== "");

function show<T>(label: string, result: Result<T>): void {
  if (result.success) {
    const data = result.data as unknown as { raw?: unknown };
    console.log(`  OK   ${label}  reference=${result.reference}${"recovered" in result && result.recovered ? " (recovered)" : ""}`);
    console.log(`       ${JSON.stringify(data.raw ?? data)}`);
  } else {
    const e = result.error;
    console.log(`  FAIL ${label}  reference=${result.reference}`);
    console.log(`       ${e.name} code=${e.code ?? "-"} http=${e.httpStatus ?? "-"} retryable=${e.retryable}: ${e.message}`);
  }
}

async function online(phone: string): Promise<void> {
  const required = [
    "ECOCASH_ONLINE_USERNAME",
    "ECOCASH_ONLINE_PASSWORD",
    "ECOCASH_MERCHANT_CODE",
    "ECOCASH_MERCHANT_PIN",
    "ECOCASH_MERCHANT_NUMBER",
    "ECOCASH_TERMINAL_ID",
    "ECOCASH_LOCATION",
    "ECOCASH_MERCHANT_NAME",
    "ECOCASH_SUPER_MERCHANT_NAME",
  ];
  if (!has(...required)) {
    console.log("Online Payments: skipped (fill in the ECOCASH_ONLINE_* and merchant values)");
    return;
  }

  const make = (pin: string) =>
    new OnlinePayments({
      environment: env("ECOCASH_ENV") === "live" ? "live" : "sandbox",
      username: env("ECOCASH_ONLINE_USERNAME"),
      password: env("ECOCASH_ONLINE_PASSWORD"),
      merchantCode: env("ECOCASH_MERCHANT_CODE"),
      merchantPin: pin,
      merchantNumber: env("ECOCASH_MERCHANT_NUMBER"),
      terminalId: env("ECOCASH_TERMINAL_ID"),
      location: env("ECOCASH_LOCATION"),
      merchantName: env("ECOCASH_MERCHANT_NAME"),
      superMerchantName: env("ECOCASH_SUPER_MERCHANT_NAME"),
    });

  console.log("Online Payments");
  const api = make(env("ECOCASH_MERCHANT_PIN"));
  const charge = await api.charge({ phoneNumber: phone, amount: 1, currency: "USD", description: "SDK sandbox test" });
  show("charge", charge);

  const lookup = await api.lookup({ phoneNumber: phone, reference: charge.reference });
  show("lookup", lookup);

  const ecocashReference = charge.success ? charge.data.ecocashReference : undefined;
  if (ecocashReference) {
    show(
      "refund",
      await api.refund({
        originalEcocashReference: ecocashReference,
        phoneNumber: phone,
        amount: 1,
        currency: "USD",
        description: "SDK sandbox refund",
      })
    );
  } else {
    console.log("  skip refund (no ecocashReference from the charge)");
  }

  if (env("ECOCASH_RUN_PIN_MATRIX") === "1") {
    for (const pin of ["1111", "2222", "9999"]) {
      show(
        `charge with PIN ${pin}`,
        await make(pin).charge({ phoneNumber: phone, amount: 1, currency: "USD", description: `PIN ${pin}` })
      );
    }
  }
}

async function epg(msisdn: string): Promise<void> {
  if (!has("ECOCASH_CLIENT_ID", "ECOCASH_CLIENT_SECRET")) {
    console.log("EPG: skipped (fill in ECOCASH_CLIENT_ID and ECOCASH_CLIENT_SECRET)");
    return;
  }
  const canMoveFunds =
    has("ECOCASH_API_USERNAME", "ECOCASH_API_ENCRYPTED_PASSWORD") ||
    has("ECOCASH_API_USERNAME", "ECOCASH_API_PASSWORD", "ECOCASH_ENCRYPTION_KEY");

  const client = new EpgClient({
    environment: env("ECOCASH_ENV") === "live" ? "live" : "sandbox",
    clientId: env("ECOCASH_CLIENT_ID"),
    clientSecret: env("ECOCASH_CLIENT_SECRET"),
    username: env("ECOCASH_API_USERNAME") || undefined,
    password: env("ECOCASH_API_PASSWORD") || undefined,
    encryptionKey: env("ECOCASH_ENCRYPTION_KEY") || undefined,
    encryptedPassword: env("ECOCASH_API_ENCRYPTED_PASSWORD") || undefined,
    terminalId: env("ECOCASH_TERMINAL_ID") || "TestTerminal001",
    merchantName: env("ECOCASH_MERCHANT_NAME") || "Test Merchant",
  });

  console.log("EPG services");
  if (!canMoveFunds) {
    console.log("  skip funds services (fill in ECOCASH_API_USERNAME and ECOCASH_API_ENCRYPTED_PASSWORD, or ECOCASH_API_PASSWORD with ECOCASH_ENCRYPTION_KEY)");
  } else {
    const cashIn = await client.cashIn({ phoneNumber: msisdn, amount: 1, currency: "USD", beneficiaryReference: "SDKTest" });
    show("cashIn", cashIn);
    show("disburseChange", await client.disburseChange({ phoneNumber: msisdn, amount: 1, currency: "USD" }));
    show("merchantToSubscriber", await client.merchantToSubscriber({ phoneNumber: msisdn, amount: 1, currency: "USD" }));
    show(
      "lookupTransaction (cashIn)",
      await client.lookupTransaction({ transactionReference: cashIn.reference, phoneNumber: msisdn, currency: "USD" })
    );
  }
  show(
    "lookupTransaction (unknown reference, expect 888803)",
    await client.lookupTransaction({ transactionReference: "000000000000001", phoneNumber: msisdn, currency: "USD" })
  );
}

async function main(): Promise<void> {
  const phone = env("ECOCASH_TEST_MSISDN");
  if (!phone) {
    console.error("Set ECOCASH_TEST_MSISDN in .env (copy .env.example first).");
    process.exitCode = 1;
    return;
  }
  // Online Payments wants an Econet number; EPG wants 263... or 07...
  const msisdn = phone.startsWith("263") || phone.startsWith("0") ? phone : `263${phone}`;
  await online(phone);
  console.log();
  await epg(msisdn);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
