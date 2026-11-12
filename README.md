This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Manual customer contact synchronization

The contact-only batch endpoint is disabled unless
`GHL_CUSTOMER_CONTACT_SYNC_ENABLED=true`. Do not enable it until the existing
customer contact sync safeguards and GHL configuration have been validated;
the flag also affects existing contact-writing workflows. There is no scheduler.

An active staff administrator can invoke one batch from a same-origin browser
session by sending a JSON POST to `/api/staff/admin/customer-contact-sync`, for
example:

```js
fetch("/api/staff/admin/customer-contact-sync", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ limit: 5 }),
}).then((response) => response.json()).then(console.log);
```

The only accepted option is `limit`, an integer from 1 to 10 (default 5).
The response contains counts only. `processed` counts processor calls, not
necessarily newly acquired claims; `succeeded` includes contacts already
verified as synced by a concurrent invocation. `skipped` counts unavailable
claims or a processor disabled mid-run, and `needsReconciliation` requires
manual review rather than automatic reposting. An unexpected error or interrupted
request may leave a claim for the existing lease/reconciliation safeguards to
handle. Keep batches small enough for the deployment's request timeout.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
