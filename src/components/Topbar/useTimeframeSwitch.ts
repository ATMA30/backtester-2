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

      // ── 2. Coarser than the loaded data: aggregate locally, no network. ──
      if (timeframe.s >= baseTF) {
        const returningToDaily =
          !isImported && isMarketPair && timeframe.s >= TimeframeSeconds.D1 && baseTF < TimeframeSeconds.D1;

        closeAllDropdowns();

        // Tenter d'abord l'archive journalière profonde. Si la source n'a rien
        // de plus que les bougies déjà chargées, on agrège localement : la
        // demande de l'utilisateur est légitime, la refuser ne l'est pas.
        if (returningToDaily && (await restoreDailyHistory(timeframe, replayCutEpoch))) {
          return;
        }

        // Imported files and upward aggregation never touch `baseCandles`: the
        // pristine resolution stays, `displayCandles` is what gets rolled up.
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

      // ── 3. Finer than the loaded data: only an online pair can supply it. ──
      if (!isMarketPair) {
        closeAllDropdowns();
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
        // Hors replay il n'y a pas de position à situer : une phrase suffit.
        showToast(
          `${timeframe.label} indisponible : le fichier ${currentSymbol} est en ${currentBaseLabel}. On ne peut pas descendre sous sa résolution.`,
          'warning',
          4500
        );
        return;
      }

      // ── 4. Le fournisseur sert-il cette granularité aussi loin ? ──
      // Ce contrôle ne concerne que le téléchargement. Placé en tête, il
      // refusait aussi l'agrégation locale : demander le 15 min sur un fichier
      // 1 min déjà chargé ne demande pourtant aucun réseau, et se faisait
      // pourtant rejeter dès que le replay était parti loin dans le passé.
      const archive = checkArchiveDepth(timeframe.s, replayCutEpoch);
      if (!archive.allowed) {
        closeAllDropdowns();
        if (replayCutEpoch === null) {
          showToast(archive.message ?? 'Profondeur d’archive insuffisante.', 'warning', 6000);
          return;
        }
        // Un diagnostic, pas un toast : l'utilisateur doit pouvoir lire d'où
        // vient le refus et ce qu'il peut faire, sans course contre la montre.
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
      await downloadTimeframe(timeframe, replayCutEpoch, activeTF, setDownloadingSafely);
      // Le contrôleur est partagé entre instances (barre du haut, diagnostic) :
      // annulé par l'autre, ce téléchargement ne passait jamais par le chemin
      // qui éteint l'indicateur, resté « Chargement… » indéfiniment. Chaque
      // instance éteint le sien, sauf si elle a elle-même relancé depuis.
      if (ownDownloadRef.current === generation) setDownloadingSafely(null);
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
): Promise<void> {
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
      if (controller.signal.aborted) return;

      const { candles } = series;
      if (candles.length === 0) {
        const tried = series.attempted.map((a) => PROVENANCE_LABELS[a]).join(', ') || 'aucune';
        showToast(
          `${timeframe.label} indisponible pour ${symbol}. Sources essayées : ${tried}.`,
          'warning',
          5000
        );
        return;
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
        return;
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
        return;
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
    } catch (error) {
      // Une annulation n'est pas une panne : elle vient d'un clic plus récent,
      // qui affiche déjà son propre message.
      if (controller.signal.aborted) return;
      console.warn('[Topbar] timeframe download failed:', error);
      showToast(`Erreur lors du téléchargement en ${timeframe.label}`, 'error', 3000);
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
