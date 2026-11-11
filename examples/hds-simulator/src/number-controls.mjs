const fieldIds = ['weight', 'pour-rate'];
const byId = id => document.getElementById(id);

export function updateNumberButtons() {
  for (const id of fieldIds) {
    const input = byId(id);
    const value = input.valueAsNumber;
    const unavailable = input.matches(':disabled') || input.value === '' || !input.validity.valid || !Number.isFinite(value);
    byId(`${id}-step-up`).disabled = unavailable || value >= Number(input.max);
    byId(`${id}-step-down`).disabled = unavailable || value <= Number(input.min);
  }
}

export function bindNumberControl(id, type, send) {
  const input = byId(id);
  const commit = () => {
    updateNumberButtons();
    if (input.value !== '' && input.validity.valid && Number.isFinite(input.valueAsNumber)) send({ type, value: input.valueAsNumber });
  };
  input.addEventListener('input', commit);
  for (const direction of ['up', 'down']) {
    const button = byId(`${id}-step-${direction}`);
    button.addEventListener('click', () => {
      if (button.matches(':disabled')) return;
      input[direction === 'up' ? 'stepUp' : 'stepDown']();
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    button.addEventListener('keydown', event => {
      if (event.repeat && ['Enter', ' '].includes(event.key)) event.preventDefault();
    });
  }
}
