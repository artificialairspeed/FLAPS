# Implementation Plan: HTTPS Support

## Overview

Enable HTTPS for `deployflaps.app` by configuring a custom domain in Railway (which handles TLS automatically) and pointing DNS in Hostinger to Railway. No Caddy, no VPS, no pm2 required. The Node.js app code requires no changes.

## Tasks

- [x] 1. Revert `server.js` to listen on all interfaces
  - Removed the `127.0.0.1` binding added in error — Railway manages networking and requires the server to listen on `0.0.0.0` (the default when no host is passed).
  - _Requirements: 9.3_

- [ ] 2. Add custom domain in Railway
  - In the Railway dashboard, open your FLAPS project → select the service → go to Settings → Domains.
  - Click "Add Custom Domain" and enter `deployflaps.app`.
  - Railway will display a CNAME target value (e.g., `something.up.railway.app`). Copy it.
  - Railway automatically provisions a Let's Encrypt TLS certificate once DNS is verified.
  - _Requirements: 2.1, 2.2, 2.3, 3.1, 3.2, 3.3_

- [ ] 3. Configure DNS in Hostinger
  - Log in to Hostinger → Domains → `deployflaps.app` → DNS / Nameservers.
  - Add or update a CNAME record:
    - **Name/Host:** `@` (or `deployflaps.app`)
    - **Value/Target:** the CNAME value copied from Railway
    - **TTL:** 3600 (or lowest available)
  - Save the record. DNS propagation typically takes a few minutes to up to an hour.
  - _Requirements: 1.1, 1.2, 1.3, 8.1, 8.2_

- [ ] 4. Verify HTTPS is working
  - [ ] 4.1 Verify HTTPS response and certificate
    - Visit `https://deployflaps.app/` in a browser and confirm the padlock is shown and the page loads.
    - Run `curl -I https://deployflaps.app/` and confirm `200 OK`.
    - _Requirements: 2.1, 3.1_
  - [ ] 4.2 Verify HTTP redirects to HTTPS
    - Visit `http://deployflaps.app/` and confirm it redirects to `https://deployflaps.app/`.
    - Or run `curl -I http://deployflaps.app/` and confirm a `301` or `308` redirect to the HTTPS URL.
    - _Requirements: 1.1, 1.2, 1.3_
  - [ ] 4.3 Verify Socket.io works over WSS
    - Open `https://deployflaps.app/` in a browser, create a room, cast votes, and reveal — confirm real-time updates work with no console errors.
    - _Requirements: 5.1, 5.2, 5.4_

- [ ] 5. Final checkpoint
  - Confirm padlock is shown, HTTP redirects to HTTPS, and Socket.io works over WSS.
  - _Requirements: 1.1, 2.1, 5.1_

## Notes

- Tasks 2 and 3 are manual configuration steps in Railway and Hostinger — no code changes required.
- DNS propagation may take a few minutes to an hour before Railway can verify the domain and issue the TLS cert.
- Task 1 is already complete (server.js reverted to listen on all interfaces).

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["2"] },
    { "id": 1, "tasks": ["3"] },
    { "id": 2, "tasks": ["4.1", "4.2", "4.3"] },
    { "id": 3, "tasks": ["5"] }
  ]
}
```
