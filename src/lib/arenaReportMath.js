/**
 * Turns the LaTeX that models put in answers into readable HTML for the printed report.
 * Not a typesetter: it covers the notation that shows up in arena answers
 * (Greek, relations, fractions, roots, sub/superscripts, \mathsf-style wrappers)
 * so the report never shows raw backslash commands.
 */

const SYMBOLS = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η',
  theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π',
  rho: 'ρ', sigma: 'σ', tau: 'τ', upsilon: 'υ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ',
  Psi: 'Ψ', Omega: 'Ω',
  leq: '≤', le: '≤', geq: '≥', ge: '≥', neq: '≠', ne: '≠', approx: '≈', equiv: '≡', sim: '∼', simeq: '≃',
  propto: '∝', ll: '≪', gg: '≫', pm: '±', mp: '∓', times: '×', div: '÷', cdot: '·', ast: '∗', star: '⋆',
  circ: '∘', bullet: '•', oplus: '⊕', otimes: '⊗', ominus: '⊖', odot: '⊙', wedge: '∧', land: '∧',
  vee: '∨', lor: '∨', neg: '¬', lnot: '¬', forall: '∀', exists: '∃', nexists: '∄', in: '∈', notin: '∉',
  ni: '∋', subset: '⊂', supset: '⊃', subseteq: '⊆', supseteq: '⊇', nsubseteq: '⊈', cup: '∪', cap: '∩',
  setminus: '∖', emptyset: '∅', varnothing: '∅', infty: '∞', partial: '∂', nabla: '∇', sum: 'Σ',
  prod: 'Π', int: '∫', oint: '∮', sqcup: '⊔', bigcup: '⋃', bigcap: '⋂', bigoplus: '⨁', bigotimes: '⨂',
  to: '→', rightarrow: '→', leftarrow: '←', gets: '←', leftrightarrow: '↔', Rightarrow: '⇒',
  Leftarrow: '⇐', Leftrightarrow: '⇔', implies: '⟹', impliedby: '⟸', iff: '⟺', mapsto: '↦',
  uparrow: '↑', downarrow: '↓', langle: '⟨', rangle: '⟩', lceil: '⌈', rceil: '⌉', lfloor: '⌊',
  rfloor: '⌋', ldots: '…', cdots: '⋯', dots: '…', vdots: '⋮', ddots: '⋱', hbar: 'ℏ', ell: 'ℓ',
  dagger: '†', ddagger: '‡', top: '⊤', bot: '⊥', perp: '⊥', parallel: '∥', angle: '∠', prime: '′',
  degree: '°', aleph: 'ℵ', Re: 'ℜ', Im: 'ℑ', wp: '℘', checkmark: '✓', backslash: '\\', vert: '|',
  Vert: '‖', lvert: '|', rvert: '|', lVert: '‖', rVert: '‖', lbrace: '{', rbrace: '}', quad: ' ',
  qquad: '  ', mid: '|', models: '⊨', vdash: '⊢', Vdash: '⊩', triangleq: '≜', coloneqq: '≔',
  lesssim: '≲', gtrsim: '≳', cong: '≅',
};

const SPACING = new Set([',', ';', ':', '!', ' ', '>']);
const ESCAPED_CHARS = new Set(['{', '}', '%', '&', '_', '#', '$', '|']);
const IGNORED = new Set(['left', 'right', 'big', 'Big', 'bigg', 'Bigg', 'bigl', 'bigr', 'Bigl', 'Bigr', 'displaystyle', 'textstyle', 'limits', 'nolimits']);
const WRAP_PLAIN = new Set(['mathsf', 'mathrm', 'mathit', 'mathtt', 'mathcal', 'mathscr', 'mathfrak', 'text', 'textrm', 'textsf', 'textit', 'operatorname', 'mbox', 'boldsymbol', 'bm', 'hat', 'widehat', 'tilde', 'widetilde', 'vec']);
const BLACKBOARD = { R: 'ℝ', N: 'ℕ', Z: 'ℤ', Q: 'ℚ', C: 'ℂ', F: '𝔽', E: '𝔼', P: 'ℙ', H: 'ℍ' };

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * @param {string} src
 * @param {number} i index just after an opening brace
 * @returns {number} index of the matching closing brace, or src.length
 */
function matchingBrace(src, i) {
  let depth = 1;
  for (let k = i; k < src.length; k++) {
    const ch = src[k];
    if (ch === '\\') {
      k++;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return k;
    }
  }
  return src.length;
}

/**
 * Reads one argument: a {group}, a \command, or a single character.
 * @returns {[string, number]} raw source of the argument and the next index
 */
function readArg(src, i) {
  let k = i;
  while (src[k] === ' ') k++;
  if (k >= src.length) return ['', src.length];
  if (src[k] === '{') {
    const end = matchingBrace(src, k + 1);
    return [src.slice(k + 1, end), Math.min(end + 1, src.length)];
  }
  if (src[k] === '\\') {
    const m = /^\\([A-Za-z]+|.)/.exec(src.slice(k));
    const len = m ? m[0].length : 1;
    return [src.slice(k, k + len), k + len];
  }
  return [src[k], k + 1];
}

function isAtomic(raw) {
  return /^(?:\\[A-Za-z]+|[A-Za-z]|\d+(?:\.\d+)?|.)$/.test(raw.trim());
}

function wrapIfNeeded(rawArg, html) {
  return isAtomic(rawArg) ? html : `(${html})`;
}

function convert(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\\') {
      const m = /^\\([A-Za-z]+|.)/s.exec(src.slice(i));
      if (!m) {
        i++;
        continue;
      }
      const name = m[1];
      i += m[0].length;
      if (name === '\\') {
        out += '<br>';
        continue;
      }
      if (SPACING.has(name)) {
        out += name === '!' ? '' : ' ';
        continue;
      }
      if (ESCAPED_CHARS.has(name)) {
        out += escapeHtml(name);
        continue;
      }
      if (IGNORED.has(name)) continue;
      if (name === 'frac' || name === 'dfrac' || name === 'tfrac') {
        const [a, ia] = readArg(src, i);
        const [b, ib] = readArg(src, ia);
        i = ib;
        out += `${wrapIfNeeded(a, convert(a))}⁄${wrapIfNeeded(b, convert(b))}`;
        continue;
      }
      if (name === 'binom') {
        const [a, ia] = readArg(src, i);
        const [b, ib] = readArg(src, ia);
        i = ib;
        out += `C(${convert(a)}, ${convert(b)})`;
        continue;
      }
      if (name === 'sqrt') {
        let rootIndex = '';
        if (src[i] === '[') {
          const close = src.indexOf(']', i);
          if (close > i) {
            rootIndex = src.slice(i + 1, close);
            i = close + 1;
          }
        }
        const [a, ia] = readArg(src, i);
        i = ia;
        const prefix = rootIndex ? `<sup>${convert(rootIndex)}</sup>` : '';
        out += `${prefix}√${wrapIfNeeded(a, convert(a))}`;
        continue;
      }
      if (name === 'mathbb' || name === 'Bbb') {
        const [a, ia] = readArg(src, i);
        i = ia;
        out += BLACKBOARD[a.trim()] || convert(a);
        continue;
      }
      if (name === 'mathbf' || name === 'textbf' || name === 'bf') {
        const [a, ia] = readArg(src, i);
        i = ia;
        out += `<b>${convert(a)}</b>`;
        continue;
      }
      if (name === 'overline' || name === 'bar') {
        const [a, ia] = readArg(src, i);
        i = ia;
        out += `<span style="text-decoration:overline">${convert(a)}</span>`;
        continue;
      }
      if (name === 'underline') {
        const [a, ia] = readArg(src, i);
        i = ia;
        out += `<u>${convert(a)}</u>`;
        continue;
      }
      if (WRAP_PLAIN.has(name)) {
        const [a, ia] = readArg(src, i);
        i = ia;
        out += convert(a);
        continue;
      }
      if (name === 'begin' || name === 'end') {
        const [, ia] = readArg(src, i);
        i = ia;
        continue;
      }
      if (Object.prototype.hasOwnProperty.call(SYMBOLS, name)) {
        out += escapeHtml(SYMBOLS[name]);
        continue;
      }
      out += escapeHtml(name);
      continue;
    }
    if (ch === '^' || ch === '_') {
      const [arg, next] = readArg(src, i + 1);
      i = next;
      const tag = ch === '^' ? 'sup' : 'sub';
      out += `<${tag}>${convert(arg)}</${tag}>`;
      continue;
    }
    if (ch === '{' || ch === '}') {
      i++;
      continue;
    }
    if (ch === '&' || ch === '~') {
      out += ' ';
      i++;
      continue;
    }
    out += escapeHtml(ch);
    i++;
  }
  return out;
}

/**
 * @param {string} latex source without the surrounding $ or \( \) delimiters
 * @returns {string} safe HTML
 */
export function latexToHtml(latex) {
  return convert(String(latex || '').trim()).replace(/ {2,}/g, ' ');
}

const MATH_PATTERNS = [
  { re: /\$\$([\s\S]+?)\$\$/g, display: true },
  { re: /\\\[([\s\S]+?)\\\]/g, display: true },
  { re: /\\\(([\s\S]+?)\\\)/g, display: false },
  { re: /(?<![\\$\w])\$(?!\s)([^$\n]+?)(?<!\s)\$(?![\w$])/g, display: false },
];

/**
 * Pulls math spans out of markdown source so the markdown parser cannot mangle them.
 * @param {string} text
 * @returns {{ text: string, spans: Array<{ html: string, display: boolean }> }}
 */
export function extractMath(text) {
  const spans = [];
  let work = String(text || '');
  for (const { re, display } of MATH_PATTERNS) {
    work = work.replace(re, (_, body) => {
      spans.push({ html: latexToHtml(body), display });
      return `@@MATH${spans.length - 1}@@`;
    });
  }
  return { text: work, spans };
}

/**
 * @param {string} html
 * @param {Array<{ html: string, display: boolean }>} spans
 */
export function restoreMath(html, spans) {
  return html.replace(/@@MATH(\d+)@@/g, (whole, n) => {
    const span = spans[Number(n)];
    if (!span) return whole;
    return span.display
      ? `<div class="math-display">${span.html}</div>`
      : `<span class="math">${span.html}</span>`;
  });
}
