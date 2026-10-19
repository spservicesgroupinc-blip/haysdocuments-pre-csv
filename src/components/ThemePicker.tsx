import React, { createContext, useContext, useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';

type Theme = 'light' | 'dark';
// Keep this key in sync with the small pre-paint initializer in index.html.
const STORAGE_KEY = 'hays.theme.v1';
const ThemeContext = createContext<{ theme: Theme; chooseTheme: (theme: Theme) => void } | null>(null);

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0b1220' : '#f8fafc');
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  useEffect(() => { applyTheme(theme); }, [theme]);
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY && (event.newValue === 'light' || event.newValue === 'dark')) setTheme(event.newValue);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const chooseTheme = (next: Theme) => {
    applyTheme(next);
    setTheme(next);
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* The current session still works when storage is blocked. */ }
  };
  return <ThemeContext.Provider value={{ theme, chooseTheme }}>{children}</ThemeContext.Provider>;
}

export function ThemePicker() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('ThemePicker requires ThemeProvider.');
  return (
    <fieldset className="min-w-0">
      <legend className="mb-2 text-xs font-semibold text-secondary">Appearance</legend>
      <div className="grid grid-cols-2 gap-1 rounded-lg border border-line bg-subtle p-1">
        {([{ value: 'light', label: 'Light', Icon: Sun }, { value: 'dark', label: 'Dark', Icon: Moon }] as const).map(({ value, label, Icon }) => (
          <button key={value} type="button" aria-pressed={context.theme === value} onClick={() => context.chooseTheme(value)}
            className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 ${context.theme === value ? 'bg-slate-900 text-white shadow-sm' : 'text-secondary hover:bg-selection hover:text-primary'}`}>
            <Icon className="h-4 w-4" aria-hidden="true" />{label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
