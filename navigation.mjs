export function createNavigation(actions) {
  const nav = document.getElementById('auth-bar');
  const ownerTemplate = document.getElementById('owner-navigation');
  const gallery = nav.querySelector('.nav-gallery');
  const signIn = nav.querySelector('[data-nav="sign-in"]');
  const collection = document.getElementById('collection');
  const history = document.getElementById('value-history');
  let owner = '';
  let accountButton;
  let accountMenu;

  function selectSection(valueSelected) {
    const current = valueSelected && owner ? nav.querySelector('[data-nav="value"]') : gallery;
    nav.querySelector('[aria-current]')?.removeAttribute('aria-current');
    current.setAttribute('aria-current', 'location');
  }

  function closeAccount(restoreFocus = false) {
    if (!accountMenu || accountMenu.hidden) return;
    accountMenu.hidden = true;
    accountButton.setAttribute('aria-expanded', 'false');
    if (restoreFocus) accountButton.focus();
  }

  gallery.addEventListener('click', () => selectSection(false));
  history.addEventListener('toggle', () => {
    if (!history.open) selectSection(false);
  });
  document.getElementById('mast-search').addEventListener('click', () => {
    selectSection(false);
    collection.scrollIntoView({block: 'start'});
    collection.dispatchEvent(new Event('vault:search'));
  });

  nav.addEventListener('click', event => {
    const button = event.target.closest('[data-nav]');
    if (!button || !nav.contains(button)) return;
    const action = button.dataset.nav;
    if (action === 'account') {
      accountMenu.hidden = !accountMenu.hidden;
      accountButton.setAttribute('aria-expanded', String(!accountMenu.hidden));
      return;
    }
    if (action === 'value') selectSection(true);
    closeAccount(accountMenu?.contains(button));
    actions[action]?.(button);
  });

  function outsideAccount(event) {
    if (!accountMenu || accountMenu.hidden) return;
    if (!accountMenu.contains(event.target) && !accountButton.contains(event.target)) closeAccount();
  }
  document.addEventListener('click', outsideAccount);
  document.addEventListener('focusin', outsideAccount);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && accountMenu && !accountMenu.hidden) {
      event.preventDefault();
      closeAccount(true);
    }
  });

  function setUser(user) {
    const next = user?.id || '';
    if (owner !== next) {
      const restoreFocus = nav.contains(document.activeElement);
      owner = next;
      nav.replaceChildren(gallery, owner ? ownerTemplate.content.cloneNode(true) : signIn);
      accountButton = nav.querySelector('[data-nav="account"]');
      accountMenu = nav.querySelector('.vault-account-menu');
      selectSection(false);
      if (restoreFocus) (accountButton || signIn).focus();
    }
    if (!owner) return;
    const fullName = user.user_metadata?.full_name;
    const displayName = typeof fullName === 'string' && fullName.trim() ? fullName : user.email || '';
    nav.querySelector('.nav-avatar').textContent = Array.from(displayName.trim())[0]?.toUpperCase() || 'A';
    nav.querySelector('.nav-email').textContent = user.email || 'Signed in';
  }

  function setBatchLabel(label) {
    nav.querySelectorAll('[data-batch-label]').forEach(node => { node.textContent = label; });
  }
  return {setUser, setBatchLabel};
}
