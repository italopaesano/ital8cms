<!-- ital8doc v1-1 · tipo: README · lang: en · stub -->
> 🌐 This document is maintained in Italian → see `README.it.md`. The English edition will be filled in at release.
# sentinel

> English translation pending. Authoritative version: [`README.it.md`](./README.it.md).

Incoming request filter. Classifies traffic with declarative rules **before the
router**, records what it sees in its own JSONL log, and derives a passive HTTP
fingerprint used to tell a client that lies about its User-Agent from one that
does not.

**Ships in observation mode: out of the box it blocks nothing.** Enforcement is a
deliberate promotion you make after reading your own data.
