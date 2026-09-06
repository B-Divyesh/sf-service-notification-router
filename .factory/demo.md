# Demo sandbox

Open <https://service-notification-router.sociobot.in/demo> or select **Try it
with sample data** on the first screen.

The demo contains three bookings for Harbor Health:

- Dental cleaning routed to Sofia Mendes by email.
- Prenatal consultation routed to Amina Yusuf by webhook and acknowledged.
- New patient assessment left unmatched so the missing-rule state is visible.

It also contains two recipients and two routing rules. The banner reads **Demo
— sample data, nothing is saved** on every demo screen. **Reset demo** restores
the original sample. **Start for real** discards the browser's sample workspace
identifier, deletes the in-memory workspace, and returns to the real entry
point. If that deletion request cannot reach the server, the workspace still
expires after 24 hours.

`POST /api/demo` creates a random in-memory workspace with a 24-hour TTL. The
identifier is stored in `sessionStorage` under
`demo:service-notification-router:workspace`. Demo requests use only
`/api/demo/<id>` and `/api/demo/<id>/reset`; they never open or write SQLite.
The backend regression test compares real booking row counts before and after a
demo session.
