import { useCallback, useEffect, useRef, useState } from 'react';
import { TimeframeDef } from '../../types/market';
import { useMarketStore, ALL_MARKET_PAIRS, detectBaseTF } from '../../store/useMarketStore';
import { useReplayStore } from '../../store/useReplayStore';
import { useUIStore } from '../../store/useUIStore';
import { fetchHistoricalSeries, PROVENANCE_LABELS } from '../../services/historicalApi';
import { checkArchiveDepth } from '../../domain/archive-limits';
import { describeCoverage } from '../../domain/timeframe-coverage';
import { indexAtOrAfter } from '../../domain/candles';
import { TIMEFRAME_DEFS, TimeframeSeconds, intervalLabelFor } from '../../domain/timeframes';

/**
 * Timeframe switching, extracted from a 230-line async closure that lived
 * inside a JSX `onClick`.
 *
 * That single function mixed five unrelated concerns — archive-depth rules,
 * dropdown state, network orchestration, replay re-anchoring and toast copy —
 * with early returns threaded through all of them. Each concern is now a named
 * step, and the archive rules moved to a testable data table
 * (`domain/archive-limits`).
 */

/** Minimum bars of history required before the replay cut to be worth switching. */
const MIN_CONTEXT_BARS = 15;

/**
 * Téléchargement d'unité de temps en cours, s'il y en a un.
 *
 * Au niveau du module, pas du hook : `useTimeframeSwitch()` est instancié deux
 * fois (la barre du haut et la modale de couverture), et il n'y a qu'un
 * graphique. Sans annulation, trois clics rapides (1m → 5m → 15m) lançaient
 * trois requêtes concurrentes et **la plus lente écrasait la plus récente** :
 * l'utilisateur restait sur une granularité qu'il n'avait pas demandée en
 * dernier. C'est le bug que `LiveModal` avait déjà résolu de son côté ; le
 * correctif n'avait pas été repris ici.
 */
let inFlight: AbortController | null = null;

/** Annule le téléchargement en cours et ouvre le suivant. */
function beginExclusiveDownload(): AbortController {
  inFlight?.abort();
  inFlight = new AbortController();
  return inFlight;
}

function endDownload(controller: AbortController): void {
  if (inFlight === controller) inFlight = null;
}
/**
 * Profondeur minimale absolue pour qu'un téléchargement journalier vaille la
 * peine de remplacer les bougies déjà chargées.
 *
 * Un seuil fixe à 500 refusait purement le changement d'unité quand la source
 * ne remontait pas si loin — courant sur les indices synthétiques Deriv. Le
 * critère est désormais relatif : on ne remplace les données locales que si le
 * téléchargement est réellement plus profond.
 */
const MIN_DAILY_BARS = 60;

interface TimeframeSwitch {
  /** Label of the timeframe currently downloading, or null. */
  readonly downloadingTF: string | null;
  readonly selectTimeframe: (timeframe: TimeframeDef) => Promise<void>;
}

export function useTimeframeSwitch(): TimeframeSwitch {
  const [downloadingTF, setDownloadingTF] = useState<string | null>(null);
  const isMountedRef = useRef(true);
  /** Rang du dernier téléchargement lancé par CETTE instance. */
  const ownDownloadRef = useRef(0);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  /** Ignore late writes from a download that outlived the component. */
  const setDownloadingSafely = useCallback((label: string | null) => {
    if (isMountedRef.current) setDownloadingTF(label);
  }, []);

  const selectTimeframe = useCallback(
    async (timeframe: TimeframeDef): Promise<void> => {
      const { showToast, closeAllDropdowns } = useUIStore.getState();
      const market = useMarketStore.getState();
      const replay = useReplayStore.getState();

      const { currentSymbol, baseCandles, baseTF, activeTF, isImported } = market;

      // The wall-clock instant the replay is parked on, if any. Everything
      // below has to preserve it.
      const replayCutEpoch =
        replay.isActive && baseCandles[replay.currentIndex]
          ? baseCandles[replay.currentIndex].time
          : null;

      const isMarketPair = ALL_MARKET_PAIRS.some((p) => p.symbol === currentSymbol);
      // Une paire en ligne peut fournir n'importe quelle granularité ; un
      // fichier ne descend jamais sous sa propre résolution.
      const floorSeconds = isMarketPair ? 0 : baseTF;

      const currentBaseLabel = TIMEFRAME_DEFS.find((d) => d.s === baseTF)?.label ?? '1D';

      // ── 1. Même granularité déjà active et chargée : rien à faire. ──
      if (timeframe.s === activeTF && timeframe.s === baseTF) {
        closeAllDropdowns();
        return;
      }

      // ── 2. Fichiers importés (CSV) : pas de fournisseur en ligne, agrégation locale uniquement. ──
      if (isImported) {
        closeAllDropdowns();
        if (timeframe.s >= baseTF) {
          market.setTimeframe(timeframe.s);
          const aggregated = useMarketStore.getState().displayCandles.length;
          showToast(
            replay.isActive
              ? `Unité de temps : ${timeframe.label}. Quittez le replay pour tout réafficher.`
              : `Unité de temps : ${timeframe.label} · ${aggregated.toLocaleString('fr-FR')} bougies`,
            'info',
            replay.isActive ? 3000 : 2000
          );
          return;
        }

        // Plus fin que la résolution du fichier importé : impossible.
        if (replayCutEpoch !== null) {
          useUIStore.getState().setTimeframeCoverage(
            describeCoverage({
              cause: 'source-resolution',
              symbol: currentSymbol,
              requestedSeconds: timeframe.s,
              currentSeconds: activeTF,
              cutEpoch: replayCutEpoch,
              floorSeconds: baseTF,
            })
          );
          return;
        }
        showToast(
          `${timeframe.label} indisponible : le fichier ${currentSymbol} est en ${currentBaseLabel}. On ne peut pas descendre sous sa résolution.`,
          'warning',
          4500
        );
        return;
      }

      // ── 3. Paires en ligne inconnues du catalogue : repli local si possible. ──
      if (!isMarketPair) {
        closeAllDropdowns();
        if (timeframe.s >= baseTF) {
          market.setTimeframe(timeframe.s);
          return;
        }
        showToast(`${timeframe.label} indisponible pour ${currentSymbol}.`, 'warning', 4000);
        return;
      }

      // ── 4. Unités journalières et supérieures (1D, 1W, 1M). ──
      if (timeframe.s >= TimeframeSeconds.D1) {
        closeAllDropdowns();
        if (baseTF < TimeframeSeconds.D1) {
          // On passe d'un timeframe intraday à l'archive journalière profonde.
          if (await restoreDailyHistory(timeframe, replayCutEpoch)) {
            return;
          }
          // Si le téléchargement journalier n'a rien rapporté de plus, repli sur l'agrégation locale.
          if (timeframe.s >= baseTF) {
            market.setTimeframe(timeframe.s);
            return;
          }
        } else {
          // Déjà en base journalière : mise à l'échelle (ex: 1D -> 1W).
          market.setTimeframe(timeframe.s);
          return;
        }
      }

      // ── 5. Unités intraday natives de même base déjà en mémoire (ex: H1 -> H4 ou H2). ──
      if (
        (baseTF === TimeframeSeconds.H1 && (timeframe.s === TimeframeSeconds.H2 || timeframe.s === TimeframeSeconds.H4)) ||
        (baseTF === TimeframeSeconds.M1 && timeframe.s === TimeframeSeconds.M3)
      ) {
        closeAllDropdowns();
        market.setTimeframe(timeframe.s);
        const aggregated = useMarketStore.getState().displayCandles.length;
        showToast(
          replay.isActive
            ? `Unité de temps : ${timeframe.label}. Quittez le replay pour tout réafficher.`
            : `Unité de temps : ${timeframe.label} · ${aggregated.toLocaleString('fr-FR')} bougies`,
          'info',
          replay.isActive ? 3000 : 2000
        );
        return;
      }

      // ── 6. Téléchargement réel du timeframe demandé (ex: de 1m à 5m, 15m, 30m, 1h, 4h, etc.). ──
      // On télécharge les données réelles du timeframe auprès du fournisseur
      // pour bénéficier de toute la profondeur d'archive et du vrai OHLC/volume,
      // au lieu de juste reconstituer les quelques bougies d'un timeframe inférieur.
      const archive = checkArchiveDepth(timeframe.s, replayCutEpoch);
      if (!archive.allowed) {
        closeAllDropdowns();
        // Si les archives distantes ne descendent pas assez loin pour le replay, mais qu'on a déjà
        // des bougies locales couvrant ce moment et qu'on monte en granularité :
        if (timeframe.s >= baseTF) {
          market.setTimeframe(timeframe.s);
          const aggregated = useMarketStore.getState().displayCandles.length;
          showToast(
            `${archive.message ?? 'Archives distantes insuffisantes.'} Repli sur l'agrégation locale (${aggregated.toLocaleString('fr-FR')} bougies).`,
            'info',
            5000
          );
          return;
        }

        if (replayCutEpoch === null) {
          showToast(archive.message ?? 'Profondeur d’archive insuffisante.', 'warning', 6000);
          return;
        }
        useUIStore.getState().setTimeframeCoverage(
          describeCoverage({
            cause: 'archive-depth',
            symbol: currentSymbol,
            requestedSeconds: timeframe.s,
            currentSeconds: activeTF,
            cutEpoch: replayCutEpoch,
            floorSeconds,
          })
        );
        return;
      }

      closeAllDropdowns();
      const generation = ++ownDownloadRef.current;
      const downloadSuccess = await downloadTimeframe(timeframe, replayCutEpoch, activeTF, setDownloadingSafely);
      if (ownDownloadRef.current === generation) setDownloadingSafely(null);

      // Si le téléchargement échoue mais qu'on peut agréger en local :
      if (!downloadSuccess && timeframe.s >= baseTF) {
        market.setTimeframe(timeframe.s);
        const aggregated = useMarketStore.getState().displayCandles.length;
        showToast(
          `Téléchargement ${timeframe.label} non abouti. Repli sur l'agrégation locale (${aggregated.toLocaleString('fr-FR')} bougies).`,
          'info',
          4000
        );
      }
    },
    // Every dependency is read through `getState()` at call time, so the
    // callback identity stays stable across renders.
    [setDownloadingSafely]
  );

  return { downloadingTF, selectTimeframe };
}

/**
 * Ramène l'historique journalier profond et réancre le replay.
 *
 * @returns `true` si les données ont été remplacées ; `false` si la source
 *   n'avait rien de plus profond que ce qui est déjà chargé — l'appelant
 *   bascule alors sur l'agrégation locale plutôt que d'annuler la demande.
 */
async function restoreDailyHistory(
  timeframe: TimeframeDef,
  replayCutEpoch: number | null
): Promise<boolean> {
    const { showToast } = useUIStore.getState();
    const market = useMarketStore.getState();
    const symbol = market.currentSymbol;

    const anchorReplay = (candles: readonly { time: number }[]) => {
      if (replayCutEpoch === null) return;
      const found = indexAtOrAfter(candles as never, replayCutEpoch);
      const index = found !== -1 ? found : candles.length - 1;
      useReplayStore.setState({ isActive: true, currentIndex: index, startIndex: index, furthestIndex: index });
    };

    // Already cached in memory: no download needed.
    if (market.restoreDailyDataset(timeframe.s)) {
      const restored = useMarketStore.getState().baseCandles;
      anchorReplay(restored);
      showToast(
        `Historique 1 jour restauré · ${restored.length.toLocaleString('fr-FR')} bougies`,
        'success',
        3000
      );
      return true;
    }

    showToast(`Restauration de l’historique 1 jour de ${symbol}…`, 'info', 2500);

    const controller = beginExclusiveDownload();
    let series;
    try {
      series = await fetchHistoricalSeries({
        symbol,
        interval: '1d',
        range: 'max',
        // Restoring history must never substitute generated candles.
        allowSimulated: false,
        signal: controller.signal,
      });
    } catch {
      // Annulé par une demande plus récente : ne rien écrire, ne rien dire.
      return true;
    } finally {
      endDownload(controller);
    }

    // Une demande plus récente a pris la main pendant l'attente : sa réponse
    // fait foi, celle-ci ne doit plus toucher au store.
    if (controller.signal.aborted) return true;

    // Combien de bougies journalières l'agrégation locale donnerait-elle ?
    // Inutile de remplacer les données chargées par un historique plus court.
    const loaded = market.baseCandles;
    const localDailyBars =
      loaded.length >= 2
        ? Math.ceil((loaded[loaded.length - 1].time - loaded[0].time) / TimeframeSeconds.D1)
        : 0;

    if (series.candles.length < Math.max(MIN_DAILY_BARS, localDailyBars)) {
      return false;
    }

    useMarketStore.getState().setBaseCandles(series.candles, TimeframeSeconds.D1, false);
    useMarketStore.getState().setTimeframe(timeframe.s);
    useMarketStore.getState().setDataSource(`Données réelles · ${PROVENANCE_LABELS[series.provenance]}`, false);
    anchorReplay(series.candles);

    showToast(
      `Historique 1 jour restauré · ${series.candles.length.toLocaleString('fr-FR')} bougies · ${PROVENANCE_LABELS[series.provenance]}`,
      'success',
      3500
    );
    return true;
}

/** Download a finer series, anchored on the replay cut when there is one. */
async function downloadTimeframe(
  timeframe: TimeframeDef,
  replayCutEpoch: number | null,
  currentBaseSeconds: number,
  setDownloading: (label: string | null) => void
): Promise<boolean> {
    const { showToast } = useUIStore.getState();
    const symbol = useMarketStore.getState().currentSymbol;
    const interval = intervalLabelFor(timeframe.s);

    const controller = beginExclusiveDownload();

    setDownloading(timeframe.label);
    showToast(
      replayCutEpoch
        ? `Recherche du ${timeframe.label} au ${new Date(replayCutEpoch * 1000).toLocaleDateString('fr-FR')}…`
        : `Téléchargement de ${symbol} en ${timeframe.label}…`,
      'info',
      timeframe.s <= TimeframeSeconds.M1 ? 5000 : 3000
    );

    try {
      const series = await fetchHistoricalSeries({
        symbol,
        interval,
        range: 'max',
        targetTimestamp: replayCutEpoch ?? undefined,
        // A timeframe switch must fail visibly rather than swap real history
        // for a generated series.
        allowSimulated: false,
        signal: controller.signal,
      });

      // Une demande plus récente a pris la main : sa réponse fait foi.
      if (controller.signal.aborted) return false;

      const { candles } = series;
      if (candles.length === 0) {
        const tried = series.attempted.map((a) => PROVENANCE_LABELS[a]).join(', ') || 'aucune';
        showToast(
          `${timeframe.label} indisponible pour ${symbol}. Sources essayées : ${tried}.`,
          'warning',
          5000
        );
        return false;
      }

      const detectedTF = detectBaseTF(candles);
      const effectiveTF = Math.max(timeframe.s, detectedTF);

      if (replayCutEpoch === null) {
        useMarketStore.getState().setBaseCandles(candles, detectedTF);
        useMarketStore.getState().setTimeframe(effectiveTF);
        useMarketStore.getState().setDataSource(`Données réelles · ${PROVENANCE_LABELS[series.provenance]}`, false);
        showToast(
          `${symbol} en ${timeframe.label} · ${candles.length.toLocaleString('fr-FR')} bougies · ${PROVENANCE_LABELS[series.provenance]}`,
          'success',
          4000
        );
        return true;
      }

      // ── Replay is running: the new series must actually cover the cut. ──
      const coverage = checkReplayCoverage(candles, replayCutEpoch);
      if (!coverage.ok) {
        // Ici la fenêtre réelle du flux est connue : elle vaut mieux que la
        // règle générique, et c'est elle qu'on montre.
        useUIStore.getState().setTimeframeCoverage(
          describeCoverage({
            cause: coverage.cause,
            symbol,
            requestedSeconds: timeframe.s,
            currentSeconds: currentBaseSeconds,
            cutEpoch: replayCutEpoch,
            window: { fromEpoch: candles[0].time, toEpoch: candles[candles.length - 1].time },
            contextBars: coverage.contextBars,
          })
        );
        return false;
      }

      useMarketStore.getState().setBaseCandles(candles, detectedTF);
      useMarketStore.getState().setTimeframe(effectiveTF);
      useMarketStore.getState().setDataSource(`Données réelles · ${PROVENANCE_LABELS[series.provenance]}`, false);
      useReplayStore.setState({
        isActive: true,
        currentIndex: coverage.index,
        startIndex: coverage.index,
        // New series, new index space: the cursor is the edge of what was seen.
        furthestIndex: coverage.index,
      });

      showToast(
        `${symbol} en ${timeframe.label}, synchronisé au ${new Date(replayCutEpoch * 1000).toLocaleDateString('fr-FR')}`,
        'success',
        3500
      );
      return true;
    } catch (error) {
      // Une annulation n'est pas une panne : elle vient d'un clic plus récent,
      // qui affiche déjà son propre message.
      if (controller.signal.aborted) return false;
      console.warn('[Topbar] timeframe download failed:', error);
      showToast(`Erreur lors du téléchargement en ${timeframe.label}`, 'error', 3000);
      return false;
    } finally {
      endDownload(controller);
      // Ne pas éteindre l'indicateur d'une demande qui, elle, tourne encore.
      if (!controller.signal.aborted) setDownloading(null);
    }
}

type CoverageResult =
  | { readonly ok: true; readonly index: number }
  | {
      readonly ok: false;
      /** Laquelle des deux impossibilités : hors fenêtre, ou fenêtre trop courte. */
      readonly cause: 'feed-window' | 'not-enough-context';
      readonly contextBars: number | null;
    };

/** Does a freshly downloaded series contain the replay cut, with context before it? */
function checkReplayCoverage(
  candles: readonly { time: number }[],
  replayCutEpoch: number
): CoverageResult {
  const firstTime = candles[0].time;
  const lastTime = candles[candles.length - 1].time;

  if (replayCutEpoch < firstTime || replayCutEpoch > lastTime) {
    return { ok: false, cause: 'feed-window', contextBars: null };
  }

  const index = indexAtOrAfter(candles as never, replayCutEpoch);
  if (index < MIN_CONTEXT_BARS) {
    return { ok: false, cause: 'not-enough-context', contextBars: Math.max(0, index) };
  }

  return { ok: true, index };
}
