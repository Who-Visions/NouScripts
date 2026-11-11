(() => {
  const R = (e) => e.getBoundingClientRect();
  const q = (s) => document.querySelector(s);
  const header = q('header'); const footer = q('footer'); const main = q('main');
  const hc = [...header.children].map(R); const fc = [...footer.children].map(R);
  const rail = q('nav[aria-label="Sections"]'); const panel = main.previousElementSibling; const right = q('aside[aria-label="Approval and notes"]');
  const mh = main.children[0];
  return {
    divider1_x: { top: Math.round(hc[0].right), middle: Math.round(R(panel).right), dock: Math.round(fc[0].right) },
    divider2_x: { top: Math.round(hc[2].left), middle: Math.round(R(right).left), dock: Math.round(fc[2].left) },
    header_lines_y: [rail.children[0], panel.children[0], mh, right.children[0]].map((e) => Math.round(R(e).bottom)),
    left_edges: { title: Math.round(R(q('h1')).left), rundown: Math.round(R(mh).left + parseFloat(getComputedStyle(mh).paddingLeft)), firstCard: Math.round(R(q('article')).left), inputBox: Math.round(R(q('form').lastElementChild).left) },
    right_edges: { modes: Math.round(R(q('header [aria-label="View"]')).right), rundown: Math.round(R(mh).right - parseFloat(getComputedStyle(mh).paddingRight)), firstCard: Math.round(R(q('article')).right), inputBox: Math.round(R(q('form').lastElementChild).right) },
    overflow: [...document.querySelectorAll('body *')].filter((e) => { const r = R(e); return r.right > innerWidth + 1 && r.width > 0; }).length,
    heights: { top: Math.round(R(header).height), dock: Math.round(R(footer).height) },
  };
})()
