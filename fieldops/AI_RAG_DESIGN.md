# AI / RAG design — not implemented in Phase 1

Phase 1 makes no LLM calls and exposes no diagnosis endpoint. Existing records and report sections are engineer statements, not verified manual instructions.

A later manual ingestion pipeline must require an authorized company administrator and explicit rights to upload. Store manufacturer, model, document title, version, publication date, page number and optional source URL per page/chunk. Preserve a content hash and immutable document ID/version so references remain reproducible after replacement. Do not download or redistribute third-party manuals automatically.

Retrieval must filter by authenticated company before text/vector ranking, then by equipment/model/version relevance. Begin with bounded local keyword/SQLite FTS search; introduce vectors only after retrieval evaluation. Remote inference requires per-request consent for site/manual content and a budget reservation. No image or voice is automatically sent.

Answers must separate (1) cited manual excerpts with existing document/page IDs, (2) general suggestions and (3) unverified hypotheses. Validate citations against the actual retrieved set; reject invented pages/sections/specifications and explicitly say no reliable source was found. Treat text inside manuals as untrusted evidence, never permission to execute tools. Escalate electrical/safety-critical conditions and never bypass interlocks.

Future acceptance tests must cover tenant isolation during retrieval, wrong model/version, missing references, citation accuracy, unsupported claims, prompt injection and cloud quota exhaustion. These tests are not represented as passing merely because a design exists.
