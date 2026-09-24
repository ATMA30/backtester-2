import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Contrats entre la feuille de style et les composants.
 *
 * Rien dans la chaîne d'outils ne signale une classe référencée mais jamais
 * déclarée, ni l'inverse. Ce projet s'est déjà fait piéger trois fois :
 * `.status-dot.online` laissait la pastille grise, `.text-green` laissait le
 * résultat net incolore, et `.toast` masquait **tous** les toasts parce que le
 * modificateur censé les révéler — `.toast-show` — n'était appliqué nulle part.
 * Les 78 appels à `showToast` du projet ne produisaient rien à l'écran, et
 * typecheck, lint et tests étaient verts.
 */

/** Vitest s'exécute depuis la racine du projet. */
const ROOT = join(process.cwd(), 'src');

function collectSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) collectSources(path, out);
    else if (entry.endsWith('.tsx')) out.push(readFileSync(path, 'utf-8'));
  }
  return out;
}

const css = readFileSync(join(ROOT, 'index.css'), 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '');
const tsx = collectSources(ROOT).join('\n');

/** Every class name declared anywhere in the stylesheet. */
const declared = new Set([...css.matchAll(/\.([A-Za-z_][\w-]*)/g)].map((m) => m[1]));

/**
 * True when the class name appears as a literal token anywhere in the JSX.
 *
 * Heuristique volontairement globale : elle ne vérifie pas que le modificateur
 * est posé sur *le bon* élément. `#rr-badge.visible` est ainsi passé entre les
 * mailles parce qu'un autre composant utilise `visible` de son côté. Le test
 * reste utile — il a trouvé `.toast-show` et `#rr-badge.good` — mais un faux
 * négatif est possible, et l'inspection visuelle garde le dernier mot.
 */
function isAppliedInCode(className: string): boolean {
  return new RegExp(`[\\s"'\`{]${className}[\\s"'\`}]`).test(tsx);
}

describe('index.css — modificateurs de visibilité', () => {
  /**
   * Repère les règles qui masquent par défaut (`opacity: 0` ou `display: none`)
   * puis délèguent l'affichage à un modificateur, et vérifie que ce
   * modificateur est bien posé quelque part dans le code.
   */
  it('tout sélecteur masqué par défaut a un modificateur réellement appliqué', () => {
    const hidden = new Set<string>();
    for (const rule of css.matchAll(/([.#][\w.#\s>-]+?)\s*\{([^}]*)\}/g)) {
      const [, selector, body] = rule;
      if (/opacity:\s*0\s*[;}]/.test(body) || /display:\s*none/.test(body)) {
        hidden.add(selector.trim());
      }
    }

    const orphans: string[] = [];
    for (const base of hidden) {
      for (const [, modifier] of css.matchAll(
        new RegExp(`${base.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\.([\\w-]+)`, 'g')
      )) {
        if (!isAppliedInCode(modifier)) orphans.push(`${base}.${modifier}`);
      }
    }

    expect(orphans).toEqual([]);
  });
});

describe('index.css — variantes de toast', () => {
  // `ToastType` est un type : la liste est recopiée ici volontairement, pour que
  // l'ajout d'une gravité sans sa règle CSS fasse échouer ce test.
  const TOAST_TYPES = ['info', 'success', 'warning', 'error'] as const;

  it('chaque gravité a sa règle dédiée', () => {
    for (const type of TOAST_TYPES) {
      expect(declared, `.toast-${type} manquante`).toContain(`toast-${type}`);
    }
  });

  it('la classe posée par le composant est bien celle que la feuille déclare', () => {
    // Le composant écrivait `toast success` alors que la feuille définit
    // `.toast-success` : les deux conventions divergeaient en silence.
    expect(tsx).toContain('toast-${t.type}');
  });

  it('la base .toast ne masque plus le toast', () => {
    const base = css.match(/\.toast\s*\{([^}]*)\}/);
    expect(base).not.toBeNull();
    expect(base?.[1]).not.toMatch(/opacity:\s*0\s*[;}]/);
  });
});

describe('index.css — classes référencées', () => {
  /**
   * Classes posées comme repères sémantiques, dont tout le style est en
   * `style={{…}}` sur le même élément.
   *
   * Elles sont inertes par construction, pas par oubli : un style en ligne
   * l'emporte de toute façon sur n'importe quel sélecteur de classe. La liste
   * est figée pour que *toute nouvelle* classe non déclarée fasse échouer le
   * test — c'est ainsi que `.text-green` et `.error-boundary` sont passées.
   */
  const INLINE_STYLED_HOOKS = new Set([
    'replay-cut-container',
    'replay-future-shade',
    'replay-cut-bar',
    'replay-cut-badge',
    'pair-card',
    'cat-tab',
    'th-row',
    'rp-speed-dropdown',
    'rp-orders-dropdown',
    'active-ind-item',
    // Fragment laissé par `toast-${t.type}` une fois l'interpolation retirée ;
    // les quatre variantes réelles sont vérifiées plus haut.
    'toast-',
  ]);

  it('les classes de style posées par les composants existent', () => {
    const used = new Set<string>();
    for (const m of tsx.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
      const blob = (m[1] ?? m[2] ?? '').replace(/\$\{[^}]*\}/g, ' ');
      for (const cls of blob.split(/\s+/)) {
        if (/^[a-z][\w-]*$/.test(cls) && cls.includes('-')) used.add(cls);
      }
    }

    const missing = [...used].filter((c) => !declared.has(c) && !INLINE_STYLED_HOOKS.has(c));
    expect(missing).toEqual([]);
  });
});

describe('index.css — conteneurs qui rognent leurs menus', () => {
  /**
   * Un conteneur dont l'`overflow` n'est pas `visible` rogne TOUS ses
   * descendants en `position: absolute`, y compris ceux qui débordent
   * volontairement de sa boîte.
   *
   * `#replay-bar` a reçu `overflow: auto` comme filet de sécurité pour les
   * fenêtres courtes, et a rendu du même coup ses trois menus déroulants
   * inutilisables : ils s'ouvrent vers le haut et n'en dépassait qu'une ligne.
   * Rien ne le signalait — ni la compilation, ni le lint, ni les tests.
   *
   * Tant que la barre héberge des `.tv-dropdown`, tout `overflow` qu'elle
   * déclare doit avoir son échappatoire.
   */
  it('#replay-bar rétablit overflow: visible quand un menu est ouvert', () => {
    const base = css.match(/#replay-bar\s*\{([^}]*)\}/)?.[1] ?? '';
    const clips = /overflow(-[xy])?:\s*(auto|hidden|scroll)/.test(base);

    if (!clips) return; // Plus de rognage du tout : rien à échapper.

    expect(css, "l'échappatoire #replay-bar.has-open-menu manque").toMatch(
      /#replay-bar\.has-open-menu\s*\{[^}]*overflow:\s*visible/
    );
    expect(tsx, "la classe has-open-menu n'est posée nulle part").toContain('has-open-menu');
  });

  it('les menus de la barre de replay passent par le registre partagé', () => {
    // Trois `useState` locaux ne se fermaient ni l'un l'autre, ni au clic
    // extérieur — que `App` pilote via `activeDropdown`.
    const replayBar = readFileSync(join(ROOT, 'components/Replay/ReplayBar.tsx'), 'utf-8');
    expect(replayBar).not.toMatch(/useState\(false\)/);
    for (const id of ['rp-anchor', 'rp-speed', 'rp-orders']) {
      expect(replayBar).toContain(id);
    }
  });
});

describe('styles en ligne', () => {
  /**
   * Un style en ligne l'emporte sur toute règle de la feuille, sans le dire —
   * `#tv-chart { height: 100% }` en ligne neutralisait la règle du replay. Les
   * 221 styles statiques ont été migrés en classes ; seuls restent en ligne les
   * styles *calculés* (positions, largeurs, couleurs conditionnelles), dont
   * c'est la place. Ce test empêche d'en réintroduire.
   */
  it('aucun style={{…}} entièrement littéral dans les composants', async () => {
    const ts = await import('typescript');
    const offenders: string[] = [];

    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((entry) => {
        const path = join(dir, entry);
        return statSync(path).isDirectory() ? walk(path) : entry.endsWith('.tsx') ? [path] : [];
      });

    const isLiteral = (node: import('typescript').Node): boolean =>
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isNumericLiteral(node) ||
      (ts.isPrefixUnaryExpression(node) && ts.isNumericLiteral(node.operand));

    for (const file of walk(ROOT)) {
      const source = ts.createSourceFile(file, readFileSync(file, 'utf-8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const visit = (node: import('typescript').Node) => {
        if (ts.isJsxAttribute(node) && node.name.getText(source) === 'style') {
          const expr = node.initializer && ts.isJsxExpression(node.initializer) ? node.initializer.expression : undefined;
          if (
            expr &&
            ts.isObjectLiteralExpression(expr) &&
            expr.properties.length > 0 &&
            expr.properties.every((p) => ts.isPropertyAssignment(p) && isLiteral(p.initializer))
          ) {
            const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
            offenders.push(`${file.replace(ROOT, 'src')}:${line}`);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }

    expect(offenders).toEqual([]);
  });
});
