# Security

Keep the API bound to loopback. Use a fresh random NIGHTBREW_SESSION_TOKEN for each session. Health is public; history and chat require bearer authentication. Renderer sandbox, context isolation and disabled Node access are enabled. New windows, navigation and permission requests are denied. Provider errors are sanitized; cloud requires HTTPS and explicit per-message consent. Redirects are disabled to avoid forwarding credentials.

No unrestricted shell execution, file tools or external actions are implemented. Future consequential actions must require human approval. Local SQLite is not encrypted. Backend environment keys are a development mechanism, not Windows Credential Manager integration. No entitlement or payment claim can derive from local data. A security review, CSP hardening, signing, secure updates and Windows Credential Manager remain release requirements.
