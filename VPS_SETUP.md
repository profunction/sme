# Initial VPS target

Ubuntu LTS, 2 vCPU, 4 GB RAM and 40+ GB SSD are an initial measurement target, not a customer-capacity guarantee. Install maintained Docker Engine/Compose after owner approval. Use a non-root SSH account with public-key authentication; verify key access before disabling password login. Allow only required SSH and 80/443 in the host/provider firewall. Never publish 5432. Keep .env and signing keys private, review Docker group root-equivalence and pin/update images through reviewed releases. No Kubernetes or GPU is required.


Status: development deployment foundation. No VPS was purchased or provisioned. No production database, DNS, payment or traffic was changed. PostgreSQL/container/restore/migration integration has not yet been executed; do not infer success from configuration files. Existing authority regression tests use SQLite.
