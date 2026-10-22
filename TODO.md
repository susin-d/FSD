# Nearby To-do List

Project backlog compiled from the current README, source review, and workspace state on 15 October 2026. No explicit `TODO`, `FIXME`, or `HACK` markers were found in the app/server source; these items are the documented launch requirements and visible follow-ups.

## Before live bookings

- [ ] **Choose and configure a production KYC provider.** Implement its production adapter and verification flow; the current development adapter only creates pending references. Keep identity documents with the vendor. See [provider KYC adapter](server/src/modules/providers/kyc-adapter.js) and [launch requirements](README.md#current-scope-and-launch-status).
- [ ] **Complete Razorpay Checkout and Route setup.** Obtain approvals, configure server credentials and webhook secret, set the production webhook URL, and link provider accounts. Keep account IDs and secrets private. See [payment setup](README.md#payments-and-chat).
- [ ] **Set marketplace policy values in admin settings.** Decide commission, cancellation/refund rules, checkout timeout, and completion review period before enabling checkout. See [settings and launch requirements](README.md#current-scope-and-launch-status).
- [ ] **Provision production deployment.** Configure the API host and website host, production domain, API URL, allowed origins, and service secrets. The current working tree deletes `render.yaml`; choose either manual Render configuration as documented or restore a deployment manifest. See [deployment notes](README.md#deployment-notes).
- [ ] **Prepare production data and operations.** Configure MongoDB/Atlas network access, backups and restore drills, monitoring and alerts, HTTPS, email delivery, log retention, and incident procedures. See [deployment notes](README.md#deployment-notes).
- [ ] **Complete privacy, terms, and regulatory review.** Publish privacy notices, define data retention/deletion behavior, document payment/refund terms, and review operations against current Indian requirements. See [launch requirements](README.md#current-scope-and-launch-status).
- [ ] **Provision the production admin safely.** Use the one-time bootstrap flow from a trusted environment, then remove the bootstrap password from the environment. Keep demo seeding disabled outside disposable local databases. See [administrator provisioning](README.md#provisioning-an-administrator) and [demo data](README.md#demo-data-local-development-only).
- [ ] **Run Razorpay sandbox integration checks.** Verify checkout, webhook signatures, duplicate and out-of-order events, refunds, and provider transfers before production use. See [payment setup](README.md#payments-and-chat).
- [ ] **Run release checks.** Server tests and website lint/build passed on 15 October 2026. Manually exercise the customer, provider, and admin flows against configured services before release. These checks do not replace production, legal, or infrastructure readiness. See [commands and verification](README.md#commands-and-verification).

## Product and demo follow-ups

- [x] **Add password recovery.** Added email-code recovery with a six-digit, expiring, one-time code, five-attempt limit, generic account-safe request responses, password validation, email sending, and prior-session invalidation. Live email delivery still requires production SMTP configuration. See [login page](website/src/pages/auth/Login.jsx) and [auth routes](server/src/modules/auth/routes.js).
- [x] **Disable booking submission until an available time is selected.** The request button stays disabled while availability loads or no future available slot is selected; server-side validation remains in place. See [service booking form](website/src/pages/ServiceDetail.jsx).
- [x] **Improve demo seed coverage and dates.** Added cleaning, plumbing, and electrical listings, with availability and sample booking dates derived from the `Asia/Kolkata` calendar date. See [demo seed script](server/scripts/seed-demo.js).
- [x] **Visually review the current homepage redesign.** Reviewed desktop and mobile layouts, fixed the reproduced desktop hero/search overlap, and confirmed mobile layout, readability, and keyboard focus visibility. See [homepage](website/src/pages/Home.jsx) and [styles](website/src/App.css).
- [ ] **Add a license if distributing the project as open source.** See [license note](README.md#license).

## Workspace and release housekeeping

- [ ] **Review the pending workspace changes before release.** Confirm the homepage, color, environment example, and README edits are intended; decide whether deleting `render.yaml` is intentional; and decide which untracked deck build files belong in this repository or a separate deliverable.

## Next work: code audit findings

The following P2 issues came from a separate read-only source audit and are intentionally outside the implementation batch above.

- [ ] **Make booking completion and dispute opening race-safe.** Guarded state transitions are implemented in the completion and dispute routes. Add and run a concurrent regression test before marking this task complete. See [booking completion](server/src/modules/bookings/routes.js#L211), [dispute opening](server/src/modules/disputes/routes.js#L29), and [payout resolution](server/src/modules/payments/service.js#L535).
- [ ] **Throttle Socket.IO messages and email notifications.** The `message:send` event can write messages and trigger recipient emails without the Express API rate limiter. Add an account-level message limit and reduce or batch notification emails. See [message socket handling](server/src/modules/messaging/routes.js#L32), [email notification](server/src/modules/messaging/routes.js#L114), and [API limiter](server/src/app.js#L58).
- [ ] **Require re-review when verified provider details change.** Providers can change business names, categories, or service areas while retaining verified status, and admins lack a re-review path for already verified providers. Define which changes revoke verification and add an admin re-review or suspension flow. See [provider profile updates](server/src/modules/providers/routes.js#L47), [admin verification](server/src/modules/admin/routes.js#L59), and [public service listings](server/src/modules/services/routes.js#L137).

