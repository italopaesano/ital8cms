<!-- ital8doc v1-1 · tipo: EXPLAIN · lang: en · stub -->
# admin — Technical deep-dive

> 🇮🇹 The reference edition is [`EXPLAIN.it.md`](./EXPLAIN.it.md) (Italian, always
> up to date). This English page is a stub until release.

Covers the Git-repo installation subsystem (`pluginsInstall.js` /
`themesInstall.js`): the `.default`-only contract for installable packages, the
job phases, rollback behaviour, why the plugin and theme installers are
deliberately parallel rather than shared, and the clone security model.
