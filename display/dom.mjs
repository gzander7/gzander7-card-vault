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

export function photo(url, alt, eager = false) {
  const fallback = () => element('span', 'case-photo-fallback', 'Photo unavailable');
  if (!url) return fallback();
  const image = element('img');
  image.alt = alt;
  image.loading = eager ? 'eager' : 'lazy';
  image.decoding = 'async';
  image.addEventListener('error', () => image.replaceWith(fallback()), { once: true });
  image.src = url;
  return image;
}
