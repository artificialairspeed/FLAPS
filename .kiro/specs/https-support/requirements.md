# Requirements Document

## Introduction

This document defines the requirements for adding HTTPS support to the FLAPS (Fibonacci Lean Agile Pointing System) application hosted at `deployflaps.app`. The solution places Caddy as a reverse proxy in front of the existing Node.js/Express/Socket.io server. Caddy handles TLS termination, automatic certificate provisioning and renewal via Let's Encrypt, HTTP-to-HTTPS redirection, and WebSocket proxying. A process manager (pm2) is introduced to keep the Node process alive across reboots. No changes are required to `server.js`.

## Glossary

- **Caddy**: The open-source web server and reverse proxy responsible for TLS termination, HTTP-to-HTTPS redirection, and proxying traffic to the Node process.
- **Node_Process**: The existing Node.js/Express/Socket.io application running on `localhost:3000`.
- **pm2**: The Node.js process manager that supervises the Node_Process and restarts it on crash or system reboot.
- **Let's_Encrypt**: The free, automated certificate authority used by Caddy to obtain and renew TLS certificates via the ACME protocol.
- **Caddyfile**: The configuration file for Caddy, located at `/etc/caddy/Caddyfile`.
- **Ecosystem_Config**: The pm2 configuration file (`ecosystem.config.cjs`) that defines how the Node_Process is started and managed.
- **ACME_Challenge**: The HTTP-01 challenge mechanism used by Let's Encrypt to verify domain ownership before issuing a certificate.
- **WSS**: WebSocket Secure — the WebSocket protocol over TLS, used by Socket.io clients connecting via HTTPS.
- **VPS**: The virtual private server (Hostinger) on which the application is deployed.

---

## Requirements

### Requirement 1: HTTP-to-HTTPS Redirection

**User Story:** As a user visiting the site over plain HTTP, I want to be automatically redirected to HTTPS, so that my connection is always encrypted without needing to type `https://` manually.

#### Acceptance Criteria

1. WHEN a client sends an HTTP request to port 80, THE Caddy SHALL respond with a 301 Moved Permanently redirect to the equivalent HTTPS URL, where "equivalent" means the same host, path, and query string with the scheme changed to `https`.
2. WHEN a client sends an HTTP request to port 80 with a path and query string, THE Caddy SHALL preserve the original request path and query string unchanged in the redirect Location header.
3. WHILE Caddy is running, THE Caddy SHALL redirect all HTTP requests on port 80 regardless of the request path.

---

### Requirement 2: TLS Termination on Port 443

**User Story:** As a user, I want the site to be served over HTTPS with a valid certificate, so that my browser shows a padlock and my data is encrypted in transit.

#### Acceptance Criteria

1. WHEN a client connects to port 443, THE Caddy SHALL terminate TLS using a certificate for `deployflaps.app` that is not expired, issued by a publicly trusted CA, and has a Subject Alternative Name matching `deployflaps.app`.
2. THE Caddy SHALL negotiate TLS 1.2 and TLS 1.3 and SHALL reject connections that request TLS 1.1, TLS 1.0, or SSL.
3. THE Caddy SHALL include a `Strict-Transport-Security` header with a `max-age` of at least 31536000 seconds in all HTTPS responses.
4. WHEN a client completes a TLS handshake, THE Caddy SHALL proxy the decrypted request to the Node_Process at `localhost:3000` over plain HTTP.

---

### Requirement 3: Automatic Certificate Provisioning and Renewal

**User Story:** As a site operator, I want TLS certificates to be obtained and renewed automatically, so that the site never goes down due to an expired certificate.

#### Acceptance Criteria

1. WHEN Caddy starts for the first time with a valid Caddyfile, THE Caddy SHALL automatically obtain a TLS certificate for `deployflaps.app` from Let's_Encrypt using the ACME HTTP-01 challenge on port 80.
2. WHEN a certificate has fewer than 30 days remaining before expiration, THE Caddy SHALL automatically initiate renewal with Let's_Encrypt without requiring a restart or manual intervention.
3. WHEN a certificate is renewed, THE Caddy SHALL hot-reload the new certificate within 60 seconds without dropping active connections.
4. THE Caddy SHALL store certificates in a directory accessible only to the `caddy` system user, with no read or write access granted to the Node_Process user.
5. IF the ACME challenge fails because port 80 is not reachable from the internet, THEN THE Caddy SHALL log an error entry within 120 seconds that includes the challenge type (HTTP-01), the domain (`deployflaps.app`), and the reason for failure.
6. IF initial certificate acquisition fails, THEN THE Caddy SHALL retry up to 3 times at 60-second intervals before entering a failed state and logging the final error.

---

### Requirement 4: Reverse Proxy for HTTP Traffic

**User Story:** As a user, I want all application pages and assets to load correctly over HTTPS, so that the site functions identically to how it did over HTTP.

#### Acceptance Criteria

1. WHEN Caddy receives an HTTPS request, THE Caddy SHALL forward the request to the Node_Process at `localhost:3000` and return the Node_Process response to the client with the original HTTP status code and response body unmodified.
2. WHEN Caddy forwards a request to the Node_Process, THE Caddy SHALL set the `X-Forwarded-Proto` and `Host` headers to the values from the incoming request, and SHALL append the client IP address to the `X-Forwarded-For` header.
3. THE Node_Process SHALL continue to listen on `localhost:3000` over plain HTTP with no changes to `server.js`.
4. IF the Node_Process is not accepting connections on `localhost:3000`, THEN THE Caddy SHALL return a 502 Bad Gateway response to the client.
5. WHEN Caddy receives an HTTP request on port 80, THE Caddy SHALL redirect the client to the equivalent HTTPS URL with a 301 permanent redirect response.

---

### Requirement 5: WebSocket Proxying over WSS

**User Story:** As a user in a planning session, I want Socket.io to work over the secure connection, so that real-time voting and room state updates continue to function after the HTTPS migration.

#### Acceptance Criteria

1. WHEN a client sends an HTTP Upgrade request for a WebSocket connection over HTTPS, THE Caddy SHALL forward the Upgrade headers to the Node_Process and establish a bidirectional WebSocket tunnel.
2. WHEN a WebSocket tunnel is established through Caddy, THE Node_Process SHALL receive and process Socket.io events with the same event type, payload, and delivery order as a direct WebSocket connection.
3. THE Caddy SHALL pass WebSocket upgrade requests to `localhost:3000` without requiring any changes to the Socket.io server configuration.
4. WHEN Socket.io clients connect using a relative URL (e.g., `io()` with no explicit URL), THE Node_Process SHALL accept the connection proxied through Caddy over WSS.
5. IF the Node_Process is unavailable when a WebSocket upgrade is requested, THEN THE Caddy SHALL return a 502 Bad Gateway response and SHALL NOT leave the connection in a hanging state.

---

### Requirement 6: Node Process Management with pm2

**User Story:** As a site operator, I want the Node process to restart automatically after a crash or VPS reboot, so that the site remains available without manual intervention.

#### Acceptance Criteria

1. THE pm2 SHALL supervise the Node_Process using the Ecosystem_Config and restart it automatically if it crashes.
2. WHEN the VPS reboots, THE pm2 SHALL start the Node_Process automatically within 60 seconds without manual intervention.
3. THE Ecosystem_Config SHALL configure the Node_Process with `PORT=3000` and `NODE_ENV=production` environment variables.
4. THE pm2 SHALL provide access to Node_Process logs via `pm2 logs flaps`.
5. THE pm2 SHALL expose Node_Process status (online, stopped, errored, PID, uptime, restart count) via `pm2 status`.
6. IF the Node_Process crashes, THEN THE pm2 SHALL restart it and increment the restart counter in the process descriptor.

---

### Requirement 7: Caddy Service Persistence

**User Story:** As a site operator, I want Caddy to start automatically on VPS reboot, so that HTTPS traffic is handled without manual intervention after a restart.

#### Acceptance Criteria

1. THE Caddy service SHALL be registered with systemd and enabled to start automatically on boot, such that `systemctl is-enabled caddy` returns `enabled`.
2. WHEN the VPS completes its boot sequence, THE Caddy service SHALL reach an active running state and have ports 80 and 443 open and accepting TCP connections within 60 seconds.
3. IF the Caddy service stops unexpectedly after boot, THEN the system SHALL automatically attempt to restart it, with a maximum of 3 restart attempts before the service enters a failed state.

---

### Requirement 8: Network and Firewall Configuration

**User Story:** As a site operator, I want only the necessary ports exposed to the internet, so that the server attack surface is minimized.

#### Acceptance Criteria

1. THE VPS firewall SHALL allow inbound traffic on port 80 (HTTP/ACME) from the internet.
2. THE VPS firewall SHALL allow inbound traffic on port 443 (HTTPS) from the internet.
3. THE VPS firewall SHALL block direct external access to port 3000, and THE Node_Process SHALL bind port 3000 to `127.0.0.1` only, so that the Node_Process is only reachable via Caddy on the loopback interface.
4. IF the ACME HTTP-01 challenge fails because port 80 is not reachable, THEN THE Caddy SHALL log an error entry indicating the ACME challenge failure and the domain affected.
5. IF a TLS handshake on port 443 cannot be completed because the port is not reachable, THEN THE Caddy SHALL log an error entry indicating the TLS handshake failure and the client address.

---

### Requirement 9: No Regression to Existing Application Behavior

**User Story:** As a developer, I want the existing unit and property tests to continue passing after the HTTPS migration, so that I can confirm the application logic is unaffected.

#### Acceptance Criteria

1. IF the HTTPS migration has been applied, THEN THE Node_Process SHALL serve all existing routes (`/`, `/room/:roomId`, and static assets from `public/`) with the same HTTP status code and response body as before the migration.
2. WHEN the existing test suite (`server.unit.test.js`, `public/app.property.test.js`) is executed against the Node_Process directly, THE Node_Process SHALL pass all tests without modification to the test files themselves.
3. THE Node_Process SHALL require no changes to `server.js` as a result of the HTTPS migration.

---

### Requirement 10: Certificate Security and Key Isolation

**User Story:** As a site operator, I want TLS private keys to be inaccessible to the application process, so that a compromise of the Node process does not expose the certificate private key.

#### Acceptance Criteria

1. THE Caddy SHALL store TLS private keys in a directory owned by and accessible only to the `caddy` system user, with file permissions set to prevent read access by any other user or process.
2. THE Node_Process SHALL have no access to TLS certificate files or private keys.
3. THE Node_Process SHALL contain no certificate paths, private key material, or TLS configuration in `server.js` or any application code.
