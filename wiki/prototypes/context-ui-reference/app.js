(() => {
  'use strict';
  const research = window.UI_RESEARCH;
  const hunt = window.HUNT_RESEARCH;
  const sections = ['atlas', 'hunt', 'comparison', 'recommendations', 'sources'];
  const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const link = (label, url) => `<a href="${escape(url)}" target="_blank" rel="noopener noreferrer">${escape(label)}</a>`;
  const productNav = document.querySelector('#product-nav');
  const study = document.querySelector('#product-study');
  const dialog = document.querySelector('#image-dialog');
  let currentProduct = research.products[0];
  let imageIndex = 0;
  let currentSection = 'atlas';
  let dialogOpener;
  let pendingProductFocus;

  productNav.innerHTML = research.products.map(p => `<button class="product-button" data-product="${p.id}" data-group="${p.collection || 'base'}" aria-pressed="false"><strong>${escape(p.name)}</strong><span>${escape(p.shorthand)}</span></button>`).join('');
  document.querySelector('#hunt-grid').innerHTML = hunt.products.map((p, i) => `<article class="hunt-card"><div class="hunt-card-meta"><span>0${i+1} · ${escape(p.shorthand)}</span>${p.priority ? '<span class="priority-label">建议先看</span>' : ''}</div><a class="hunt-visual" href="#atlas/${p.id}" data-product-link="${p.id}" aria-label="查看 ${escape(p.name)} 的界面解读"><img src="${escape(p.images[0].src)}" alt="${escape(p.images[0].alt)}" decoding="async"><span class="hunt-preview-fallback" hidden>预览暂不可用，进入图鉴可重试。</span><span class="hunt-image-caption"><span>${escape(p.images[0].title)}</span><span>查看解读 →</span></span></a><h3>${escape(p.name)}</h3><p>${escape(p.lesson)}</p><div class="hunt-card-links">${link('Product Hunt', p.sources.find(s => s[1].includes('producthunt.com'))[1])}${link('官方界面出处', p.images[0].source)}</div></article>`).join('');
  document.querySelectorAll('.hunt-card img').forEach(img => img.addEventListener('error', () => {
    img.hidden = true;
    img.nextElementSibling.hidden = false;
  }));
  document.querySelector('#watch-list').innerHTML = hunt.watchlist.map(p => `<article class="watch-row"><div><h3>${escape(p.name)}</h3><p class="watch-scope">${escape(p.scope)}</p><div class="source-links">${p.sources.map(s => link(s[0], s[1])).join('')}</div></div><div><p>${escape(p.meaning)}</p><p class="watch-limit">核对边界 · ${escape(p.limit)}</p></div><div><span class="note-label">带回 MindOS 的问题</span><p class="watch-question">${escape(p.question)}</p></div></article>`).join('');
  document.querySelector('#comparison-rows').innerHTML = research.comparisons.map(c => `<tr><td><strong>${escape(c.title)}</strong><p>${escape(c.need)}</p></td><td><div class="reference-cell">${escape(c.references)}</div><p>${escape(c.pattern)}</p></td><td>${escape(c.proposal)}</td><td><p>${escape(c.verify)}</p></td></tr>`).join('');
  document.querySelector('#source-list').innerHTML = [...research.products, ...hunt.watchlist].map(p => `<div class="source-row"><div><h3>${escape(p.name)}</h3><p>${escape(p.category || p.scope)}</p></div><div>${p.sources.map(s => link(s[0],s[1])).join('')}</div></div>`).join('');

  function openImage() {
    const item = currentProduct.images[imageIndex];
    dialogOpener = document.activeElement;
    document.querySelector('#dialog-title').textContent = `${currentProduct.name} / ${item.title}`;
    document.querySelector('#dialog-note').textContent = item.note;
    const img = new Image();
    img.alt = item.alt;
    img.src = item.src;
    document.querySelector('#dialog-image-container').replaceChildren(img);
    document.querySelector('#dialog-source').href = item.source;
    dialog.showModal();
  }

  function renderGallery() {
    const item = currentProduct.images[imageIndex];
    const stage = document.querySelector('#image-stage');
    const image = new Image();
    image.alt = item.alt;
    image.decoding = 'async';
    const status = document.createElement('div');
    status.className = 'image-status';
    status.setAttribute('role', 'status');
    status.innerHTML = '<span>正在加载官方界面…</span>' + link('查看原始材料', item.source);
    const zoom = document.querySelector('#zoom-image');
    zoom.disabled = true;
    image.addEventListener('load', () => {
      status.remove();
      zoom.disabled = false;
    });
    image.addEventListener('error', () => {
      image.hidden = true;
      status.innerHTML = '<span>这张官方图片暂时无法加载。</span>' + link('查看官方原始材料', item.source) + '<button class="outline-button" id="retry-image">重新加载图片</button>';
      status.querySelector('#retry-image').addEventListener('click', renderGallery);
    });
    image.addEventListener('click', openImage);
    stage.replaceChildren(image, status);
    image.src = item.src;
    document.querySelector('#picture-title').textContent = item.title;
    document.querySelector('#figure-note').textContent = item.note;
    document.querySelector('#figure-source').href = item.source;
    document.querySelector('#gallery-tabs').innerHTML = currentProduct.images.map((picture, index) => `<button data-image="${index}" aria-pressed="${index === imageIndex}">${escape(picture.title)}</button>`).join('');
    document.querySelector('#gallery-tabs').hidden = currentProduct.images.length === 1;
  }

  function renderProduct() {
    const p = currentProduct;
    const collection = p.collection || 'base';
    productNav.querySelectorAll('[data-group]').forEach(button => { button.hidden = button.dataset.group !== collection; });
    document.querySelectorAll('[data-collection]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.collection === collection)));
    imageIndex = 0;
    study.innerHTML = `
      <div class="product-heading">
        <div><p class="product-category">${escape(p.category)} · ${p.pillars.map(i => escape(research.pillars[i])).join(' / ')}</p><h2>${escape(p.name)}</h2><p class="product-headline">${escape(p.headline)}</p></div>
        <a class="outline-button" href="${escape(p.sources[0][1])}" target="_blank" rel="noopener noreferrer">查看官方材料</a>
      </div>
      <div class="study-columns">
        <figure><div class="picture-frame"><div class="picture-toolbar"><span id="picture-title"></span><button id="zoom-image" aria-haspopup="dialog">放大查看</button></div><div class="image-stage" id="image-stage"></div></div><figcaption class="figure-caption"><span id="figure-note"></span><a id="figure-source" target="_blank" rel="noopener noreferrer">图片出处</a></figcaption><div id="gallery-tabs" class="gallery-tabs" role="group" aria-label="选择界面图片"></div></figure>
        <div><p class="observation-title">观察与解读 · 看这三个地方</p><ol class="observation-list">${p.looks.map((look,i) => `<li><span class="observation-number">0${i+1}</span><div><h3>${escape(look[0])}</h3><p>${escape(look[1])}</p></div></li>`).join('')}</ol></div>
      </div>
      <p class="relevance">${escape(p.relevance)}</p>
      <div class="fact-box"><span class="note-label">官方能力</span><div><p>${escape(p.facts)}</p><div class="source-links">${p.sources.map(s => link(s[0],s[1])).join('')}</div></div></div>
      <div class="adaptation"><span class="note-label">MindOS 提案</span><div><h3>${escape(p.adaptation[0])}</h3><p>${escape(p.adaptation[1])}</p><p class="scenario">${escape(p.scenario)}</p></div></div>
      <p class="boundary"><strong>借鉴边界</strong>${escape(p.boundary)}</p>`;
    productNav.querySelectorAll('[data-product]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.product === p.id)));
    renderGallery();
    document.querySelector('#zoom-image').addEventListener('click', openImage);
    document.querySelector('#gallery-tabs').addEventListener('click', e => {
      const button = e.target.closest('[data-image]');
      if (!button) return;
      imageIndex = Number(button.dataset.image);
      renderGallery();
      document.querySelector(`[data-image="${imageIndex}"]`).focus({preventScroll:true});
    });
  }

  function revealSelectedProduct() {
    if (currentSection !== 'atlas' || !matchMedia('(max-width: 720px)').matches) return;
    const selected = productNav.querySelector('[aria-pressed="true"]');
    if (selected) productNav.scrollLeft = selected.offsetLeft - (productNav.clientWidth - selected.offsetWidth) / 2;
  }

  function renderRoute(initial = false) {
    if (!initial && location.hash === '#main') return;
    const [requestedSection, requestedProduct] = location.hash.slice(1).split('/');
    const nextSection = sections.includes(requestedSection) ? requestedSection : 'atlas';
    const nextProduct = research.products.find(p => p.id === requestedProduct) || (requestedProduct ? research.products[0] : currentProduct);
    const changedSection = nextSection !== currentSection;
    const changedProduct = nextProduct.id !== currentProduct.id;
    currentProduct = nextProduct;
    currentSection = nextSection;
    sections.forEach(section => {
      const selected = section === currentSection;
      document.getElementById(section).hidden = !selected;
      const tab = document.getElementById(`tab-${section}`);
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
    if (initial || changedProduct) renderProduct();
    revealSelectedProduct();
    document.title = currentSection === 'atlas' ? `${currentProduct.name} · MindOS 界面参考研究` : currentSection === 'hunt' ? 'Product Hunt 精选 · MindOS 界面参考研究' : 'MindOS · 界面参考研究';
    if (!initial && changedSection) document.querySelector('.section-tabs').scrollIntoView({block:'start'});
    else if (!initial && changedProduct && study.getBoundingClientRect().top < 0) study.scrollIntoView({block:'start'});
    if (pendingProductFocus) {
      productNav.querySelector(`[data-product="${pendingProductFocus}"]`)?.focus({preventScroll:true});
      pendingProductFocus = undefined;
    }
  }

  function productRoute(id) { location.hash = `atlas/${id}`; }
  productNav.addEventListener('click', e => {
    const button = e.target.closest('[data-product]');
    if (button) productRoute(button.dataset.product);
  });
  document.querySelectorAll('[data-product-link]').forEach(button => button.addEventListener('click', e => {
    e.preventDefault();
    pendingProductFocus = button.dataset.productLink;
    productRoute(button.dataset.productLink);
    if (currentSection === 'atlas' && currentProduct.id === pendingProductFocus) renderRoute();
  }));
  document.querySelector('.collection-switch').addEventListener('click', e => {
    const button = e.target.closest('[data-collection]');
    if (!button || button.getAttribute('aria-pressed') === 'true') return;
    productRoute(research.products.find(p => (p.collection || 'base') === button.dataset.collection).id);
  });
  document.querySelectorAll('[data-section]').forEach(button => button.addEventListener('click', () => {
    location.hash = button.dataset.section === 'atlas' ? `atlas/${currentProduct.id}` : button.dataset.section;
  }));
  document.querySelector('.section-tabs').addEventListener('keydown', e => {
    if (!['ArrowLeft','ArrowRight','Home','End'].includes(e.key)) return;
    const tabs = [...document.querySelectorAll('[data-section]')];
    const index = tabs.indexOf(document.activeElement);
    if (index < 0) return;
    e.preventDefault();
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (index + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    tabs[next].focus();
    tabs[next].click();
  });
  productNav.addEventListener('keydown', e => {
    if (!['ArrowDown','ArrowUp','Home','End'].includes(e.key)) return;
    const buttons = [...productNav.querySelectorAll('button:not([hidden])')];
    const index = buttons.indexOf(document.activeElement);
    if (index < 0) return;
    e.preventDefault();
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (index + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next].focus();
    buttons[next].click();
  });
  document.querySelector('#close-dialog').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => { if (dialogOpener?.isConnected) dialogOpener.focus({preventScroll:true}); });
  window.addEventListener('hashchange', () => renderRoute());
  window.addEventListener('resize', revealSelectedProduct);
  renderRoute(true);
})();
