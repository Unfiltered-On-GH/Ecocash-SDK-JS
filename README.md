# EcoCash Payment SDK

A typed Node.js SDK for the EcoCash developer APIs:

- **Online Payments** (Instant Payment API): charge a customer's wallet, look a charge up, refund or reverse it.
- **EPG services**: Enterprise Cash-In, Disburse Change, Merchant to Subscriber and Transaction Lookup.

Version 2 is a rewrite for the new EcoCash APIs. If you are upgrading from 1.x, see [Migrating from 1.x](#migrating-from-1x).

Requires Node.js 18 or later.

```bash
npm install ecocash-payment-sdk
```

## Credentials

Sign in to the [EcoCash Developer Portal](https://developers.ecocash.co.zw/) and request sandbox access for each product. The two products use different credentials.

| Product | Credentials | Where they go |
|---|---|---|
| Online Payments | Basic auth username and password, merchant code, PIN, number, terminal ID, location, merchant and super merchant name | `new OnlinePayments({...})` |
| EPG services | `X-Client-Id`, `X-Client-Secret`, channel API username, password and encryption key | `new EpgClient({...})` |

Keep credentials in environment variables, never in code. This repository has a `.env.example` you can copy to `.env` (which is gitignored).

## Online Payments

```ts
import { OnlinePayments } from "ecocash-payment-sdk";

const ecocash = new OnlinePayments({
  environment: "sandbox",
  username: process.env.ECOCASH_ONLINE_USERNAME!,
  password: process.env.ECOCASH_ONLINE_PASSWORD!,
  merchantCode: process.env.ECOCASH_MERCHANT_CODE!,
  merchantPin: process.env.ECOCASH_MERCHANT_PIN!,
  merchantNumber: process.env.ECOCASH_MERCHANT_NUMBER!,
  terminalId: process.env.ECOCASH_TERMINAL_ID!,
  location: "Harare",
  merchantName: process.env.ECOCASH_MERCHANT_NAME!,
  superMerchantName: "ECOCASH",
  notifyUrl: "https://example.com/ecocash/callback", // optional
});

const result = await ecocash.charge({
  phoneNumber: "0771234567",
  amount: 10.5,
  currency: "USD",
  description: "Order 1001",
});

if (result.success) {
  console.log(result.data.status, result.data.ecocashReference);
} else {
  console.error(result.error.code, result.error.message);
}

// Store result.reference: you need it to look the charge up later.
```

### Methods

| Method | What it does |
|---|---|
| `charge({ phoneNumber, amount, currency, description, reference?, referenceCode?, notifyUrl? })` | `POST /transactions/amount/` with `tranType` MER |
| `lookup({ phoneNumber, reference })` | `GET /{phoneNumber}/transactions/amount/{reference}` |
| `refund({ originalEcocashReference, phoneNumber, amount, currency, description, reference? })` | `POST /transactions/refund/` with `tranType` REF |
| `reverse({ ...same as refund })` | `POST /transactions/refund/` with `tranType` REV |
| `parseNotification(body)` | Parses the JSON EcoCash posts to your `notifyUrl` |

- `phoneNumber` must be an Econet number (077 or 078) as 9, 10 or 12 digits, e.g. `771234567`, `0771234567` or `263771234567`.
- `amount` must be above 0 with at most 2 decimal places. `currency` is `USD` or `ZWG`.
- `reference` is your `clientCorrelator`. When omitted, a random 15-digit reference is generated. It must be new for every charge and every refund.

## EPG services

```ts
import { EpgClient } from "ecocash-payment-sdk";

const epg = new EpgClient({
  environment: "sandbox",
  clientId: process.env.ECOCASH_CLIENT_ID!,
  clientSecret: process.env.ECOCASH_CLIENT_SECRET!,
  username: process.env.ECOCASH_API_USERNAME!,
  password: process.env.ECOCASH_API_PASSWORD!, // plain; encrypted on every request
  encryptionKey: process.env.ECOCASH_ENCRYPTION_KEY!,
  terminalId: "TestTerminal001", // default for disburseChange
  merchantName: "Test Merchant", // default for disburseChange
  retries: 1, // optional; see "Retries and idempotency"
});

const result = await epg.cashIn({
  phoneNumber: "263771234567",
  amount: 1,
  currency: "USD",
  beneficiaryReference: "Grower203",
});
```

### Methods

| Method | serviceType | Default channel code |
|---|---|---|
| `cashIn({ phoneNumber, amount, currency, beneficiaryReference, transferReference?, reference? })` | `ENTERPRISECASHINV2` | 700002 |
| `disburseChange({ phoneNumber, amount, currency, transferReference?, terminalId?, merchantName?, reference? })` | `CHANGEDISBURSEV2` | 800002 |
| `merchantToSubscriber({ phoneNumber, amount, currency, transferReference?, reference? })` | `MERCHTOSUBV2` | 800004 |
| `lookupTransaction({ transactionReference, phoneNumber, currency, lookupReference? })` | `EXTERNALTRANSACTIONLOOKUP` | not used |

- `phoneNumber` is `263XXXXXXXXX` or `07XXXXXXXX`.
- Override channel codes with `channelCodes: { cashIn, disburseChange, merchantToSubscriber }` and the wallet with `walletId` (default `"12"`).
- `merchantToSubscriber` sends `externalReference` as a number, so its `reference` must be digits only. Generated references always are.
- `lookupTransaction` needs only `clientId` and `clientSecret`. `result.reference` is the reference of the transaction you looked up.

### Password encryption

EPG requires the channel API user's password to be encrypted. Give the SDK the plain `password` and `encryptionKey` and it encrypts on every request, using the portal's method: AES-128-GCM with a key taken from the first 16 bytes of the SHA-1 of the encryption key, a random 12-byte IV, and Base64 of IV + cipher text + tag.

You can also pass `encryptedPassword` (sent as is) or your own `encryptPassword: (password) => string`. The helper is exported as `encryptPassword(password, encryptionKey)`.

If every call returns `TP40101`, the encrypted password format is wrong. Tell us in an issue.

### Response fields

EPG responses are not consistent between services. The SDK normalises them:

- `timestamp` is set whether EcoCash sent `timestamp` or `timeStamp`.
- `status` is always a number.
- `externalReference` is always a string.
- `receiverNumber` is set from `receiverNumber` or `receiverMsisdn`.
- `amount` is a number.

The original body is always in `data.raw`.

## Results and errors

Every method returns a `Result` and never throws for API, network or input errors:

```ts
type Result<T> =
  | { success: true; data: T; reference: string; recovered?: boolean }
  | { success: false; error: EcoCashError; reference: string };
```

`reference` is always present, also on failure, so you can always look the transaction up. Constructors throw an `EcoCashError` for missing or invalid config.

Match on the error class or `error.code`, not on `error.message`. Every error has `code`, `httpStatus`, `message`, `body` and `retryable`.

| Class | Codes | Retryable |
|---|---|---|
| `AuthenticationError` | E006, E007, SBX40100, TP40101, other 401/403 | no |
| `ValidationError` | E001–E004, SBX40000, `CLIENT_VALIDATION` (checked before sending) | no |
| `DuplicateReferenceError` | E005 | no |
| `TransactionNotFoundError` | E008, 888803, other 404 | no |
| `RefundNotAllowedError` | E009, E012 | no |
| `BusinessRuleError` | E010, E011, E013, other 422 | no |
| `InvalidChannelCodeError` | TP40288 | no |
| `RecipientNotWhitelistedError` | IC50103 | no |
| `ServiceUnavailableError` | E014, E015, HTTP 5xx | yes |
| `GatewayError` | A sandbox gateway message with no code, e.g. sandbox access not enabled | no |
| `NetworkError` | Timeout or no response (`timedOut` tells which) | yes |

All classes extend `EcoCashError`. E009 arrives as HTTP 401 but is a `RefundNotAllowedError`, not an authentication failure.

## Retries and idempotency

The two products behave differently, so the SDK does too.

**Online Payments are not idempotent.** Sending the same `clientCorrelator` again returns E005. So the SDK never resends a charge. If a charge times out, the SDK looks it up once:

- If the lookup finds it, you get `success: true` with `recovered: true`.
- If not, you get the `NetworkError`. The charge may still complete; call `lookup()` later with `result.reference`, or wait for the `notifyUrl` callback.

**EPG is idempotent on `externalReference`.** Resending the same reference returns the original transaction. Set `retries` (default 0) to resend automatically after a timeout or 5xx. Other errors are never retried.

The default timeout is 30 seconds. Change it with `timeoutMs`.

## Sandbox

Sandbox URLs are built in:

- Online Payments: `https://developers.ecocash.co.zw/sandbox/payment/v1`
- EPG: `https://developers.ecocash.co.zw/api/serviceRequest`

In the Online Payments sandbox the merchant PIN selects the outcome:

| PIN | Outcome |
|---|---|
| 0000 | Success |
| 1111 | E010 |
| 2222 | E006 |
| 9999 | E013 |

EcoCash notes this matrix is not verified against UAT.

To try everything against the sandbox from this repository:

```bash
cp .env.example .env   # fill in your values
npm install
npm run sandbox
```

Set `ECOCASH_RUN_PIN_MATRIX=1` to also run the failing PINs. The script never prints your credentials.

## Going live

EcoCash issues production URLs when you go live, so there is no built-in live URL. Set both:

```ts
new OnlinePayments({ ...config, environment: "live", baseURL: "https://<url from EcoCash>" });
new EpgClient({ ...config, environment: "live", baseURL: "https://<url from EcoCash>" });
```

Without `baseURL`, `environment: "live"` throws. For EPG, `baseURL` is the part before `/serviceRequest`.

## Migrating from 1.x

1.x used the old `/api/ecocash_pay/...` endpoints with an `X-API-KEY` header. Those are replaced by the APIs above. There is no drop-in upgrade:

| 1.x | 2.x |
|---|---|
| `new EcoCashPayment({ apiKey })` | `new OnlinePayments({ username, password, merchant fields })` |
| `makePayment({ customerEcocashPhoneNumber, amount, description, currency, sourceReference })` | `charge({ phoneNumber, amount, description, currency, reference })` |
| `EcoCashRefund.requestRefund(...)` | `refund(...)` or `reverse(...)` |
| `EcoCashTransaction.lookupTransaction(...)` | `lookup({ phoneNumber, reference })` |
| `uuid` references | 15-digit numeric references |
| Errors thrown or returned as strings | `Result` with typed `EcoCashError` classes |

The EPG services are new in 2.x.

## Development

```bash
npm install
npm test           # unit tests, no network
npm run typecheck
npm run build
```

## License

MIT
