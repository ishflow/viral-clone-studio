// The preview board draws the same `MailView` (core/payments/mail-view) as the sent mail:
// the content is built here from the board's dictionaries, the markup is the transport's.
export { VerifyEmail, ResetEmail, ReadyEmail, StoppedEmail, PaymentEmail, RefusedEmail } from './emails';
export { OutboxList } from './Outbox';
export { EMAIL_NAMES, emailNameOf, isEmailName, propsFor, type EmailName, type EmailSpec } from './build';
