import { config } from './config.js';

const CHECKED_SET_KEY = 'checkbox:checked';

export function createCheckboxStore(redis, publisher) {
  function isValidIndex(index) {
    return Number.isInteger(index) && index >= 0 && index < config.checkboxCount;
  }

  async function getInitialState() {
    const members = await redis.sMembers(CHECKED_SET_KEY);
    const checkedIndexes = members.map(Number).filter(isValidIndex).sort((a, b) => a - b);
    return { count: config.checkboxCount, checkedIndexes };
  }

  async function setCheckbox({ index, checked, user, socketId }) {
    if (!isValidIndex(index)) {
      return { ok: false, error: 'invalid_index' };
    }

    if (checked) {
      await redis.sAdd(CHECKED_SET_KEY, String(index));
    } else {
      await redis.sRem(CHECKED_SET_KEY, String(index));
    }

    const update = {
      type: 'checkbox-update',
      index,
      checked,
      by: user.id,
      byName: user.name,
      socketId,
      serverId: config.serverId,
      at: Date.now(),
    };

    await publisher.publish(config.pubSubChannel, JSON.stringify(update));
    return { ok: true, update };
  }

  return { getInitialState, setCheckbox, isValidIndex };
}
