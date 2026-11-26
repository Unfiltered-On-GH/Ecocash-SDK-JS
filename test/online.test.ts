import {
  AuthenticationError,
  BusinessRuleError,
  DuplicateReferenceError,
  EcoCashError,
  GatewayError,
  NetworkError,
  OnlinePayments,
  OnlinePaymentsConfig,
  RefundNotAllowedError,
  ServiceUnavailableError,
  TransactionNotFoundError,
  ValidationError,
} from "../src";
import { Reply, TEST_PHONE, mockAdapter } from "./helpers";

const baseConfig: Omit<OnlinePaymentsConfig, "adapter"> = {
  username: "test-user",
  password: "test-pass",
  merchantCode: "000000",
  merchantPin: "0000",
  merchantNumber: "770000000",
  terminalId: "TERM01",
  location: "Harare",
  merchantName: "Test Store",
  superMerchantName: "ECOCASH",
};

function client(replies: Reply[], extra: Partial<OnlinePaymentsConfig> = {}) {
  const mock = mockAdapter(replies);
  return { api: new OnlinePayments({ ...baseConfig, ...extra, adapter: mock.adapter }), requests: mock.requests };
}

const charged = (ref: string) => ({
  clientCorrelator: ref,
  referenceCode: ref,
  endUserId: TEST_PHONE,
  ecocashReference: "MP260508.1439.T0000001",
  transactionOperationStatus: "Charged",
  responseCode: "00",
});

describe("OnlinePayments config", () => {
  it("throws on missing config", () => {
    expect(() => new OnlinePayments({ ...baseConfig, merchantPin: "" })).toThrow(/merchantPin/);
  });

  it("requires baseURL in live mode", () => {
    expect(() => new OnlinePayments({ ...baseConfig, environment: "live" })).toThrow(/baseURL is required/);
    expect(() => new OnlinePayments({ ...baseConfig, environment: "live", baseURL: "https://example.test/v1" })).not.toThrow();
  });
});

describe("charge", () => {
  it("sends the documented body with Basic auth and maps the response", async () => {
    const { api, requests } = client([{ status: 200, data: charged("123456789012345") }], {
      notifyUrl: "https://example.test/hook",
    });
    const result = await api.charge({
      phoneNumber: TEST_PHONE,
      amount: 10.5,
      currency: "USD",
      description: "Order 1",
      reference: "123456789012345",
    });

    expect(requests).toHaveLength(1);
    const req = requests[0];
    expect(req.method).toBe("post");
    expect(req.url).toBe("https://developers.ecocash.co.zw/sandbox/payment/v1/transactions/amount/");
    expect(req.headers.authorization).toBe(`Basic ${Buffer.from("test-user:test-pass").toString("base64")}`);
    expect(req.body).toEqual({
      clientCorrelator: "123456789012345",
      referenceCode: "123456789012345",
      tranType: "MER",
      endUserId: TEST_PHONE,
      paymentAmount: {
        charginginformation: { amount: 10.5, currency: "USD", description: "Order 1" },
        chargeMetaData: { channel: "WEB" },
      },
      merchantCode: "000000",
      merchantPin: "0000",
      merchantNumber: "770000000",
      countryCode: "ZW",
      terminalID: "TERM01",
      location: "Harare",
      superMerchantName: "ECOCASH",
      merchantName: "Test Store",
      notifyUrl: "https://example.test/hook",
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.reference).toBe("123456789012345");
    expect(result.data.ecocashReference).toBe("MP260508.1439.T0000001");
    expect(result.data.status).toBe("Charged");
    expect(result.data.raw.responseCode).toBe("00");
    expect(result.recovered).toBeUndefined();
  });

  it("generates a 15-digit reference when none is given", async () => {
    const { api, requests } = client([{ status: 200, data: { responseCode: "00" } }]);
    const result = await api.charge({ phoneNumber: TEST_PHONE, amount: 1, currency: "USD", description: "x" });
    expect(result.reference).toMatch(/^\d{15}$/);
    expect((requests[0].body as Record<string, unknown>).clientCorrelator).toBe(result.reference);
  });

  it("on timeout looks the charge up instead of resending", async () => {
    const { api, requests } = client([{ timeout: true }, { status: 200, data: charged("111111111111111") }]);
    const result = await api.charge({
      phoneNumber: TEST_PHONE,
      amount: 1,
      currency: "USD",
      description: "x",
      reference: "111111111111111",
    });
    expect(requests.map((r) => r.method)).toEqual(["post", "get"]);
    expect(requests[1].url).toBe(
      `https://developers.ecocash.co.zw/sandbox/payment/v1/${TEST_PHONE}/transactions/amount/111111111111111`
    );
    expect(result.success).toBe(true);
    if (result.success) expect(result.recovered).toBe(true);
  });

  it("returns the timeout error with the reference when the lookup also fails", async () => {
    const { api, requests } = client([{ timeout: true }, { status: 404, data: { statusCode: "E008", statusMessage: "Not found" } }]);
    const result = await api.charge({ phoneNumber: TEST_PHONE, amount: 1, currency: "USD", description: "x", reference: "222" });
    expect(requests).toHaveLength(2);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBeInstanceOf(NetworkError);
    expect((result.error as NetworkError).timedOut).toBe(true);
    expect(result.error.retryable).toBe(true);
    expect(result.reference).toBe("222");
  });

  it("does not look up after a non-timeout network error", async () => {
    const { api, requests } = client([{ networkError: true }]);
    const result = await api.charge({ phoneNumber: TEST_PHONE, amount: 1, currency: "USD", description: "x" });
    expect(requests).toHaveLength(1);
    expect(!result.success && result.error instanceof NetworkError).toBe(true);
  });

  it.each([
    [{ phoneNumber: "0712345678" }, /Econet/],
    [{ phoneNumber: "12345" }, /Econet/],
    [{ amount: 0 }, /greater than 0/],
    [{ amount: 1.005 }, /2 decimal/],
    [{ currency: "EUR" }, /Unsupported currency/],
    [{ description: " " }, /description/],
  ])("validates input %p before sending", async (override, message) => {
    const { api, requests } = client([]);
    const result = await api.charge({
      phoneNumber: TEST_PHONE,
      amount: 1,
      currency: "USD",
      description: "x",
      reference: "333",
      ...(override as object),
    } as never);
    expect(requests).toHaveLength(0);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBeInstanceOf(ValidationError);
    expect(result.error.code).toBe("CLIENT_VALIDATION");
    expect(result.error.message).toMatch(message);
    expect(result.reference).toBe("333");
  });

  it.each(["771234567", "0771234567", "263781234567", "+263 78 123 4567"])("accepts Econet number %s", async (phone) => {
    const { api } = client([{ status: 200, data: { responseCode: "00" } }]);
    const result = await api.charge({ phoneNumber: phone, amount: 1, currency: "ZWG", description: "x" });
    expect(result.success).toBe(true);
  });
});

describe("Instant Payment error mapping", () => {
  it.each<[number, string, new (...args: never[]) => EcoCashError, boolean]>([
    [400, "E001", ValidationError, false],
    [400, "E004", ValidationError, false],
    [409, "E005", DuplicateReferenceError, false],
    [401, "E006", AuthenticationError, false],
    [401, "E007", AuthenticationError, false],
    [404, "E008", TransactionNotFoundError, false],
    [401, "E009", RefundNotAllowedError, false],
    [422, "E010", BusinessRuleError, false],
    [422, "E011", BusinessRuleError, false],
    [422, "E012", RefundNotAllowedError, false],
    [422, "E013", BusinessRuleError, false],
    [500, "E014", ServiceUnavailableError, true],
    [501, "E015", ServiceUnavailableError, true],
  ])("HTTP %i %s -> %p", async (status, code, cls, retryable) => {
    const { api } = client([{ status, data: { statusCode: code, statusMessage: `msg ${code}` } }]);
    const result = await api.charge({ phoneNumber: TEST_PHONE, amount: 1, currency: "USD", description: "x", reference: "9" });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBeInstanceOf(cls);
    expect(result.error.code).toBe(code);
    expect(result.error.httpStatus).toBe(status);
    expect(result.error.message).toBe(`msg ${code}`);
    expect(result.error.retryable).toBe(retryable);
    expect(result.reference).toBe("9");
  });

  it("maps a 200 that carries an error code to a failure", async () => {
    const { api } = client([{ status: 200, data: { statusCode: "E010", statusMessage: "Insufficient funds" } }]);
    const result = await api.charge({ phoneNumber: TEST_PHONE, amount: 1, currency: "USD", description: "x" });
    expect(!result.success && result.error instanceof BusinessRuleError).toBe(true);
  });

  it("returns a pending charge as success, as the sandbox does", async () => {
    const pending = {
      clientCorrelator: "597666533499059",
      transactionOperationStatus: "PENDING SUBSCRIBER VALIDATION",
      text: "Transaction is pending subscriber validation",
    };
    const { api } = client([{ status: 200, data: pending }]);
    const result = await api.charge({ phoneNumber: TEST_PHONE, amount: 1, currency: "USD", description: "x", reference: "597666533499059" });
    expect(result.success && result.data.status).toBe("PENDING SUBSCRIBER VALIDATION");
  });

  it("maps a 200 { messageId: SVC0270, text } refund rejection to RefundNotAllowedError", async () => {
    const body = { messageId: "SVC0270", text: "Reversal amount exceeds allowed amount." };
    const { api } = client([{ status: 200, data: body }]);
    const result = await api.refund({ originalEcocashReference: "MP1", phoneNumber: TEST_PHONE, amount: 2, currency: "USD", description: "x" });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBeInstanceOf(RefundNotAllowedError);
    expect(result.error.code).toBe("SVC0270");
    expect(result.error.httpStatus).toBe(200);
    expect(result.error.message).toBe("Reversal amount exceeds allowed amount.");
  });

  it("maps a 200 { messageId: <reference>, text } to a failure without a code", async () => {
    const body = { messageId: "597666533499059", text: "Transaction processing failed" };
    const { api } = client([{ status: 200, data: body }]);
    const result = await api.charge({ phoneNumber: TEST_PHONE, amount: 1, currency: "USD", description: "x", reference: "597666533499059" });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBeInstanceOf(EcoCashError);
    expect(result.error.code).toBeUndefined();
    expect(result.error.message).toBe("Transaction processing failed");
  });

  it("maps a sandbox gateway message without a code", async () => {
    const { api } = client([{ status: 400, data: { message: "Enable EIP sandbox access" } }]);
    const result = await api.charge({ phoneNumber: TEST_PHONE, amount: 1, currency: "USD", description: "x" });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBeInstanceOf(GatewayError);
    expect(result.error.message).toBe("Enable EIP sandbox access");
  });

  it("maps a bare 401 to AuthenticationError", async () => {
    const { api } = client([{ status: 401, data: "" }]);
    const result = await api.charge({ phoneNumber: TEST_PHONE, amount: 1, currency: "USD", description: "x" });
    expect(!result.success && result.error instanceof AuthenticationError).toBe(true);
  });
});

describe("lookup", () => {
  it("maps an all-null 200 body to TransactionNotFoundError", async () => {
    const { api } = client([{ status: 200, data: { id: null, clientCorrelator: null, transactionOperationStatus: null, text: null, messageId: null } }]);
    const result = await api.lookup({ phoneNumber: TEST_PHONE, reference: "000000000000001" });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBeInstanceOf(TransactionNotFoundError);
    expect(result.reference).toBe("000000000000001");
  });

  it("GETs by phone and reference", async () => {
    const { api, requests } = client([{ status: 200, data: charged("444") }]);
    const result = await api.lookup({ phoneNumber: TEST_PHONE, reference: "444" });
    expect(requests[0].method).toBe("get");
    expect(requests[0].url).toMatch(new RegExp(`/${TEST_PHONE}/transactions/amount/444$`));
    expect(result.success && result.data.status).toBe("Charged");
  });

  it("returns TransactionNotFoundError for E008", async () => {
    const { api } = client([{ status: 404, data: { statusCode: "E008", statusMessage: "Not found" } }]);
    const result = await api.lookup({ phoneNumber: TEST_PHONE, reference: "444" });
    expect(!result.success && result.error instanceof TransactionNotFoundError).toBe(true);
    expect(result.reference).toBe("444");
  });
});

describe("refund and reverse", () => {
  const refundResponse = {
    clientCorrelator: "555",
    originalEcocashReference: "MP1",
    ecocashReference: "MP2",
    transactionOperationStatus: "Refunded",
    responseCode: "00",
  };

  it.each([
    ["refund", "REF"],
    ["reverse", "REV"],
  ] as const)("%s sends tranType %s to /transactions/refund/", async (method, tranType) => {
    const { api, requests } = client([{ status: 200, data: refundResponse }]);
    const result = await api[method]({
      originalEcocashReference: "MP1",
      phoneNumber: TEST_PHONE,
      amount: 1,
      currency: "USD",
      description: "Refund",
      reference: "555",
    });
    expect(requests[0].url).toMatch(/\/transactions\/refund\/$/);
    const body = requests[0].body as Record<string, unknown>;
    expect(body.tranType).toBe(tranType);
    expect(body.originalEcocashReference).toBe("MP1");
    expect(body.clientCorrelator).toBe("555");
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.status).toBe("Refunded");
    expect(result.data.originalEcocashReference).toBe("MP1");
  });

  it("requires originalEcocashReference", async () => {
    const { api, requests } = client([]);
    const result = await api.refund({
      originalEcocashReference: "",
      phoneNumber: TEST_PHONE,
      amount: 1,
      currency: "USD",
      description: "x",
    });
    expect(requests).toHaveLength(0);
    expect(!result.success && result.error instanceof ValidationError).toBe(true);
    expect(result.reference).toMatch(/^\d{15}$/);
  });

  it("maps E009 (returned as 401) to RefundNotAllowedError, not AuthenticationError", async () => {
    const { api } = client([{ status: 401, data: { statusCode: "E009", statusMessage: "Not eligible" } }]);
    const result = await api.refund({
      originalEcocashReference: "MP1",
      phoneNumber: TEST_PHONE,
      amount: 1,
      currency: "USD",
      description: "x",
    });
    expect(!result.success && result.error instanceof RefundNotAllowedError).toBe(true);
  });
});

describe("parseNotification", () => {
  it("parses a JSON string or object", () => {
    const { api } = client([]);
    const body = charged("666");
    expect(api.parseNotification(JSON.stringify(body)).ecocashReference).toBe(body.ecocashReference);
    expect(api.parseNotification(body).reference).toBe("666");
  });

  it("rejects bodies that are not JSON objects", () => {
    const { api } = client([]);
    expect(() => api.parseNotification("not json")).toThrow(ValidationError);
    expect(() => api.parseNotification([1])).toThrow(ValidationError);
    expect(() => api.parseNotification(null)).toThrow(ValidationError);
  });
});
