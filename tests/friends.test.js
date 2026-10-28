import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import Hashids from 'hashids';

const source = readFileSync(new URL('../extension/content/friends.js', import.meta.url), 'utf8');
const slowly = new Hashids('slowlyweb', 8, 'abcdefghijklmnopqrstuvwxyz0123456789');

function friendsFor({ persisted, pathname = '/' }) {
  const sandbox = {
    localStorage: { getItem: key => (key === 'persist:slowly' ? persisted : null) },
    location: { pathname },
  };
  vm.runInNewContext(source, sandbox);
  return JSON.parse(JSON.stringify(sandbox.doodlerFriends()));
}

const persist = contacts => JSON.stringify({ contacts: JSON.stringify(contacts), other: '"x"' });
const contact = (id, name, extra = {}) => ({ id, user_id: id + 5000000, name, location_code: 'DE', ...extra });

function lcg(seed) {
  let s = seed;
  return () => (s = (s * 1664525 + 1013904223) % 4294967296);
}

const fixedIds = [0, 1, 2, 9, 10, 99, 100, 101, 999, 1000, 65535, 1234567, 9999999, 12345678, 99999999, 123456789, 987654321];
const rand = lcg(20260101);
const randomIds = Array.from({ length: 300 }, () => rand() % 1000000000);
const allIds = [...new Set([...fixedIds, ...randomIds])];

describe('doodlerFriends hashes', () => {
  it('match the Hashids Slowly uses for friend URLs', () => {
    const contacts = Object.fromEntries(allIds.map(id => [id, contact(id, 'friend' + id)]));
    const { friends } = friendsFor({ persisted: persist(contacts) });
    assert.equal(friends.length, allIds.length);
    for (const f of friends) {
      const id = f.userId - 5000000;
      assert.equal(f.hash, slowly.encode(id), `hash for contact id ${id}`);
    }
  });

  it('are always at least 8 characters of a-z0-9', () => {
    const contacts = Object.fromEntries(allIds.map(id => [id, contact(id, 'f' + id)]));
    for (const f of friendsFor({ persisted: persist(contacts) }).friends) assert.match(f.hash, /^[a-z0-9]{8,}$/);
  });
});

describe('doodlerFriends', () => {
  it('lists friends sorted by name with country and user id', () => {
    const contacts = { a: contact(7, 'Zoe', { location_code: 'FR' }), b: contact(8, 'Anna', { location_code: undefined }) };
    const { friends } = friendsFor({ persisted: persist(contacts) });
    assert.deepEqual(friends.map(f => [f.name, f.userId, f.country]), [['Anna', 5000008, ''], ['Zoe', 5000007, 'FR']]);
  });

  it('skips entries without a name or a numeric user_id', () => {
    const contacts = {
      ok: contact(1, 'Ok'),
      noName: contact(2, ''),
      noUser: { id: 3, name: 'NoUser' },
      stringUser: { id: 4, user_id: '4', name: 'StringUser' },
      nothing: null,
    };
    assert.deepEqual(friendsFor({ persisted: persist(contacts) }).friends.map(f => f.name), ['Ok']);
  });

  it('finds the current friend from the URL hash', () => {
    const contacts = { a: contact(41, 'Ann'), b: contact(42, 'Bob'), c: contact(43, 'Cy') };
    const pathname = `/friend/${slowly.encode(42)}/letters`;
    assert.equal(friendsFor({ persisted: persist(contacts), pathname }).current, 42 + 5000000);
  });

  it('reports no current friend on a non-friend page or an unknown hash', () => {
    const contacts = { a: contact(41, 'Ann') };
    assert.equal(friendsFor({ persisted: persist(contacts), pathname: '/' }).current, null);
    assert.equal(friendsFor({ persisted: persist(contacts), pathname: '/friend/zzzzzzzz' }).current, null);
  });

  it('returns nothing when there is no stored state or it is malformed', () => {
    const empty = { friends: [], current: null };
    assert.deepEqual(friendsFor({ persisted: null }), empty);
    assert.deepEqual(friendsFor({ persisted: 'not json' }), empty);
    assert.deepEqual(friendsFor({ persisted: JSON.stringify({ contacts: 'not json' }) }), empty);
    assert.deepEqual(friendsFor({ persisted: JSON.stringify({}) }), empty);
  });
});
