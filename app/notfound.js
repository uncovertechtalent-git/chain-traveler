// The page for an address that does not exist (404.html): the same language choice as the app. Absolute paths, because
// this page is served at any address.
import { initialLang, setLang, t, th, raw } from '/i18n.js';

await setLang(initialLang(), { save: false });
document.title = `${t('nf.title')} - Chain Traveler`;
document.getElementById('nf-body').innerHTML = th('nf.body', { app: raw('<a href="/">Chain Traveler</a>') });
