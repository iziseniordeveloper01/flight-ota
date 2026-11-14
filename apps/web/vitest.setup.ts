import '@testing-library/jest-dom/vitest';

// jsdom has no matchMedia; components use it to pick sheet (mobile) vs popover (desktop).
// Default to the mobile layout, matching the server render.
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}
