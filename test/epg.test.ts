import { createDecipheriv, createHash } from "crypto";
import {
  AuthenticationError,
  EcoCashError,
  EpgClient,
  EpgConfig,
  GatewayError,
  InvalidChannelCodeError,
  NetworkError,
  RecipientNotWhitelistedError,
  ServiceUnavailableError,
  TransactionNotFoundError,
  ValidationError,
  encryptPassword,
  generateReference,
} from "../src";
import { Reply, TEST_MSISDN, mockAdapter } from "./helpers";

const baseConfig: Omit<EpgConfig, "adapter"> = {
  clientId: "client-id",
  clientSecret: "client-secret",
  username: "epg-user",
  encryptedPassword: "ENCRYPTED",
  terminalId: "TERM01",
  merchantName: "Test Merchant",
};

function client(replies: Reply[], extra: Partial<EpgConfig> = {}) {
  const mock = mockAdapter(replies);
  return { epg: new EpgClient({ ...baseConfig, ...extra, adapter: mock.adapter }), requests: mock.requests };
}

const EPG_URL = "https://developers.ecocash.co.zw/api/serviceRequest";

function decrypt(encoded: string, key: string): string {
  const buf = Buffer.from(encoded, "base64");
  const aes = createHash("sha1").update(key, "utf8").digest().subarray(0, 16);
  const decipher = createDecipheriv("aes-128-gcm", aes, buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(buf.length - 16));
  return Buffer.concat([decipher.update(buf.subarray(12, buf.length - 16)), decipher.final()]).toString("utf8");
}

describe("EpgClient config", () => {
  it("requires client credentials", () => {
    expect(() => new EpgClient({ ...baseConfig, clientId: "" })).toThrow(/clientId/);
  });

  it("requires baseURL in live mode", () => {
    expect(() => new EpgClient({ ...baseConfig, environment: "live" })).toThrow(/baseURL is required/);
  });

  it("throws when a funds service has no username", async () => {
    const { epg } = client([], { username: undefined });
    await expect(
      epg.cashIn({ phoneNumber: TEST_MSISDN, amount: 1, currency: "USD", beneficiaryReference: "B1" })
    ).rejects.toThrow(/username is required/);
  });

  it("throws when the password cannot be encrypted", async () => {
    const { epg } = client([], { encryptedPassword: undefined, password: "secret" });
    await expect(
      epg.cashIn({ phoneNumber: TEST_MSISDN, amount: 1, currency: "USD", beneficiaryReference: "B1" })
    ).rejects.toThrow(/encryptionKey is required/);
  });
});

describe("cashIn", () => {
  it("sends the documented body and headers", async () => {
    const { epg, requests } = client([
      {
        status: 200,
        data: {
          serviceType: "ENTERPRISECASHINV2",
          externalReference: "100",
          transactionId: "CI1",
          status: "200",
          responseCode: "00",
          receiverNumber: TEST_MSISDN,
          amount: "1",
          currency: "USD",
          timeStamp: "2026-08-07T09:34:00.000Z",
        },
      },
    ]);
    const result = await epg.cashIn({
      phoneNumber: TEST_MSISDN,
      amount: 1,
      currency: "USD",
      beneficiaryReference: "Grower203",
      reference: "100",
    });

    const req = requests[0];
    expect(req.url).toBe(EPG_URL);
    expect(req.headers["x-client-id"]).toBe("client-id");
    expect(req.headers["x-client-secret"]).toBe("client-secret");
    expect(req.body).toEqual({
      serviceType: "ENTERPRISECASHINV2",
      externalReference: "100",
      beneficiaryReference: "Grower203",
      amount: "1",
      currency: "USD",
      transferReference: "ENTERPRISECASHIN",
      msisdn: TEST_MSISDN,
      username: "epg-user",
      password: "ENCRYPTED",
      channelCode: "700002",
      walletId: "12",
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.reference).toBe("100");
    expect(result.data.status).toBe(200);
    expect(result.data.timestamp).toBe("2026-08-07T09:34:00.000Z");
    expect(result.data.amount).toBe(1);
  });

  it("encrypts the password with the encryption key on each request", async () => {
    const { epg, requests } = client([{ status: 200, data: { responseCode: "00" } }], {
      encryptedPassword: undefined,
      password: "plain-password",
      encryptionKey: "test-key",
    });
    await epg.cashIn({ phoneNumber: TEST_MSISDN, amount: 1, currency: "USD", beneficiaryReference: "B1" });
    const sent = (requests[0].body as Record<string, string>).password;
    expect(sent).not.toBe("plain-password");
    expect(decrypt(sent, "test-key")).toBe("plain-password");
  });

  it("uses a custom encryptPassword function", async () => {
    const { epg, requests } = client([{ status: 200, data: { responseCode: "00" } }], {
      encryptedPassword: undefined,
      password: "pw",
      encryptPassword: (p) => `custom(${p})`,
    });
    await epg.cashIn({ phoneNumber: TEST_MSISDN, amount: 1, currency: "USD", beneficiaryReference: "B1" });
    expect((requests[0].body as Record<string, string>).password).toBe("custom(pw)");
  });

  it("honours custom channel codes and wallet id", async () => {
    const { epg, requests } = client([{ status: 200, data: { responseCode: "00" } }], {
      channelCodes: { cashIn: "123" },
      walletId: "7",
    });
    await epg.cashIn({ phoneNumber: TEST_MSISDN, amount: 1, currency: "USD", beneficiaryReference: "B1" });
    const body = requests[0].body as Record<string, string>;
    expect(body.channelCode).toBe("123");
    expect(body.walletId).toBe("7");
  });
});

describe("disburseChange", () => {
  it("sends the documented body and maps receiverMsisdn and numeric status", async () => {
    const { epg, requests } = client([
      {
        status: 200,
        data: {
          serviceType: "CHANGEDISBURSEV2",
          externalReference: "200",
          status: 200,
          responseCode: "00",
          receiverMsisdn: TEST_MSISDN,
          timestamp: "2026-08-26T12:48:40.107Z",
        },
      },
    ]);
    const result = await epg.disburseChange({ phoneNumber: TEST_MSISDN, amount: 2, currency: "USD", reference: "200" });
    expect(requests[0].body).toEqual({
      serviceType: "CHANGEDISBURSEV2",
      externalReference: "200",
      receiverNumber: TEST_MSISDN,
      amount: "2",
      currency: "USD",
      transferReference: "Change Disbursement",
      username: "epg-user",
      password: "ENCRYPTED",
      terminalId: "TERM01",
      channelCode: "800002",
      merchantName: "Test Merchant",
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.receiverNumber).toBe(TEST_MSISDN);
    expect(result.data.status).toBe(200);
    expect(result.data.timestamp).toBe("2026-08-26T12:48:40.107Z");
  });

  it("requires a terminalId", async () => {
    const { epg, requests } = client([], { terminalId: undefined });
    const result = await epg.disburseChange({ phoneNumber: TEST_MSISDN, amount: 2, currency: "USD" });
    expect(requests).toHaveLength(0);
    expect(!result.success && result.error instanceof ValidationError).toBe(true);
  });
});

describe("merchantToSubscriber", () => {
  it("sends externalReference as a number and maps senderName", async () => {
    const { epg, requests } = client([
      {
        status: 200,
        data: {
          serviceType: "MERCHTOSUBV2",
          externalReference: 300,
          status: "200",
          responseCode: "00",
          senderName: "Test Merchant",
          timeStamp: "2026-08-26T17:53:41.621Z",
        },
      },
    ]);
    const result = await epg.merchantToSubscriber({ phoneNumber: TEST_MSISDN, amount: 170, currency: "USD", reference: "300" });
    const body = requests[0].body as Record<string, unknown>;
    expect(body.externalReference).toBe(300);
    expect(body.serviceType).toBe("MERCHTOSUBV2");
    expect(body.channelCode).toBe("800004");
    expect(body.transferReference).toBe("300");
    expect(body.amount).toBe("170");
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.externalReference).toBe("300");
    expect(result.data.senderName).toBe("Test Merchant");
    expect(result.data.timestamp).toBe("2026-08-26T17:53:41.621Z");
  });

  it("rejects non-numeric references", async () => {
    const { epg, requests } = client([]);
    const result = await epg.merchantToSubscriber({ phoneNumber: TEST_MSISDN, amount: 1, currency: "USD", reference: "ABC" });
    expect(requests).toHaveLength(0);
    expect(!result.success && result.error instanceof ValidationError).toBe(true);
  });

  it("generated references are safe to send as numbers", async () => {
    const { epg, requests } = client([{ status: 200, data: { responseCode: "00" } }]);
    const result = await epg.merchantToSubscriber({ phoneNumber: TEST_MSISDN, amount: 1, currency: "USD" });
    expect(String((requests[0].body as Record<string, unknown>).externalReference)).toBe(result.reference);
  });
});

describe("lookupTransaction", () => {
  it("sends client headers only, no username or password", async () => {
    const { epg, requests } = client([
      {
        status: 200,
        data: {
          serviceType: "EXTERNALTRANSACTIONLOOKUP",
          externalReference: "999",
          externalTransactionId: "100",
          transactionId: "CI1",
          status: "200",
          statusCode: "TS",
          responseCode: "00",
          timestamp: "2026-08-26T12:48:40.107Z",
        },
      },
    ]);
    const result = await epg.lookupTransaction({
      transactionReference: "100",
      phoneNumber: TEST_MSISDN,
      currency: "USD",
      lookupReference: "999",
    });
    expect(requests[0].body).toEqual({
      serviceType: "EXTERNALTRANSACTIONLOOKUP",
      externalReference: "999",
      externalTransactionId: "100",
      currency: "USD",
      msisdn: TEST_MSISDN,
    });
    expect(requests[0].headers["x-client-id"]).toBe("client-id");
    expect(result.reference).toBe("100");
    expect(result.success && result.data.statusCode).toBe("TS");
  });

  it("works without a channel API user", async () => {
    const { epg } = client([{ status: 200, data: { responseCode: "00" } }], { username: undefined, encryptedPassword: undefined });
    const result = await epg.lookupTransaction({ transactionReference: "1", phoneNumber: TEST_MSISDN, currency: "ZWG" });
    expect(result.success).toBe(true);
  });

  it("maps the 888803 body (string status, no exception field)", async () => {
    const { epg } = client([
      {
        status: 400,
        data: {
          serviceType: "EXTERNALTRANSACTIONLOOKUP",
          externalReference: "999",
          status: "400",
          responseCode: "888803",
          timestamp: "2026-08-26T12:48:40.107Z",
          message: "No Transaction Found",
        },
      },
    ]);
    const result = await epg.lookupTransaction({ transactionReference: "100", phoneNumber: TEST_MSISDN, currency: "USD" });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBeInstanceOf(TransactionNotFoundError);
    expect(result.error.code).toBe("888803");
    expect(result.error.message).toBe("No Transaction Found");
    expect(result.reference).toBe("100");
  });

  it("maps 888803 returned with HTTP 200 too", async () => {
    const { epg } = client([{ status: 200, data: { status: "400", responseCode: "888803", message: "No Transaction Found" } }]);
    const result = await epg.lookupTransaction({ transactionReference: "100", phoneNumber: TEST_MSISDN, currency: "USD" });
    expect(!result.success && result.error instanceof TransactionNotFoundError).toBe(true);
    if (!result.success) expect(result.error.httpStatus).toBe(400);
  });
});

describe("EPG error mapping", () => {
  it.each<[number, string, new (...args: never[]) => EcoCashError]>([
    [401, "SBX40100", AuthenticationError],
    [401, "TP40101", AuthenticationError],
    [400, "SBX40000", ValidationError],
    [400, "TP40288", InvalidChannelCodeError],
    [400, "IC50103", RecipientNotWhitelistedError],
  ])("HTTP %i %s -> %p", async (status, code, cls) => {
    const { epg } = client([
      { status, data: { status, responseCode: code, exception: "X", message: `msg ${code}`, timestamp: "t" } },
    ]);
    const result = await epg.cashIn({ phoneNumber: TEST_MSISDN, amount: 1, currency: "USD", beneficiaryReference: "B", reference: "5" });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBeInstanceOf(cls);
    expect(result.error.code).toBe(code);
    expect(result.error.message).toBe(`msg ${code}`);
    expect(result.error.retryable).toBe(false);
    expect(result.reference).toBe("5");
  });

  it("maps a gateway message without a code", async () => {
    const { epg } = client([{ status: 400, data: { message: "Sandbox access not enabled" } }]);
    const result = await epg.cashIn({ phoneNumber: TEST_MSISDN, amount: 1, currency: "USD", beneficiaryReference: "B" });
    expect(!result.success && result.error instanceof GatewayError).toBe(true);
  });

  it("validates the msisdn format", async () => {
    const { epg, requests } = client([]);
    const result = await epg.cashIn({ phoneNumber: "12345", amount: 1, currency: "USD", beneficiaryReference: "B" });
    expect(requests).toHaveLength(0);
    expect(!result.success && result.error.code === "CLIENT_VALIDATION").toBe(true);
  });
});

describe("EPG retries", () => {
  it("does not retry by default", async () => {
    const { epg, requests } = client([{ timeout: true }]);
    const result = await epg.cashIn({ phoneNumber: TEST_MSISDN, amount: 1, currency: "USD", beneficiaryReference: "B" });
    expect(requests).toHaveLength(1);
    expect(!result.success && result.error instanceof NetworkError).toBe(true);
  });

  it("resends the same body after a retryable error", async () => {
    const { epg, requests } = client(
      [{ timeout: true }, { status: 503, data: "" }, { status: 200, data: { responseCode: "00", externalReference: "77" } }],
      { retries: 2 }
    );
    const result = await epg.cashIn({ phoneNumber: TEST_MSISDN, amount: 1, currency: "USD", beneficiaryReference: "B", reference: "77" });
    expect(requests).toHaveLength(3);
    expect(requests[1].body).toEqual(requests[0].body);
    expect(requests[2].body).toEqual(requests[0].body);
    expect(result.success).toBe(true);
  });

  it("returns the last error when retries run out", async () => {
    const { epg, requests } = client([{ status: 500, data: "" }, { status: 502, data: "" }], { retries: 1 });
    const result = await epg.cashIn({ phoneNumber: TEST_MSISDN, amount: 1, currency: "USD", beneficiaryReference: "B" });
    expect(requests).toHaveLength(2);
    expect(!result.success && result.error instanceof ServiceUnavailableError).toBe(true);
    if (!result.success) expect(result.error.httpStatus).toBe(502);
  });

  it("does not retry non-retryable errors", async () => {
    const { epg, requests } = client([{ status: 400, data: { responseCode: "TP40288", message: "bad channel" } }], { retries: 3 });
    await epg.cashIn({ phoneNumber: TEST_MSISDN, amount: 1, currency: "USD", beneficiaryReference: "B" });
    expect(requests).toHaveLength(1);
  });
});

describe("encryptPassword", () => {
  it("round-trips with AES-128-GCM keyed by SHA-1 of the key", () => {
    const encrypted = encryptPassword("s3cret!", "my-key");
    expect(decrypt(encrypted, "my-key")).toBe("s3cret!");
    // 12-byte IV + 7-byte cipher text + 16-byte tag
    expect(Buffer.from(encrypted, "base64")).toHaveLength(12 + 7 + 16);
  });

  it("uses a fresh IV every time", () => {
    expect(encryptPassword("a", "k")).not.toBe(encryptPassword("a", "k"));
  });

  it("fails to decrypt with the wrong key", () => {
    expect(() => decrypt(encryptPassword("a", "k1"), "k2")).toThrow();
  });
});

describe("generateReference", () => {
  it("returns 15 digits that survive conversion to a number", () => {
    for (let i = 0; i < 200; i++) {
      const ref = generateReference();
      expect(ref).toMatch(/^[1-9]\d{14}$/);
      expect(String(Number(ref))).toBe(ref);
    }
  });
});
