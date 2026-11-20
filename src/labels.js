// Place names. Real DOM buttons laid over the canvas, so they stay crisp, can be
// focused with the keyboard and are read by screen readers. More names appear
// as you zoom in, and a name gives way if it would overlap a more important one.

const TIER_ZOOM = [0, 0, 0.3, 0.72, 1.5]; // screen pixels per image pixel needed before a tier shows

export function createLabels(root, viewer, onPick) {
  const items = [];
  let selected = null;

  function add(def) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'lbl';
    el.dataset.kind = def.kind;
    el.dataset.tier = def.tier;
    el.innerHTML = '<i aria-hidden="true"></i><span></span>';
    el.lastChild.textContent = def.name;
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      onPick(def.id);
    });
    root.appendChild(el);
    const item = { ...def, el, w: 0, h: 0, shown: false };
    items.push(item);
    return item;
  }

  function measure() {
    for (const it of items) {
      it.w = it.el.offsetWidth;
      it.h = it.el.offsetHeight;
    }
  }

  const p = {};
  const placed = [];
  function update() {
    placed.length = 0;
    const { cssW, cssH, zoom } = viewer;
    for (const it of items) { // items are kept in priority order
      let show = zoom >= TIER_ZOOM[it.tier] || it.id === selected;
      if (show) {
        viewer.toScreen(it.target.x, it.target.y, p);
        const x = Math.round(p.x - it.w / 2), y = Math.round(p.y + (it.dy || 4));
        show = x + it.w > 0 && x < cssW && y + it.h > 0 && y < cssH;
        if (show && it.id !== selected) {
          for (let k = 0; k < placed.length; k++) {
            const q = placed[k];
            if (x < q.x + q.w + 4 && x + it.w + 4 > q.x && y < q.y + q.h + 1 && y + it.h + 1 > q.y) {
              show = false;
              break;
            }
          }
        }
        if (show) {
          placed.push({ x, y, w: it.w, h: it.h });
          it.el.style.transform = `translate3d(${x}px,${y}px,0)`;
        }
      }
      if (show !== it.shown) {
        it.shown = show;
        it.el.classList.toggle('on', show);
        it.el.tabIndex = show ? 0 : -1;
      }
    }
  }

  return {
    add, update, measure,
    sort() {
      items.sort((a, b) => a.tier - b.tier);
    },
    select(id) {
      selected = id;
      for (const it of items) it.el.classList.toggle('sel', it.id === id);
    },
  };
}
