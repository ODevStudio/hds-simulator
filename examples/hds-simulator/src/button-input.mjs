export function createButtonInput(send, getSnapshot) {
  const owners = new Map();
  const names = ['circle', 'square'];
  const sync = () => {
    for (const name of names) if (!getSnapshot().held[name]) owners.delete(name);
  };
  const cancelWhere = predicate => {
    for (const [name, current] of owners) {
      if (!predicate(current)) continue;
      owners.delete(name);
      send({ type: 'buttonCancel', name });
    }
  };
  return {
    down(name, owner) {
      sync();
      if (!names.includes(name) || owners.has(name) && owners.get(name) !== owner) return false;
      if (owners.has(name)) return true;
      owners.set(name, owner);
      send({ type: 'buttonDown', name });
      return true;
    },
    up(name, owner) {
      sync();
      if (owners.get(name) !== owner) return false;
      owners.delete(name);
      send({ type: 'buttonUp', name });
      return true;
    },
    cancel(owner) {
      cancelWhere(current => current === owner);
    },
    cancelRemote() { cancelWhere(current => current.startsWith('api:')); },
  };
}
