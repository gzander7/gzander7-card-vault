# Security

If you find a way to read private vault data (purchases, valuations, sold comps), change someone else's cards or photos, or run code in the vault page, please don't open a public issue. Use GitHub's **Report a vulnerability** button on the repository's Security tab to report it privately.

The publishable Supabase key in `config.js` is public by design; Row Level Security is what protects the data. See [docs/architecture.md](docs/architecture.md#security-model).
