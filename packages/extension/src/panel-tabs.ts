export function initializePanelTabs(): void {
  const tabs = Array.from(
    document.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
  );
  const panels = document.querySelectorAll<HTMLElement>('[role="tabpanel"]');
  const select = (name: string, focus: boolean): void => {
    const selected = tabs.find((tab) => tab.dataset.tab === name);
    if (!selected) return;
    for (const tab of tabs) {
      tab.setAttribute('aria-selected', String(tab === selected));
      tab.tabIndex = tab === selected ? 0 : -1;
    }
    for (const panel of panels)
      panel.hidden = panel.id !== selected.getAttribute('aria-controls');
    if (focus) selected.focus();
  };
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => select(tab.dataset.tab!, false));
    tab.addEventListener('keydown', (event) => {
      const next =
        event.key === 'ArrowRight'
          ? index + 1
          : event.key === 'ArrowLeft'
            ? index - 1
            : event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? tabs.length - 1
                : null;
      if (next === null) return;
      event.preventDefault();
      select(tabs[(next + tabs.length) % tabs.length]!.dataset.tab!, true);
    });
  });
  for (const shortcut of document.querySelectorAll<HTMLElement>(
    '[data-tab-target]',
  ))
    shortcut.addEventListener('click', () =>
      select(shortcut.dataset.tabTarget!, true),
    );
}
