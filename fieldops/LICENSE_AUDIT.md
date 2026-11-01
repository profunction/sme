# Dependency license review — 2026-11-01

Public upstream license files and exact pub.dev package archives were inspected before integration. Pub archives were verified against their registry SHA-256 metadata. No equipment manuals, model weights, microphone recordings or site photos were downloaded. This is an engineering review, not legal approval.

| Dependency | Version/source | Observed license / decision |
|---|---|---|
| http | [1.6.0](https://pub.dev/packages/http/versions/1.6.0) | BSD-3-Clause; adopt; registry archive SHA-256 verified |
| sqflite | [2.4.5](https://pub.dev/packages/sqflite/versions/2.4.5) | BSD-2-Clause; adopt; registry archive SHA-256 verified |
| sqflite_common_ffi | [2.4.5](https://pub.dev/packages/sqflite_common_ffi/versions/2.4.5) | BSD-2-Clause; adopt; registry archive SHA-256 verified |
| path | [1.9.1](https://pub.dev/packages/path/versions/1.9.1) | BSD-3-Clause; adopt; registry archive SHA-256 verified |
| path_provider | [2.1.6](https://pub.dev/packages/path_provider/versions/2.1.6) | BSD-3-Clause; transitive / reference; not a direct dependency; registry archive SHA-256 verified |
| flutter_secure_storage | [11.2.0](https://pub.dev/packages/flutter_secure_storage/versions/11.2.0) | BSD-3-Clause; adopt; registry archive SHA-256 verified |
| pdf | [3.13.1](https://pub.dev/packages/pdf/versions/3.13.1) | Apache-2.0; transitive / reference; not a direct dependency; registry archive SHA-256 verified |
| printing | [5.15.1](https://pub.dev/packages/printing/versions/5.15.1) | Apache-2.0; adopt; registry archive SHA-256 verified |
| flutter/flutter | [flutter/flutter](https://raw.githubusercontent.com/flutter/flutter/HEAD/LICENSE) | BSD family; adopt existing framework/runtime; preserve notices |
| fastapi/fastapi | [fastapi/fastapi](https://raw.githubusercontent.com/fastapi/fastapi/HEAD/LICENSE) | MIT; adopt existing framework/runtime; preserve notices |
| encode/uvicorn | [encode/uvicorn](https://raw.githubusercontent.com/encode/uvicorn/HEAD/LICENSE.md) | BSD family; adopt existing framework/runtime; preserve notices |
| MrBitBucket/reportlab-mirror | [MrBitBucket/reportlab-mirror](https://raw.githubusercontent.com/MrBitBucket/reportlab-mirror/HEAD/LICENSE) | BSD family; adopt existing framework/runtime; preserve notices |
| psf/requests | [psf/requests](https://raw.githubusercontent.com/psf/requests/HEAD/LICENSE) | Apache-2.0; not adopted (stdlib HTTP installer used) |

Flutter 3.44.0's BSD license/tag was checked. The current pub packages require Dart 3.12 / Flutter 3.44, so the mobile toolchain must meet that baseline. Native secure-storage plugins use OS Keychain/Android platform services; distribution must retain notices and review platform entitlements and backup settings. Flutter's license registry can display bundled dependency notices; complete transitive license and advisory review is still required for a production lockfile.

Python runtime dependencies reuse the existing project's pinned FastAPI 0.162.0, uvicorn 0.54.0, ReportLab 4.4.5 and pydantic 2.14.2; see the parent inventory for their installed distributions. SQLite is supplied by the runtime and has an upstream public-domain policy. ReportLab fonts have separate notices. Test tooling is not a runtime service. The FieldOps requirements currently pin direct packages, not the full transitive Python graph; repeat advisory checks and lock transitive dependencies before production.

No AGPL automation engine, vector database, speech model, commercial SDK, manufacturer manual or model weights are bundled in Phase 1. PostgreSQL, S3-compatible storage, speech recognition and RAG are future integration decisions with their own licensing and security reviews. The project owner still needs to choose the application's own distribution/license terms.
