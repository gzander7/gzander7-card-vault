// A cleared or unchecked field is still a collector's choice. Keep track of
// edits separately from values so a scan finishing later respects that choice.
export function createScanFields(controls, onChange = () => {}) {
  const edited = new Set();
  const generated = new Map();
  const read = input => input.type === 'checkbox' ? input.checked : input.value;

  for (const [key, input] of Object.entries(controls)) {
    const markEdited = () => {
      edited.add(key);
      generated.delete(key);
      input.removeAttribute('data-scan-filled');
      onChange();
    };
    input.addEventListener('input', markEdited);
    input.addEventListener('change', markEdited);
  }

  function reset() {
    for (const input of Object.values(controls)) input.removeAttribute('data-scan-filled');
    edited.clear();
    generated.clear();
  }

  function clearSuggestions() {
    if (!generated.size) return;
    for (const [key, value] of generated) {
      const input = controls[key];
      if (read(input) === value) {
        if (input.type === 'checkbox') input.checked = false;
        else input.value = '';
      } else {
        edited.add(key);
      }
      input.removeAttribute('data-scan-filled');
    }
    generated.clear();
    onChange();
  }

  function apply(suggestions) {
    let changed = 0;
    for (const [key, input] of Object.entries(controls)) {
      const proposed = suggestions?.[key];
      const prior = read(input);
      if (proposed == null || edited.has(key)) continue;
      if (prior && (!generated.has(key) || prior !== generated.get(key))) continue;
      if (input.type === 'checkbox') {
        if (proposed !== true || prior === true) continue;
        input.checked = true;
      } else {
        if (!['string', 'number'].includes(typeof proposed)) continue;
        const value = String(proposed).trim();
        if (!value || value === prior || (input.maxLength > 0 && value.length > input.maxLength)) continue;
        input.value = value;
      }
      generated.set(key, read(input));
      input.setAttribute('data-scan-filled', '');
      changed++;
    }
    if (changed) onChange();
    return changed;
  }

  function snapshot() {
    const manual = {}, suggestions = {};
    for (const [key,input] of Object.entries(controls)) {
      const value = read(input);
      if (generated.has(key) && generated.get(key) === value) suggestions[key] = value;
      else if (edited.has(key) || generated.has(key) || value) manual[key] = value;
    }
    return {manual, suggestions};
  }
  function restoreManual(values) {
    for (const [key,value] of Object.entries(values || {})) {
      const input = controls[key];
      if (!input) continue;
      if (input.type === 'checkbox') input.checked = value;
      else input.value = value;
      edited.add(key);
    }
    if (values) onChange();
  }
  function values() {
    return Object.fromEntries(Object.entries(controls).map(([key, input]) => [key, read(input)]));
  }
  return { apply, clearSuggestions, reset, snapshot, restoreManual, values };
}
