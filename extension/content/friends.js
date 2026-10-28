(() => {
  // web.slowly.app main.*.js builds friend URLs with Hashids("slowlyweb", 8, "a-z0-9") over the contact id
  const SALT = 'slowlyweb', MIN_LENGTH = 8;

  function shuffle(alphabet, salt) {
    const c = alphabet.split('');
    for (let i = c.length - 1, v = 0, p = 0; i > 0; i--, v++) {
      v %= salt.length;
      const x = salt.charCodeAt(v);
      p += x;
      const j = (x + v + p) % i;
      [c[i], c[j]] = [c[j], c[i]];
    }
    return c.join('');
  }

  function hashidsSetup() {
    let alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let seps = [...'cfhistuCFHISTU'].filter(ch => alphabet.includes(ch)).join('');
    alphabet = [...alphabet].filter(ch => !seps.includes(ch)).join('');
    seps = shuffle(seps, SALT);
    if (!seps.length || alphabet.length / seps.length > 3.5) {
      let len = Math.ceil(alphabet.length / 3.5);
      if (len === 1) len++;
      if (len > seps.length) {
        const d = len - seps.length;
        seps += alphabet.slice(0, d);
        alphabet = alphabet.slice(d);
      } else seps = seps.slice(0, len);
    }
    alphabet = shuffle(alphabet, SALT);
    const guardCount = Math.ceil(alphabet.length / 12);
    return { guards: alphabet.slice(0, guardCount), alphabet: alphabet.slice(guardCount) };
  }

  const setup = hashidsSetup();

  function encode(n) {
    let { alphabet } = setup;
    const { guards } = setup;
    const idInt = n % 100;
    const lottery = alphabet[idInt % alphabet.length];
    alphabet = shuffle(alphabet, (lottery + SALT + alphabet).slice(0, alphabet.length));
    let digits = '';
    for (let x = n; ; x = Math.floor(x / alphabet.length)) {
      digits = alphabet[x % alphabet.length] + digits;
      if (x < alphabet.length) break;
    }
    let ret = lottery + digits;
    if (ret.length < MIN_LENGTH) {
      ret = guards[(idInt + ret.charCodeAt(0)) % guards.length] + ret;
      if (ret.length < MIN_LENGTH) ret += guards[(idInt + ret.charCodeAt(2)) % guards.length];
    }
    const half = Math.floor(alphabet.length / 2);
    while (ret.length < MIN_LENGTH) {
      alphabet = shuffle(alphabet, alphabet);
      ret = alphabet.slice(half) + ret + alphabet.slice(0, half);
      const excess = ret.length - MIN_LENGTH;
      if (excess > 0) ret = ret.slice(Math.floor(excess / 2), Math.floor(excess / 2) + MIN_LENGTH);
    }
    return ret;
  }

  globalThis.doodlerFriends = () => {
    let contacts;
    try { contacts = JSON.parse(JSON.parse(localStorage.getItem('persist:slowly') ?? '').contacts); } catch { return { friends: [], current: null }; }
    const friends = Object.values(contacts)
      .filter(c => c && typeof c === 'object' && Number.isFinite(c.user_id) && c.name)
      .map(c => ({ userId: c.user_id, name: c.name, country: c.location_code || '', hash: encode(c.id) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const hash = location.pathname.split('/')[2];
    return { friends, current: friends.find(f => f.hash === hash)?.userId ?? null };
  };
})();
