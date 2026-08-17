<!-- ital8doc v1-1 · tipo: EXPLAIN · lang: en · stub -->
> 🌐 This document is maintained in Italian → see `EXPLAIN.it.md`. The English edition will be filled in at release.
# adminSentinel — deep-dive

Technical deep-dive for the admin GUI of the `sentinel` request filter: why the
summary is cached on two levels, why reading yields to the event loop, how the
overwrite guard works, and what the form is allowed to touch.

→ [`EXPLAIN.it.md`](./EXPLAIN.it.md)
