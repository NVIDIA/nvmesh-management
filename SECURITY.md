<!--
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
SPDX-License-Identifier: Apache-2.0
-->

# Security Policy: NVMesh Management

NVIDIA is dedicated to the security and trust of our software products and
services, including all source code repositories managed through our
organization.

## Reporting a Vulnerability

If you discover a potential security vulnerability in this project, please
**do not open a public issue or pull request.**

* Report via: [NVIDIA Vulnerability Disclosure Program](https://www.nvidia.com/en-us/security/) (preferred)
* E-Mail: [psirt@nvidia.com](mailto:psirt@nvidia.com)
  - We encourage you to use the following PGP key for secure email communication:
    [NVIDIA public PGP Key](https://www.nvidia.com/en-us/security/pgp-key)
* GitHub: Use the repository **Security** tab > **Report a vulnerability** to
  submit a private report directly on the repository.

Please include the following information:
- Product/project name and version/branch that contains the vulnerability
- Type of vulnerability (e.g., authentication bypass, injection, information
  disclosure, denial of service)
- Step-by-step reproduction instructions
- Proof-of-concept code (if available)
- Impact assessment, including how an attacker could exploit the issue

**Detailed reports help NVIDIA evaluate and address issues faster.**

NVIDIA's PSIRT team will acknowledge receipt, validate severity, develop fixes,
and publish security bulletins as appropriate under our coordinated
vulnerability disclosure policy. While NVIDIA does not currently operate a bug
bounty program, we offer acknowledgement when an externally reported issue is
addressed. See the
[PSIRT policies page](https://www.nvidia.com/en-us/security/psirt-policies/) for
details.

## Security Architecture & Context

NVMesh Management is the management/control-plane server for NVMesh, NVIDIA's
software-defined distributed block storage. It is an Express (Node.js)
application that exposes a REST and WebSocket API, persists cluster
configuration and user accounts in MongoDB, issues control commands to storage
target and client nodes over Kafka, and serves a server-rendered (EJS) plus
React frontend. Administrators use it to define storage, manage users and
encryption keys, and monitor the health and performance of the cluster.

This software operates at the **Service** (control-plane) level. Its primary
security responsibility is to authenticate and authorize operators, protect
user credentials and encryption-key material, and act as a trusted control
point that drives the state of the storage cluster (volumes, disks, servers,
upgrades).

**Repository Exposure Classification:** Public.
Basis: the project is Apache-2.0 licensed and published as an open-source mirror
on a public host, so this document is world-readable and is written to
public-safe detail.

**Service Exposure Classification:** External / Regulated (high confidence).
Basis: externally distributed, customer-deployed enterprise storage
control-plane that authenticates users and handles credentials, encryption
keys, and TLS material, and serves as a production security boundary for a
storage cluster.

### Key Security Boundaries

- **Client → API (untrusted → trusted).** All REST routers are gated by an
  authentication chain (`isServiceAvailable` → `isAuthenticated` →
  `shouldChangePassword`). Authentication is configurable per deployment as
  either username/password (Passport local strategy) or mutual-TLS client
  certificates. Most routers additionally enforce JSON-schema validation
  (`isValidRequest`/AJV), and sensitive routers (encryption keys, database
  management) require an administrator role.
- **Management ↔ cluster nodes (Kafka).** Control messages to target/client
  agents flow over Kafka, which supports TLS with client certificate, key, CA,
  and optional passphrase.
- **Management ↔ management / GUI (WebSocket & socket.io).** A dedicated
  WebSocket server handles HA/cluster connections (optionally mutual-TLS), and
  socket.io delivers realtime events to the GUI.
- **Management ↔ MongoDB.** Cluster configuration, user accounts, encryption
  keys, and application logs are stored in MongoDB.
- **Host filesystem.** TLS certificates/keys and runtime state are read from and
  written to the local filesystem; certificates can be reloaded at runtime.

### Threat Model

The following scenarios represent the primary security concerns for this
project (including auxiliary/support code). They are ordered roughly by
severity/likelihood.

1. **Session forgery via non-per-deployment session secret (development-only
   credentials mode):** The username/password login path is a development-only
   configuration; production deployments authenticate with mutual-TLS client
   certificates, which are validated per request. In the development-only
   credentials mode, the Express session layer signs session cookies with a
   build-time constant rather than a value generated per deployment, so an
   attacker able to learn it could forge or tamper with session cookies. This
   does not apply to production mutual-TLS deployments, where per-request
   certificate validation gates access regardless of session state.
2. **Privilege escalation through admin-gated control surfaces:** Routers that
   expose encryption keys and MongoDB replica-set/database management rely on
   administrator-role middleware. A defect in role assignment, session
   validation, or a future route mounted without the admin gate would expose
   key material and database control to a non-administrative authenticated user.
3. **Injection/DoS via routers without schema validation:** While most routers
   validate request bodies against AJV schemas, several control-plane routers
   (cluster, management-cluster, backups, metadata, technician, Kafka, and
   database routers) are mounted without the shared validation middleware.
   Malformed or hostile payloads reaching the MongoDB queries or Kafka messages
   those handlers build are a NoSQL-injection and denial-of-service surface.
4. **Cluster-control compromise over Kafka/WebSocket when transport is not
   secured:** The server issues authoritative volume/disk/server commands to
   nodes over Kafka and exchanges HA traffic over WebSocket. These channels
   depend on TLS/mutual-TLS being enabled and correctly configured. If transport
   security is disabled or mutual-TLS is not enforced, an on-path attacker on
   the cluster network could inject control messages or read sensitive data.
5. **Information disclosure via verbose errors and diagnostics:** A development
   error handler returns error messages and error objects to clients when the
   service is not in production mode, and signal-triggered state dumps and
   internal-state serialization write connection, session, and topology details
   to disk/logs. Running outside production mode, or unauthorized access to dump
   output, can leak sensitive operational detail.

### Critical Security Assumptions

The following describe what NVMesh Management assumes is handled by another
layer and therefore does **not** fully protect against on its own:

- **Database protection is the deployment's responsibility.** The service stores
  cluster configuration, encryption-key material, user accounts, and application
  logs in MongoDB and does not encrypt these at rest itself, so it assumes the
  operator protects the MongoDB instance, its backups, and the `keys` collection
  at rest and in transit.
- **Trusted transport or correctly configured TLS.** With TLS/mutual-TLS
  disabled, the service assumes the network between it, MongoDB, Kafka brokers,
  and cluster nodes is trusted; it does not itself guarantee confidentiality or
  peer authentication on those links unless TLS is enabled and configured.
- **Correct production configuration.** The service assumes operators enable
  production mode so that error objects and verbose error responses are not
  returned to API clients.
- **Host hardening and process isolation.** The service assumes the host OS
  protects on-disk certificate/key files and state-dump directories and
  enforces process isolation; it reads TLS material from the filesystem without
  additional protection.
- **Pre-authenticated, authorized callers and a trustworthy CA.** API consumers
  are assumed to be authenticated and authorized by the configured method. In
  mutual-TLS mode any certificate that chains to the configured CA is trusted,
  so the CA is assumed to sign certificates only for legitimate operators and
  nodes.
- **Trusted upstream agents.** Kafka messages from target/client agents drive
  volume/disk/cluster state changes and are acted upon as authoritative; the
  service assumes those upstream components are trusted and not impersonated.
- **External network controls.** The application provides no CORS policy, rate
  limiting, or request throttling of its own, so it assumes the deployment
  fronts it with appropriate network controls (firewalling, reverse proxy, and
  similar).

## Supported Versions

Security fixes are delivered as part of supported NVMesh releases. Operators
should run a currently supported release to receive security updates. Report
suspected vulnerabilities against the specific version/branch in use as
described in [Reporting a Vulnerability](#reporting-a-vulnerability).

## Deployment & Hardening Notes

- Enable TLS for the REST and WebSocket servers, and enable mutual-TLS where the
  deployment requires authenticated peers.
- Run the service in production mode so verbose error responses are disabled.
- Restrict network access to the API, MongoDB, and Kafka endpoints to trusted
  operators and cluster networks.
- Protect database backups and on-disk certificate/key material with host-level
  access controls.
- Limit administrator-role accounts to the minimum set of operators.
