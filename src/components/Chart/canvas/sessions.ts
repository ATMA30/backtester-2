/** Trading sessions layer of the drawing canvas. */

import { RenderContext } from './context';
import { TimeframeSeconds, supportsSessions } from '../../../domain/timeframes';

/**
 * Largeur minimale, en pixels, sous laquelle l'étiquette d'une séance nuit.
 *
 * 26 px masquait les badges dès qu'on regardait une dizaine de jours en 5 min —
 * un zoom de travail parfaitement normal, où un bloc de Londres fait ~25 px.
 * Le seuil ne sert qu'à éviter l'empilement illisible des vues très dézoomées.
 */
const MIN_SESSION_LABEL_WIDTH = 12;

interface SessionDef {
  key: string;
  name: string;
  startHour: number;
  endHour: number;
  color: string;
  textColor: string;
  isKillzone?: boolean;
}

const ALL_SESSIONS: SessionDef[] = [
  { key: 'sydney', name: 'SYDNEY', startHour: 22, endHour: 7, color: 'rgba(167, 139, 250, 0.06)', textColor: '#A78BFA' },
  { key: 'tokyo', name: 'TOKYO', startHour: 0, endHour: 9, color: 'rgba(251, 146, 60, 0.06)', textColor: '#FB923C' },
  { key: 'london', name: 'LONDRES', startHour: 8, endHour: 17, color: 'rgba(96, 165, 250, 0.06)', textColor: '#60A5FA' },
  { key: 'newyork', name: 'NEW YORK', startHour: 13, endHour: 22, color: 'rgba(52, 211, 153, 0.06)', textColor: '#34D399' },
  { key: 'asianRange', name: 'ASIAN RANGE', startHour: 0, endHour: 6, color: 'rgba(244, 114, 182, 0.08)', textColor: '#F472B6', isKillzone: true },
  { key: 'londonOpenKZ', name: 'LONDON KZ', startHour: 7, endHour: 10, color: 'rgba(56, 189, 248, 0.08)', textColor: '#38BDF8', isKillzone: true },
  { key: 'nyOpenKZ', name: 'NY OPEN KZ', startHour: 12, endHour: 15, color: 'rgba(74, 222, 128, 0.08)', textColor: '#4ADE80', isKillzone: true },
  { key: 'londonCloseKZ', name: 'LONDON CLOSE', startHour: 15, endHour: 17, color: 'rgba(251, 191, 36, 0.08)', textColor: '#FBBF24', isKillzone: true },
];

function isCandleInSession(c: { time: number }, sess: SessionDef, useLocalTz: boolean): boolean {
  const d = new Date(c.time * 1000);
  const hour = useLocalTz ? d.getHours() : d.getUTCHours();
  if (sess.startHour < sess.endHour) {
    return hour >= sess.startHour && hour < sess.endHour;
  } else {
    return hour >= sess.startHour || hour < sess.endHour;
  }
}

function isSameTradingDay(t1: number, t2: number, sess: SessionDef, useLocalTz: boolean): boolean {
  const dt = Math.abs(t2 - t1);
  if (dt > 10800) return false;
  const d1 = new Date(t1 * 1000);
  const d2 = new Date(t2 * 1000);
  if (sess.startHour < sess.endHour) {
    const day1 = useLocalTz ? d1.getDate() : d1.getUTCDate();
    const day2 = useLocalTz ? d2.getDate() : d2.getUTCDate();
    return day1 === day2;
  }
  return true;
}

/** Forex sessions, killzones and the Asian range, with their labels. */
export function drawTradingSessions(rc: RenderContext): void {
  const { ctx, dpr, width, height, startIdx, endIdx, displayCandles, toXY, getBarSpacingPx, mainSeries, instrument, forexSessions, activeTF, baseTF } = rc;
  const isAnySessionActive =
    forexSessions &&
    (forexSessions.london ||
      forexSessions.newyork ||
      forexSessions.tokyo ||
      forexSessions.sydney ||
      forexSessions.asianRange ||
      forexSessions.londonOpenKZ ||
      forexSessions.nyOpenKZ ||
      forexSessions.londonCloseKZ);

  // Les séances n'ont de sens qu'en intraday : une bougie journalière couvre
  // Tokyo, Londres et New York à la fois. Même seuil que le menu de la barre
  // supérieure, qui grise les options en conséquence.
  const sampleDt =
    displayCandles.length >= 2
      ? Math.abs(displayCandles[1].time - displayCandles[0].time)
      : (activeTF || baseTF || TimeframeSeconds.D1);
  const isIntraday = supportsSessions(sampleDt) && supportsSessions(activeTF || TimeframeSeconds.D1);

  if (isAnySessionActive && isIntraday) {
    ctx.save();
    const barSpacing = getBarSpacingPx();
    const useLocal = Boolean(forexSessions.useLocalTz);

    const activeSessDefs = ALL_SESSIONS.filter((s) => Boolean((forexSessions as any)[s.key]));

    /**
     * Étiquettes différées.
     *
     * Chaque séance peint son ombrage sur toute la hauteur avant que la
     * suivante ne dessine les siennes : avec plusieurs séances actives, les
     * badges des premières finissaient enfouis sous les couches d'ombrage des
     * suivantes. On les collecte ici et on les peint une fois toutes les
     * séances rendues.
     */
    const pendingBadges: {
      x: number;
      y: number;
      width: number;
      text: string;
      color: string;
    }[] = [];

    for (const sess of activeSessDefs) {
      let blockStartIdx: number | null = null;
      let blockHigh = -Infinity;
      let blockLow = Infinity;
      let blockStartX = 0;
      let blockEndX = 0;

      const sIdx = Math.max(0, startIdx - 2);
      const eIdx = Math.min(displayCandles.length - 1, endIdx + 2);


      for (let i = sIdx; i <= eIdx; i++) {
        const c = displayCandles[i];
        if (!c) continue;

        const inSess = isCandleInSession(c, sess, useLocal);

        if (inSess) {
          const p = toXY(c.time, c.close);
          if (p.x !== null) {
            if (blockStartIdx === null) {
              blockStartIdx = i;
              blockHigh = c.high;
              blockLow = c.low;
              blockStartX = p.x - barSpacing * 0.5;
              blockEndX = p.x + barSpacing * 0.5;
            } else {
              blockHigh = Math.max(blockHigh, c.high);
              blockLow = Math.min(blockLow, c.low);
              blockEndX = p.x + barSpacing * 0.5;
            }

            // Subtle background column slice
            if (p.x >= -barSpacing && p.x <= width + barSpacing) {
              ctx.fillStyle = sess.color;
              ctx.fillRect((p.x - barSpacing * 0.5) * dpr, 0, barSpacing * dpr, height * dpr);
            }
          }
        }

        // Check if session block ends: candle outside session, day gap > 3h, or end of loop
        const nextCandle = displayCandles[i + 1];
        const nextInSess = nextCandle ? isCandleInSession(nextCandle, sess, useLocal) : false;
        const isSameDay = nextCandle && c ? isSameTradingDay(c.time, nextCandle.time, sess, useLocal) : false;

        const shouldCloseBlock = blockStartIdx !== null && (!nextInSess || !isSameDay || i === eIdx);

        if (shouldCloseBlock) {
          // Draw Session Box bounded between High and Low
          if (forexSessions.showHighLow !== false && blockHigh > -Infinity && blockLow < Infinity && mainSeries) {
            const yHigh = mainSeries.priceToCoordinate(blockHigh);
            const yLow = mainSeries.priceToCoordinate(blockLow);

            if (yHigh !== null && yHigh !== undefined && yLow !== null && yLow !== undefined) {
              const boxTop = Math.min(yHigh, yLow);
              const boxBottom = Math.max(yHigh, yLow);
              const boxHeight = Math.max(2, boxBottom - boxTop);
              const boxWidth = Math.max(2, blockEndX - blockStartX);

              // Soft shaded box over price action of session
              ctx.fillStyle = sess.color.replace('0.06', '0.12').replace('0.08', '0.14');
              ctx.fillRect(blockStartX * dpr, boxTop * dpr, boxWidth * dpr, boxHeight * dpr);

              // High dashed line
              ctx.strokeStyle = sess.textColor;
              ctx.lineWidth = 1 * dpr;
              ctx.setLineDash([3 * dpr, 3 * dpr]);
              ctx.beginPath();
              ctx.moveTo(blockStartX * dpr, boxTop * dpr);
              ctx.lineTo(blockEndX * dpr, boxTop * dpr);
              ctx.stroke();

              // Low dashed line
              ctx.beginPath();
              ctx.moveTo(blockStartX * dpr, boxBottom * dpr);
              ctx.lineTo(blockEndX * dpr, boxBottom * dpr);
              ctx.stroke();

              ctx.setLineDash([]);

              // High / Low labels
              ctx.fillStyle = sess.textColor;
              ctx.font = `600 ${8 * dpr}px JetBrains Mono, monospace`;
              // Killzones et séances majeures se recouvrent (London KZ 7-10h
              // vit dans Londres 8-17h) : sans décalage, leurs deux jeux
              // d'étiquettes se superposaient et devenaient illisibles.
              const labelDy = sess.isKillzone ? 11 * dpr : 3 * dpr;
              ctx.fillText(`H: ${blockHigh.toFixed(instrument.decimals)}`, (blockEndX + 3) * dpr, boxTop * dpr + labelDy);
              ctx.fillText(`L: ${blockLow.toFixed(instrument.decimals)}`, (blockEndX + 3) * dpr, boxBottom * dpr + labelDy);
            }
          }

          // Draw Session Badge label at top
          // Le badge suit le bloc dès qu'il *croise* la vue. Le tester sur son
          // seul point de départ le faisait disparaître dès qu'on faisait
          // défiler au-delà du début de la séance — pourtant bien visible.
          const blockIntersectsView = blockEndX >= 0 && blockStartX <= width;
          // Dézoomé, un bloc de séance fait quelques pixels : afficher son
          // étiquette empilerait des dizaines de pastilles illisibles.
          const blockIsLegible = blockEndX - blockStartX >= MIN_SESSION_LABEL_WIDTH;

          if (forexSessions.showLabels !== false && blockIntersectsView && blockIsLegible) {
            const tagY = sess.isKillzone ? 22 * dpr : 5 * dpr;
            const textStr = `${sess.name} ${sess.startHour}h-${sess.endHour}h`;

            ctx.font = `bold ${8 * dpr}px JetBrains Mono, monospace`;
            const pillW = ctx.measureText(textStr).width + 12 * dpr;
            // Caler l'étiquette dans la partie visible du bloc, sans jamais
            // déborder de la zone de dessin.
            const pillWidthCss = pillW / dpr;
            const minX = Math.max(4, blockStartX);
            const maxX = Math.min(blockEndX - pillWidthCss, width - pillWidthCss - 4);
            const tagX = maxX > minX ? minX : Math.max(4, maxX);

            pendingBadges.push({
              x: tagX,
              y: tagY,
              width: pillWidthCss,
              text: textStr,
              color: sess.textColor,
            });
          }

          // Reset block
          blockStartIdx = null;
          blockHigh = -Infinity;
          blockLow = Infinity;
        }
      }

    }

    // Étiquettes en dernier, au-dessus de tous les ombrages. Une pastille qui
    // en recouvrirait une autre sur la même ligne est omise : empilées, elles
    // deviennent illisibles quand plusieurs séances se chevauchent.
    const occupiedRows = new Map<number, { from: number; to: number }[]>();
    const BADGE_GAP = 4;

    ctx.font = `bold ${8 * dpr}px JetBrains Mono, monospace`;
    for (const badge of pendingBadges) {
      const taken = occupiedRows.get(badge.y) ?? [];
      const overlaps = taken.some(
        (slot) => badge.x < slot.to + BADGE_GAP && badge.x + badge.width + BADGE_GAP > slot.from
      );
      if (overlaps) continue;

      taken.push({ from: badge.x, to: badge.x + badge.width });
      occupiedRows.set(badge.y, taken);

      const pillW = badge.width * dpr;
      const pillH = 14 * dpr;

      ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
      ctx.strokeStyle = badge.color;
      ctx.lineWidth = 1 * dpr;
      ctx.beginPath();
      ctx.roundRect(badge.x * dpr, badge.y, pillW, pillH, 3 * dpr);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = badge.color;
      ctx.fillText(badge.text, (badge.x + 6) * dpr, badge.y + 10 * dpr);
    }

    ctx.restore();
  }
}
