(() => {
  const PENDING = 'doodler:pending';
  // the Slowly editor offers "Restore" for whatever it reads from this key when it opens
  const RECOVERY = 'slowly-drawing-recovery:';
  const getItem = Storage.prototype.getItem;
  Storage.prototype.getItem = function (key) {
    if (typeof key === 'string' && key.startsWith(RECOVERY)) {
      const pending = getItem.call(localStorage, PENDING);
      if (pending) {
        localStorage.removeItem(PENDING);
        return pending;
      }
    }
    return getItem.call(this, key);
  };
})();
