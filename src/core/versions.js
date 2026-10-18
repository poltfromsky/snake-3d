/** Номера версий вида 1.8.0 и выборка изменений между версиями (для «Что нового»). */

/** Сравнить версии: отрицательное — a старше b, 0 — равны, положительное — a новее. */
export function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

/**
 * Записи списка изменений новее версии since (и не новее upTo, если задана), новые сверху.
 * @param {{versions: {version: string}[]}} changelog
 */
export function changesSince(changelog, since, upTo = null) {
  return (changelog?.versions ?? [])
    .filter((v) => compareVersions(v.version, since) > 0 && (!upTo || compareVersions(v.version, upTo) <= 0))
    .sort((a, b) => compareVersions(b.version, a.version));
}

/** Самая новая версия в списке изменений. */
export function latestVersion(changelog) {
  return changesSince(changelog, '0.0.0')[0]?.version ?? null;
}
