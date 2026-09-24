# Audit de mise en production — Backtester Pro

*Branche `fix/production-hardening` · 24/09/2026*

## État des correctifs (mis à jour le 24/09/2026)

| Point | Statut | Où |
|---|---|---|
| C1 Devise du P&L | ✅ corrigé | `domain/instruments.ts`, `domain/position-sizing.ts` |
| C2 Anticipation (← / unité de temps) | ✅ corrigé | `useTradeStore.updatePrice` (`lastCheckedTime`), `replayGuards.ts` |
| C3 Saut avec position ouverte | ✅ corrigé : bougies traitées une à une, saut et sortie refusés | `ReplayBar.tsx`, `replayGuards.ts` |
| C4 Session effacée au chargement | ✅ corrigé | `accountSymbol` dans `useTradeStore` |
| C5 `push(...array)` multi-fichiers | ✅ corrigé | `ImportModal.tsx` |
| C6 CSV sans en-tête (MT4) | ✅ corrigé + vérifié au navigateur | `domain/csv.ts`, `csv-stream.ts` |
| C7 Dates US / européennes | ✅ corrigé, confirmation demandée si ambigu | `domain/csv.ts`, `ImportModal.tsx` |
| C8 Horodatage des clôtures partielles | ✅ corrigé | `useTradeStore.closePartial` |
| C9 Instrument chargé après fermeture | ✅ corrigé (modales montées à l'ouverture) | `App.tsx` |
| C10 Import non annulable | ✅ corrigé (bouton Annuler, annulation à la fermeture) | `ImportModal.tsx` |
| C11 Gros fichier trié à l'envers | ✅ corrigé | `csv-stream.ts` (`mergeBatch`) |
| C12 JSON géant | ✅ limité à 100 Mo, avec orientation vers le CSV | `ImportModal.tsx` |
| C13 Page blanche hors graphique | ✅ ErrorBoundary racine et par zone | `main.tsx`, `App.tsx` |
| Trouvé en corrigeant : le ✕ du graphique clôturait au prix d'entrée | ✅ corrigé | `DrawingCanvas.tsx` |
| 2.1 Guide d'arrivée, date de départ, annotation, faux bouton « flux » | ✅ | `OnboardingGuide.tsx`, `ReplayBar.tsx`, `DrawingCanvas.tsx` |
| 2.1 Bandeau de sélection du départ | ⚪ existait déjà ; Échap ne l'annulait pas → corrigé | `App.tsx` |
| 2.2 Aperçu interprété, mappage pour toutes les tailles, messages d'erreur | ✅ | `ImportModal.tsx` |
| 2.3 Risque réel, devise unique, mention hors frais | ✅ | `ReplayBar.tsx`, `TradeHistoryModal.tsx` |
| 2.3 Aides de saisie SL/TP | ⚪ déjà visibles sous les champs | — |
| 2.3 Modèle de spread, commission et slippage | ✅ valeurs ECN par défaut, modifiables ; activé par défaut | `domain/trading-costs.ts`, `CostsMenu.tsx` |
| 2.4 Journal (drawdown, espérance en R, définitions, courbe, export) | ✅ | `TradeHistoryModal.tsx` |
| 2.5 Accessibilité (dialogues, focus, boutons) | ✅ pour les modales, les cartes d'instruments et les zones de dépôt ; les autres `div` cliquables des menus restent à traiter | `useDialogFocus.ts` |
| 3.1 Bundle, socket Deriv, historique partiel | ✅ | `vite.config.ts`, `derivWs.ts` |
| 3.2 `to` ignoré en prod, collision de cache, import dupliqué | ✅ | `history.ts`, `db.ts`, `ImportModal.tsx` |
| 3.2 Logique Yahoo en double (dev / prod) | ✅ cœur partagé, Dukascopy en source prioritaire du dev | `netlify/lib/history-core.ts` |
| 3.2 Styles en ligne | ✅ 221 statiques migrés (neutralité vérifiée), 24 calculés conservés, test anti-régression | `index.css`, `index.css.test.ts` |
| 3.3 CSP (Yahoo) | ✅ | `netlify.toml` |
| Signalé après coup : journalier forex sans mèches | ✅ vrai OHLC d'abord, BCE en prolongement, caches invalidés | `history-core.ts`, `historicalApi.ts`, `App.tsx` |
| Trouvé en vérifiant : barre de replay qui déborde avec une position ouverte | ✅ retour à la ligne | `index.css` |
| Dev et prod ne servaient pas les mêmes données (Dukascopy en dev seulement) | ✅ Dukascopy en production, plages partagées avec l'interface, repli Yahoo | `history-core.ts`, `archive-limits.ts` |
| Revue sécurité : injection de formules dans l'export CSV (moyen) | ✅ | `domain/csv-export.ts` |
| Revue sécurité : `splitRow` quadratique, tampon non borné, plafonds, cache CDN | ✅ | `csv.ts`, `csv-stream.ts`, `session.ts`, `history.ts` |
| Revue sécurité : proxy du serveur de dev (CORS `*`) | ✅ le dev utilise le handler de production | `vite.config.ts` |
| Revue de code : nombres `65.432,10`, `sl`/`tp` NaN restaurés, aperçu du stop, reliquat, indicateur de téléchargement | ✅ | `csv.ts`, `useTradeStore.ts`, `ReplayBar.tsx`, `useTimeframeSwitch.ts` |

## Synthèse

| Contrôle | Résultat |
|---|---|
| `tsc --noEmit` | ✅ 0 erreur |
| `eslint .` | ✅ 0 avertissement |
| `vitest run` | ✅ 191/191 (14 fichiers) |
| `vite build` | ✅ — un seul bundle JS de 702 Ko (216 Ko gzip) |
| `npm audit --omit=dev` | ✅ 0 vulnérabilité |

**Stack** : React 19, Vite 6, TypeScript strict, Zustand 5, lightweight-charts 4, Dexie (IndexedDB). Une seule fonction Netlify (`/api/history`) sert d'agrégateur de données publiques (BCE, Yahoo, Binance). Deriv est interrogé directement en WebSocket depuis le navigateur.

**Nature du produit** : l'outil est un **simulateur de replay discrétionnaire**, pas un moteur de stratégie automatisé. L'utilisateur charge des bougies, choisit un point de départ, fait défiler le marché et passe ses ordres à la main. Il n'existe ni stratégie paramétrable, ni métrique de type Sharpe ou Sortino, ni modèle de spread, de commission ou de slippage. L'audit évalue le produit tel qu'il est et signale les manques là où ils faussent les résultats.

**Verdict** : la base est saine et l'équipe a déjà beaucoup durci le code : validation des entrées aux frontières, CSP stricte, gestion de `NaN`, timeouts réseau, validation des sessions importées. Il reste pourtant **sept défauts qui produisent des résultats de backtest faux ou détruisent le travail de l'utilisateur sans prévenir**. Aucun n'est visible à la compilation, au lint ou dans les tests. Ils doivent être corrigés avant la mise en production.

---

## 1. Bloquants prod (critique)

### C1 — Le P&L des paires non cotées en USD est faux (facteur ≈ 150 sur les paires JPY)

- `src/domain/position-sizing.ts:170-179` : `computePnl = delta × units` donne un résultat **dans la devise de cotation**. Ce montant est ensuite affiché et ajouté au solde en `$`.
- `src/domain/position-sizing.ts:99-114` : `riskBasedUnits` fait la même erreur dans l'autre sens.
- **Scénario** : 1 lot USDJPY (100 000 unités) et un mouvement de 1,00 ¥ donnent **+100 000 $** au lieu d'environ 640 $. Le dimensionnement au risque tombe à environ 0,004 lot, puis est arrondi au lot minimum de 0,01 : le risque réel ne correspond donc plus au pourcentage saisi. Les paires en CHF, CAD, GBP, AUD, NZD et les crosses sont faussées dans une moindre mesure.
- **Correctif** : ajouter une conversion `quote → devise du compte` dans `computePnl` et `riskBasedUnits`, avec pour taux le cours courant de la paire, ou de la paire USDxxx correspondante pour les crosses. Ajouter un test USDJPY.

### C2 — Revenir en arrière ou changer d'unité de temps réévalue SL/TP sur des bougies antérieures à l'entrée (biais d'anticipation)

- `src/components/Replay/ReplayBar.tsx:269-285` : l'effet appelle `updatePrice(candle)` à **chaque** changement de `currentIndex`, `activeTF` ou `baseTF`, quel que soit le sens de déplacement.
- `src/store/useReplayStore.ts:66-67` : `stepBackward` revient en arrière sans réinitialiser le compte.
- **Scénarios** :
  1. L'utilisateur ouvre un achat à la clôture de la bougie 100, puis appuie sur ←. Le plus bas de la bougie 99 touche le SL : la position est clôturée sur une bougie *antérieure* à son ouverture.
  2. L'utilisateur passe un ordre limite puis change d'unité de temps. L'ordre est évalué contre la bougie sur laquelle il a été saisi, dont le mouvement a eu lieu *avant* la saisie.
  3. L'utilisateur avance pour voir la suite, revient en arrière et entre au meilleur prix. Rien ne l'en empêche et rien ne le signale.
- **Correctif** : conserver dans le store de trading un `lastProcessedTime` et n'accepter dans `updatePrice` que les bougies telles que `time > max(lastProcessedTime, position.time, order.time)`. Deux options pour le retour arrière : le bloquer tant qu'une position ou un ordre est ouvert, ou l'autoriser en marquant la session comme « non conforme ».

### C3 — Un saut dans le replay avec une position ouverte ignore toutes les bougies intermédiaires

- `src/components/Replay/ReplayBar.tsx:427-463` (`promptDate`), le menu de point de départ, et `src/components/Chart/TradingChart.tsx:491-512` (clic de sélection) appellent tous `setStartIndex`/`setCurrentIndex` directement. Seule la bougie d'arrivée passe par `updatePrice`.
- **Scénario** : l'utilisateur est en position avec un SL à 1,0800 et saute trois mois plus loin. Le prix est passé sous 1,0800 entre-temps, mais la position est jugée sur la seule bougie d'arrivée : elle peut survivre, ou être clôturée à un prix sans rapport.
- **Correctif** : refuser le saut tant qu'une position ou un ordre est ouvert, en disant pourquoi, ou traiter chaque bougie de l'intervalle.

### C4 — Charger une session sauvegardée sur un autre instrument efface ses trades aussitôt

- `src/components/Modals/DatasetsModal.tsx:134-165` : `setSymbol(session.symbol)` est suivi, dans la même exécution synchrone, de `restoreTradeState(...)`.
- `src/App.tsx:208-248` : l'effet « un instrument, un compte » s'exécute *après* ce gestionnaire. Il constate le changement de symbole et appelle `resetReplay()` puis `resetAccount()`.
- **Scénario** : l'utilisateur est sur EURUSD et charge sa session « XAUUSD — semaine 12 ». Le journal restauré est effacé dans le rendu suivant et le toast « Compte remis à zéro » s'affiche. *Conclusion tirée de la lecture du code ; reste à reproduire dans le navigateur.*
- **Correctif** : exposer une exemption explicite, par exemple `markAccountSymbol(symbol)` appelé avant `setSymbol`, ou bien déplacer la règle d'isolation dans une action du store qui prend en paramètre l'origine du changement.

### C5 — L'import multi-fichiers plante au-delà d'environ 150 000 bougies par fichier

- `src/components/Modals/ImportModal.tsx:284` et `:286` : `allRows.push(...streamed.candles)` et `allRows.push(...(await readCandleRows(file)))`.
- **Vérifié** sous V8 (Node 24) : `push(...array)` réussit à 100 000 éléments et lève `RangeError: Maximum call stack size exceeded` à 150 000. Le même piège figure déjà dans `lessons.md` pour `Math.max(...)`.
- **Scénario** : l'utilisateur importe ensemble deux fichiers M1 d'une année chacun. L'erreur est attrapée, chaque fichier est classé « illisible » et le toast final annonce *« Aucune donnée exploitable »*. Or ce cas est justement celui pour lequel l'import multi-fichiers existe.
- **Correctif** : remplacer par une boucle `for (const c of list) allRows.push(c)`, ou par `concat`.

### C6 — Un CSV sans en-tête, comme l'export MT4 standard, est importé avec des colonnes décalées et sans alerte

- `src/domain/csv.ts:90-103` et `src/domain/csv-stream.ts:195-213` : la première ligne est toujours prise pour un en-tête.
- **Vérifié** à l'exécution sur `2020.01.02,00:00,1.12100,1.12150,1.12050,1.12120,100` :
  `{date:"2020.01.02", time:"", open:"00:00", high:"1.12100", low:"1.12150", close:"1.12050"}`.
  La première bougie est perdue et chaque colonne OHLC est décalée d'un cran, si bien que `close` reçoit le plus bas. Faute de colonne `time`, toutes les bougies d'une journée partagent le même horodatage et la déduplication n'en conserve qu'une.
- Sur le chemin en flux (> 8 Mo) il n'y a **aucun aperçu ni aucune étape de mappage** : le graphique affiche des données corrompues sous le statut « Fichier importé ».
- **Correctif** : considérer qu'il n'y a pas d'en-tête quand les cellules de la ligne 1 sont majoritairement numériques ou se lisent comme des dates. Ajouter une détection explicite du format MT4 (`date,heure,O,H,L,C,V`). Afficher le mappage détecté, y compris pour les gros fichiers, avant de lancer la lecture complète.

### C7 — Les dates au format US sont mélangées sans alerte avec des dates au format européen

- `src/components/Modals/ImportModal.tsx:93-100` : toute date `xx/xx/aaaa` est lue comme JJ/MM. Quand cette lecture échoue (jour > 12), `new Date(s)` prend le relais en `:118` et la lit comme MM/JJ **en heure locale**.
- **Scénario** : dans un export US, `03/04/2024` (4 mars) devient le 3 avril, tandis que `03/25/2024` reste bien le 25 mars, mais décalé du fuseau de l'utilisateur. La série est ensuite triée : les bougies sont mélangées sans aucun avertissement.
- **Correctif** : déterminer l'ordre JJ/MM ou MM/JJ une seule fois pour tout le fichier, à partir des valeurs > 12, le proposer dans l'étape de mappage, et ne jamais retomber sur `new Date(string)`.

### Bloquants de second rang (à corriger dans la même passe)

| # | Fichier:ligne | Défaut | Conséquence |
|---|---|---|---|
| C8 | `src/store/useTradeStore.ts:300` | `closePartial` horodate avec `Date.now()` au lieu du temps de la bougie | La clôture partielle est datée de 2026 dans le journal. `getMetrics` trie par `closeTime` et la place en fin de courbe, ce qui fausse le **drawdown**. |
| C9 | `src/components/Modals/LiveModal.tsx:60-62` | La modale renvoie `null` sans être démontée, donc le nettoyage `abort()` ne s'exécute jamais à la fermeture | Si l'utilisateur ferme la modale pendant un chargement lent, la réponse arrive plus tard, **remplace le graphique** et, comme le symbole change, **efface le compte** (C4). |
| C10 | `src/components/Modals/ImportModal.tsx:337, 563` | Aucun `AbortSignal` n'est passé à `streamCsvCandles`, il n'y a pas de bouton Annuler, et le clic sur le fond ferme la modale pendant la lecture | Le même détournement se produit avec un import de 300 Mo qui aboutit après la fermeture de la modale. La branche `result.aborted` (`:362`) annonce « non importées » alors que `setBaseCandles` a déjà été appelé en `:356`. |
| C11 | `src/domain/csv-stream.ts:155-156` | Dans un gros fichier trié du plus récent au plus ancien (export Investing.com, par exemple), tout lot antérieur au premier est ignoré sans être compté dans `linesRejected` | Un fichier de 2 M de lignes n'importe que ses 50 000 premières, et le toast affiche un succès. |
| C12 | `src/components/Modals/ImportModal.tsx:175-179` | Le JSON n'est pas lu en flux et la seule limite est de 2 Go | `file.text()` suivi de `JSON.parse` sur quelques centaines de Mo fait planter l'onglet. Il faut une limite propre au JSON, de l'ordre de 100 Mo, avec un message qui oriente vers le CSV. |
| C13 | `src/components/ErrorBoundary.tsx` → `src/App.tsx:391-393` | Seul `TradingChart` est protégé par l'ErrorBoundary | Une erreur de rendu dans `ReplayBar`, une modale ou `Topbar` affiche une **page blanche**. Il faut une boundary racine, plus une par modale. |

---

## 2. Frictions UX et intuitivité

### 2.1 Arrivée et parcours

| Constat | Où | Proposition |
|---|---|---|
| Au démarrage, l'application charge EUR/USD en journalier d'office. L'état vide soigné (« Rejouez le marché, bougie par bougie ») n'apparaît donc presque jamais, et l'utilisateur tombe sur un graphique sans savoir quoi faire. | `App.tsx:145`, `TradingChart.tsx:704-728` | Au premier lancement (aucune session en localStorage), afficher un **guide en 3 étapes** superposé au graphique : ① Données (instrument ou fichier) → ② Point de départ → ③ Passer un ordre. Chaque étape se coche automatiquement. |
| Le replay se lance en cliquant sur une bougie, mais cette action n'est expliquée que dans une info-bulle. | `TradingChart.tsx:491` | En mode sélection, afficher un bandeau persistant : « Cliquez sur la bougie où commencer · Échap pour annuler ». |
| La date de départ se saisit dans un `prompt()` natif au format AAAA-MM-JJ. | `ReplayBar.tsx:427` | Utiliser un `<input type="date">` borné par `min`/`max` dans le menu « Point de départ ». |
| Le texte d'une annotation se saisit aussi via `prompt()`. | `DrawingCanvas.tsx:1874` | Proposer une édition en place sur le canvas. |
| Le bouton « Déconnecter le flux » est sans effet : `isLiveConnected` est écrit mais **jamais lu** nulle part. Il n'existe d'ailleurs aucun flux : la modale « Live » ne fait que télécharger de l'historique. | `LiveModal.tsx:287`, `useMarketStore.ts:218` | Supprimer le bouton et le drapeau, et renommer l'entrée « Charger un instrument ». Si un vrai flux temps réel est prévu, il fera l'objet d'une fonctionnalité à part entière (voir 3.3). |

### 2.2 Import

| Constat | Où | Proposition |
|---|---|---|
| Au-delà de 8 Mo, l'import démarre sans aperçu, sans mappage ni confirmation du symbole. Le symbole est même figé avant que l'utilisateur ait pu le saisir. | `ImportModal.tsx:417-418` | Lire d'abord les 20 premières lignes, montrer l'aperçu et le mappage détecté (C6, C7), puis lancer la lecture en flux au clic sur « Importer ». |
| L'option de la colonne volume indique « — Aucun (Défaut 100) — », alors que la valeur par défaut est 0 depuis le retrait des volumes inventés. | `ImportModal.tsx:647` | Remplacer par « — Aucun (pas de volume) — ». |
| L'aperçu n'affiche aucune donnée, seulement des listes déroulantes de noms de colonnes : impossible de voir que le mappage est faux. | `ImportModal.tsx:633-657` | Ajouter un tableau des 5 premières lignes **telles qu'elles seront interprétées** (date lisible, O/H/L/C), avec les anomalies en rouge (high < low, date invalide). |
| Les messages d'échec ne disent pas quoi faire : « Lecture impossible : x.csv », « fichier(s) illisible(s) ». | `ImportModal.tsx:388, 322` | Donner la cause et la suite, par exemple : « Ligne 12 : date "13/25/2024" illisible. Formats acceptés : AAAA-MM-JJ, JJ/MM/AAAA, timestamp Unix. » Le parseur connaît déjà `linesRejected`. |
| La zone de dépôt est un `div` : pas de focus clavier, pas d'état visuel au survol d'un fichier glissé. | `ImportModal.tsx:594-615`, `TradingChart.tsx:712` | Utiliser un `<button>` ou `role="button"` avec `tabIndex`, et ajouter une classe `is-dragover`. |

### 2.3 Prise d'ordre et pédagogie

- **Le coût de trading n'est pas modélisé** (spread, commission, slippage). Les fills se font au prix exact du SL ou du TP (sauf gap), ce qui rend les résultats systématiquement **optimistes**. Au minimum, afficher dans le journal « Résultats hors frais et spread ». Mieux : ajouter un paramètre *spread (pips)* par instrument, appliqué à l'entrée.
- Le champ SL/TP accepte `30p` et `1.5%`, ce qui est bien pensé, mais la syntaxe n'est visible que dans le placeholder et disparaît dès la première frappe (`ReplayBar.tsx:842, 854`). Afficher un aperçu sous le champ : « = 1,08120 · risque 200 $ ».
- Quand le dimensionnement au risque arrondit au lot minimum, le risque réel dépasse celui demandé sans que rien ne l'indique (voir C1). Afficher « risque réel : 2,6 % » à côté du champ Risque.
- La devise est incohérente : `$` est codé en dur (`ReplayBar.tsx:376, 674`, `TradeHistoryModal.tsx:135, 140, 183`) alors que les textes métier parlent d'euros (`App.tsx:199-201`). Il faut une seule devise de compte, configurable.

### 2.4 Lecture des résultats (journal)

| Constat | Où | Proposition |
|---|---|---|
| `maxDrawdown` est calculé mais **n'est affiché nulle part**. | `useTradeStore.ts:446-457`, `TradeHistoryModal.tsx:119-150` | Remplacer « Trades gagnants », redondant avec le taux de réussite, par « Drawdown max ». |
| Les métriques utiles à un trader discrétionnaire manquent : espérance par trade, gain moyen / perte moyenne, R moyen. Aucune métrique n'a de définition. | `TradeHistoryModal.tsx` | Ajouter 3 KPI hiérarchisés (Résultat net, Espérance en R, Drawdown max) puis une ligne secondaire. Mettre sur chaque libellé une info-bulle d'une phrase, par exemple « Facteur de profit : gains bruts ÷ pertes brutes. > 1,5 = solide. » |
| La courbe d'équité est toujours verte, sans axe ni repère du capital initial, et construite dans l'ordre d'insertion alors que les métriques utilisent l'ordre chronologique. | `TradeHistoryModal.tsx:69-74, 157` | Trier par `closeTime`, colorer selon le signe final, tracer une ligne pointillée au capital initial. |
| Les lignes du journal n'affichent ni date, ni taille, ni R. Une perte s'affiche « $-12.34 » alors que le total s'écrit « -$12.34 ». Un trade à 0 s'affiche en vert. | `TradeHistoryModal.tsx:168-186` | Adopter un format unique (`formatMoney`), afficher la date de la bougie et la taille en lots, et un état neutre pour 0. |
| L'export CSV écrit les horodatages en epoch brut, et `revokeObjectURL` est appelé juste après `click()`, ce qui peut annuler le téléchargement sous Firefox et Safari. | `TradeHistoryModal.tsx:48-66` | Exporter les dates en ISO 8601 et révoquer dans un `setTimeout(…, 0)`. |

### 2.5 Accessibilité

- 30 `div` cliquables (`grep '<div[^>]*onClick'`), dont les cartes d'instruments (`LiveModal.tsx:260`) et les zones de dépôt : inaccessibles au clavier.
- Une seule modale sur huit porte `role="dialog"` et `aria-modal` (`TimeframeCoverageModal`). Aucune ne piège le focus ni ne le rend à l'élément d'origine à la fermeture.

---

## 3. Optimisations secondaires

### 3.1 Performance

- **Bundle unique de 702 Ko.** Charger à la demande les modales (`React.lazy`) et `DrawingCanvas` (2 365 lignes). Mettre `lightweight-charts` dans un chunk séparé pour profiter du cache.
- `derivWs.ts:167-199` ouvre **une nouvelle socket par page** (jusqu'à 15 à la suite, 8 s de timeout chacune, soit 2 min dans le pire cas). Réutiliser une seule socket pour toutes les pages.
- `derivWs.ts:179-182` : quand une page échoue, la boucle s'arrête et renvoie un historique **partiel présenté comme complet**. Remonter un drapeau `partial` jusqu'au toast.
- `csv-stream.ts:275-281` : `buffer.slice` à chaque ligne reste acceptable grâce aux *sliced strings* de V8. Un index de lecture sur le morceau courant serait plus prévisible sur les autres moteurs.

### 3.2 Lisibilité et maintenance

- `ImportModal.tsx` recopie quatre fois la séquence de fin d'import `resetReplay → setSymbol → setBaseCandles → setDataSource → setTimeframe → triggerFitContent → closeModal` (`:314, :354, :444, :544`). Une action unique `commitImportedSeries()` supprimerait aussi le risque d'écart entre les quatre chemins.
- `parseTimestamp` et `parseNumber` sont typés `any` et définis dans le composant (`ImportModal.tsx:73, 130`). Ils devraient vivre dans `domain/csv.ts`, où ils seraient testables. C'est là que C6 et C7 auraient été repérés.
- 250 attributs `style={{…}}` en ligne. `lessons.md` rappelle déjà qu'un style en ligne l'emporte en silence sur la feuille de style.
- La logique Yahoo existe en double, dans `vite.config.ts:40-80` et dans `netlify/functions/history.ts:120-173`. Le mode dev et la prod peuvent donc diverger (C'est d'ailleurs déjà arrivé avec `/api/dukascopy`).
- `historicalApi.ts:275` envoie `to` à `/api/history`, mais la fonction ne lit jamais ce paramètre. En production, l'ancrage du replay sur une date passée est ignoré sans alerte.
- `useMarketStore.ts:431` indexe les jeux de données par symbole : importer un fichier nommé « EURUSD » écrase l'historique EURUSD mis en cache.

### 3.3 Sécurité (rien de bloquant)

- ✅ Aucun secret dans le code ni dans les variables `VITE_*`. L'`app_id` Deriv 1089 est public.
- ✅ CSP stricte, `frame-ancestors 'none'`, `nosniff`. La fonction Netlify valide ses paramètres par liste blanche, construit ses URL avec `URLSearchParams`, applique des timeouts, un rate-limit de 60 requêtes/min et un CORS limité à la même origine.
- ✅ Les sessions, dessins et états de compte importés sont validés champ par champ (`domain/session.ts`, `safePositions`).
- ⚠️ `connect-src` autorise `query1.finance.yahoo.com` et `api.binance.com` côté client. Yahoo n'y est jamais appelé : retirer cette autorisation.
- ⚠️ La disponibilité en production dépend de l'API **non officielle** de Yahoo, appelée avec un User-Agent de navigateur usurpé (`history.ts:40`). Le risque est un blocage sans préavis. Prévoir une surveillance du taux de 502 et informer l'utilisateur en conséquence.
- ℹ️ WebSocket et flux continu : aucun abonnement temps réel n'existe, donc pas de risque de fuite mémoire sur un flux. Les sockets de pagination sont bien fermées dans `finish()`. Si un vrai flux live est ajouté, il faudra prévoir : reconnexion avec backoff, ping/pong, re-souscription, et un tampon de ticks borné.

---

## Ordre de correction recommandé

1. **Intégrité des résultats** : C1 (devise), C2 et C3 (biais d'anticipation), C8 (horodatage des clôtures partielles). Sans ces corrections, les chiffres affichés sont faux.
2. **Perte de travail** : C4, C9, C10 (compte effacé ou graphique remplacé sans action de l'utilisateur).
3. **Import** : C5, C6, C7, C11, C12, puis l'aperçu interprété (2.2).
4. **Résilience** : C13 (ErrorBoundary racine).
5. **UX** : guide d'arrivée, drawdown affiché, info-bulles sur les métriques, mention « hors frais ».

Chaque correctif de la partie 1 doit être livré avec un test de non-régression. Les tests actuels couvrent bien chaque fonction isolément, mais aucun ne couvre ces interactions entre composants et stores (effet d'`App` contre chargement de session, curseur de replay contre moteur d'ordres).
