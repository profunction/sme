# Digital workforce — Phase 6

Employees have name, role, instructions, allowed tools, per-connector read/write permissions, monthly AI spending limit, assigned-job quota, active status and approval policy. Employees can be created/edited in Employees, selected in chat, and assigned deterministic jobs. Instructions are system context for chat, not permission grants and never executable code. The chatbot does not autonomously spawn jobs.

Task assignments persist employee ID and the exact employee configuration. Changing instructions/permissions/active status invalidates already queued/pending assigned jobs at execution. Consequential tools always need human approval even when an employee's general approval toggle is off. Connector writes require both employee permission and connector write permission, plus approval bound to the connector configuration snapshot.

Employee cloud costs are checked inside the company reservation transaction and attributed through usage_owners. Company and employee spending caps both apply. Assigned-job quotas count attempted assignments (including cancelled/failed work), not just successes. Local admin tasks remain distinguishable from employee tasks. Chat instructions are not a substitute for backend checks. This is a single-company desktop workforce, not multi-tenant user authentication or a continuously autonomous AI scheduler.
