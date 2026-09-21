import { LanguageToggle } from './LanguageToggle';
import { Logo } from './Logo';
import { ThemeToggle } from './ThemeToggle';

/** App header: logo on the left, language and theme controls on the right. */
export function Header() {
  return (
    <header className="sticky top-0 z-10 border-b border-border bg-bg/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Logo />
        <div className="flex items-center gap-2 sm:gap-3">
          <LanguageToggle />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
