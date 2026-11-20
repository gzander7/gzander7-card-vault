export function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function button(text, className, onClick) {
  const control = element('button', className, text);
  control.type = 'button';
  control.addEventListener('click', onClick);
  return control;
}

// Tries the small thumbnail first, then the full photo, then a text fallback.
export function photo(url, alt, eager = false, fullUrl = '') {
  const fallback = () => element('span', 'case-photo-fallback', 'Photo unavailable');
  const sources = [url, fullUrl].filter((source, index, all) => source && all.indexOf(source) === index);
  if (!sources.length) return fallback();
  const image = element('img');
  image.alt = alt;
  image.loading = eager ? 'eager' : 'lazy';
  image.decoding = 'async';
  image.addEventListener('error', () => {
    sources.shift();
    if (sources.length) image.src = sources[0];
    else image.replaceWith(fallback());
  });
  image.src = sources[0];
  return image;
}
