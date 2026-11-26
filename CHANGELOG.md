# Changelog

## 2.0.0

Rewrite for the new EcoCash developer APIs. Not compatible with 1.x; see "Migrating from 1.x" in the README.

### Added

- `OnlinePayments` client for the Instant Payment API: `charge`, `lookup`, `refund`, `reverse` and `parseNotification`.
- `EpgClient` for the EPG services: `cashIn`, `disburseChange`, `merchantToSubscriber` and `lookupTransaction`.
- Built-in EPG password encryption (`encryptPassword`), or bring your own.
- Typed error classes chosen by EcoCash error code, each with `code`, `httpStatus`, `body` and `retryable`.
- A `Result` type on every call, with `reference` always set, also on failure.
- Charge timeout recovery: one lookup instead of a resend.
- Optional EPG retries on timeouts and 5xx, which is safe because EPG is idempotent on `externalReference`.
- Input validation before sending: phone number formats, amount, currency and required fields.
- Normalised EPG responses (`timestamp`, numeric `status`, string `externalReference`, `receiverNumber`), with the original body in `raw`.
- Configurable timeout (30 seconds by default).
- Sandbox example script and `.env.example`.

### Changed

- References are 15 random digits from Node's `crypto`. The `uuid` dependency is removed.
- `environment: "live"` requires `baseURL`.
- Requires Node.js 18 or later.
- The npm package ships only `dist`, `README.md`, `LICENSE` and `CHANGELOG.md`.

### Removed

- `EcoCashPayment`, `EcoCashRefund` and `EcoCashTransaction`, and the old `X-API-KEY` endpoints.
